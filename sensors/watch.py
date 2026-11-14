"""Receptor BLE de TbWatchSensors (Galaxy Watch). Nada sale de este proceso.

El reloj es el periférico GATT y anuncia el servicio 7b1d0001-…; aquí la Pi se
conecta como central. Android cambia la dirección Bluetooth del reloj cada
cierto tiempo, así que por defecto se busca por el servicio («auto») y no por
una dirección fija. Formatos: tb/sw/shared/SensorProtocol.kt (little-endian).
"""
import asyncio
import struct
import threading
import time
from datetime import datetime, timezone

BASE = '-1234-4567-8900-1a2b3c4d5e6f'
SERVICE = '7b1d0001' + BASE
HR = '7b1d0003' + BASE
TEMP = '7b1d0005' + BASE
CONTROL = '7b1d0006' + BASE
STATUS = '7b1d0007' + BASE
SPO2 = '7b1d000c' + BASE

CMD_START, CMD_STOP, CMD_SPO2, CMD_STATUS = b'\x01', b'\x02', b'\x13', b'\x20'
FRESH_S = 10          # una lectura de pulso más vieja no se muestra
SPO2_KEEP_S = 600     # el último SpO2 completo se muestra 10 minutos


def decode_hr(data):
    # HrPacket: int32 elapsedRealtime, int16 lpm, int16 IBI
    if len(data) != 8:
        raise ValueError('Invalid HR packet length')
    timestamp, bpm, ibi = struct.unpack('<Ihh', data)
    return {'watch_elapsed_ms': timestamp, 'bpm': bpm if 0 < bpm <= 250 else None,
            'ibi_ms': ibi if 0 < ibi <= 3000 else None}


def decode_temp(data):
    # TempPacket: int32 ts, float piel °C, float ambiente °C
    if len(data) < 12:
        raise ValueError('Invalid temperature packet length')
    _, skin, ambient = struct.unpack_from('<Iff', data)
    ok = lambda v: round(v, 2) if 20 <= v <= 45 else None
    return {'skin_c': ok(skin), 'ambient_c': round(ambient, 2) if -20 <= ambient <= 60 else None}


def decode_spo2(data):
    # SpO2Packet: int32 ts, int32 estado (0 midiendo, 2 completo), int32 %, int32 lpm
    if len(data) < 16:
        raise ValueError('Invalid SpO2 packet length')
    _, status, spo2, hr = struct.unpack_from('<Iiii', data)
    return {'status': 'complete' if status == 2 else 'measuring',
            'spo2': spo2 if status == 2 and 70 <= spo2 <= 100 else None,
            'bpm': hr if 0 < hr <= 250 else None}


def decode_status(data):
    # StatusPacket: int32 sesión, int16 perdidos, byte batería, byte emitiendo, byte Hz, byte medición
    if len(data) < 10:
        raise ValueError('Invalid status packet length')
    _, dropped, battery, streaming, _, active = struct.unpack_from('<IhBBBB', data)
    return {'battery_pct': battery if battery <= 100 else None, 'streaming': bool(streaming),
            'dropped': dropped, 'measuring': active}


class WatchReceiver:
    def __init__(self, address='auto'):
        self.address = None if address in (None, '', 'auto') else address
        self.lock = threading.Lock()
        self.hr = None        # (monotonic, paquete)
        self.temp = None
        self.spo2 = None
        self.status = None
        self.connected = False
        self.device = None
        self.stop_event = threading.Event()
        self.thread = None
        self.loop = None
        self.client = None
        self.last_error = None

    # -- notificaciones
    def _store(self, attr, decoder, data):
        try:
            value = decoder(bytes(data))
        except (ValueError, struct.error):
            return
        with self.lock:
            setattr(self, attr, (time.monotonic(), value))

    def on_hr(self, _sender, data):
        self._store('hr', decode_hr, data)

    def read(self):
        now = time.monotonic()
        with self.lock:
            if not self.connected:
                return None
            out = {'connected': True, 'device': self.device, 'bpm': None, 'ibi_ms': None,
                   'skin_c': None, 'spo2': None, 'spo2_status': None, 'battery_pct': None,
                   'observed_at': datetime.now(timezone.utc).isoformat()}
            if self.hr and now - self.hr[0] <= FRESH_S:
                out['bpm'], out['ibi_ms'] = self.hr[1]['bpm'], self.hr[1]['ibi_ms']
            if self.temp and now - self.temp[0] <= 60:
                out['skin_c'] = self.temp[1]['skin_c']
            if self.spo2:
                age = now - self.spo2[0]
                if self.spo2[1]['status'] == 'measuring' and age <= 45:
                    out['spo2_status'] = 'measuring'
                elif self.spo2[1]['spo2'] and age <= SPO2_KEEP_S:
                    out['spo2'], out['spo2_status'] = self.spo2[1]['spo2'], 'complete'
            if self.status:
                out['battery_pct'] = self.status[1]['battery_pct']
            return out

    def request_spo2(self):
        """Pide una medición de SpO2 al reloj (unos 30 s quieto)."""
        if not (self.loop and self.client and self.connected):
            return False
        with self.lock:
            self.spo2 = (time.monotonic(), {'status': 'measuring', 'spo2': None, 'bpm': None})
        fut = asyncio.run_coroutine_threadsafe(
            self.client.write_gatt_char(CONTROL, CMD_SPO2, response=True), self.loop)
        try:
            fut.result(timeout=5)
            return True
        except Exception:
            return False

    # -- hilo
    def start(self):
        self.thread = threading.Thread(target=lambda: asyncio.run(self.run()), name='xpaze-watch', daemon=True)
        self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=8)

    async def _find(self, BleakScanner):
        if self.address:
            return self.address
        device = await BleakScanner.find_device_by_filter(
            lambda d, adv: SERVICE in [u.lower() for u in adv.service_uuids], timeout=10)
        return device

    async def run(self):
        try:
            from bleak import BleakClient, BleakScanner
        except ImportError:
            print('Reloj: instala bleak en el entorno virtual.', flush=True)
            return
        self.loop = asyncio.get_running_loop()
        while not self.stop_event.is_set():
            try:
                target = await self._find(BleakScanner)
                if not target:
                    self.last_error = 'Reloj no encontrado (¿app abierta y emitiendo?)'
                    raise TimeoutError
                # winrt: Windows guarda en caché los servicios GATT; si la app del reloj se reinicia, quedan obsoletos
                async with BleakClient(target, timeout=15, winrt={'use_cached_services': False}) as client:
                    self.client = client
                    await client.start_notify(HR, self.on_hr)
                    for uuid, attr, dec in ((TEMP, 'temp', decode_temp), (SPO2, 'spo2', decode_spo2),
                                            (STATUS, 'status', decode_status)):
                        try:
                            await client.start_notify(uuid, lambda _s, d, a=attr, f=dec: self._store(a, f, d))
                        except Exception:
                            pass  # versiones antiguas de la app sin esa característica
                    await client.write_gatt_char(CONTROL, CMD_START, response=True)
                    await client.write_gatt_char(CONTROL, CMD_STATUS, response=True)
                    with self.lock:
                        self.connected = True
                        self.device = getattr(target, 'address', target)
                        self.last_error = None
                    print(f'Reloj: conectado a {self.device}', flush=True)
                    try:
                        tick = 0
                        while client.is_connected and not self.stop_event.is_set():
                            await asyncio.sleep(1)
                            tick += 1
                            if tick % 60 == 0:
                                await client.write_gatt_char(CONTROL, CMD_STATUS, response=True)
                    finally:
                        if client.is_connected:
                            await client.write_gatt_char(CONTROL, CMD_STOP, response=True)
            except Exception as exc:
                if not isinstance(exc, TimeoutError):
                    self.last_error = f'{type(exc).__name__}'
                    print(f'Reloj: conexión no disponible ({type(exc).__name__}). Reintentando.', flush=True)
            finally:
                self.client = None
                with self.lock:
                    self.connected = False
                    self.hr = self.temp = self.status = None
            for _ in range(5):
                if self.stop_event.is_set():
                    break
                await asyncio.sleep(1)

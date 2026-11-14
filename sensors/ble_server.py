"""Periférico Bluetooth LE «XPaze Station» para la app (PWA con Web Bluetooth).

Publica lo que leen StationLink (Arduino) y el reloj con el protocolo de
ble_protocol.py. Corre en su propio hilo con su bucle asyncio; si el
Bluetooth falla, el resto del puente sigue funcionando.
"""
import asyncio
import threading

import ble_protocol as P

NAME = 'XPaze Station'
FAST_S = 0.12   # cada cuánto se envía la onda de pulso
SLOW_S = 1.0    # constantes, reloj y estado


class BleServer:
    def __init__(self, station_fn, watch_fn, snapshot_fn, test=False):
        # funciones, porque el puente crea station/watch después
        self.station_fn = station_fn
        self.watch_fn = watch_fn
        self.snapshot_fn = snapshot_fn
        self.test = test
        self.thread = None
        self.loop = None
        self.server = None
        self.stop_event = threading.Event()
        self.started = False
        self.error = None
        self.seq = 0
        self.wave_seq = 0
        self.ppg_total = 0
        self.hp = None          # media lenta para quitar la línea de base de la onda
        self.last_card = None

    def start(self):
        self.thread = threading.Thread(target=lambda: asyncio.run(self._main()), name='xpaze-ble', daemon=True)
        self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)

    # -- GATT
    def _read(self, characteristic, **_kw):
        return characteristic.value

    def _write(self, characteristic, value, **_kw):
        if str(characteristic.uuid).lower() != P.CONTROL or not value:
            return
        cmd = value[0]
        if cmd == P.CMD_WATCH_SPO2:
            watch = self.watch_fn()
            if watch:
                # la petición al reloj puede tardar: fuera del bucle de Bluetooth
                self.loop.run_in_executor(None, watch.request_spo2)
        elif cmd == P.CMD_RESEND:
            self.last_card = None
            self.loop.call_soon_threadsafe(self._push_slow)

    def _set(self, uuid, data, notify=True):
        ch = self.server.get_characteristic(uuid)
        if ch is None:
            return
        ch.value = bytearray(data)
        if notify:
            self.server.update_value(P.SERVICE, uuid)

    def _push_slow(self):
        snap = self.snapshot_fn()
        st = snap.get('station') or {}
        watch = snap.get('watch')
        self.seq = (self.seq + 1) & 0xFF
        self._set(P.VITALS, P.encode_vitals(self.seq, st.get('pulse'), snap.get('environment')))
        self._set(P.WATCH, P.encode_watch(watch))
        self._set(P.STATUS, P.encode_status(st, bool(watch), self.test))
        card = st.get('card')
        uid = card['uid'] if card else None
        # la tarjeta solo se notifica al cambiar; leerla devuelve la última
        self._set(P.CARD, P.encode_card(card), notify=uid != self.last_card)
        self.last_card = uid

    def _push_wave(self):
        station = self.station_fn()
        if not station:
            return
        self.ppg_total, samples = station.ir_since(self.ppg_total)
        out = []
        for x in samples:
            # filtro paso alto: la onda es lo que se aparta de la media lenta;
            # se invierte para que cada latido sea un pico hacia arriba
            self.hp = x if self.hp is None or abs(x - self.hp) > 50000 else self.hp + (x - self.hp) / 12
            out.append(-(x - self.hp) * 4)
        for i in range(0, len(out), 8):
            self.wave_seq = (self.wave_seq + 1) & 0xFF
            self._set(P.WAVE, P.encode_wave(self.wave_seq, out[i:i + 8]))

    async def _main(self):
        try:
            from bless import BlessServer, GATTAttributePermissions as Perm, GATTCharacteristicProperties as Prop
        except ImportError:
            self.error = 'bless no instalado'
            print('Bluetooth: instala bless en el entorno virtual.', flush=True)
            return
        self.loop = asyncio.get_running_loop()
        try:
            self.server = BlessServer(name=NAME, loop=self.loop)
            self.server.read_request_func = self._read
            self.server.write_request_func = self._write
            await self.server.add_new_service(P.SERVICE)
            rn, r = Prop.read | Prop.notify, Perm.readable
            chars = [
                (P.VITALS, rn, P.encode_vitals(0, None, None), r),
                (P.WAVE, Prop.notify, P.encode_wave(0, []), r),
                (P.CARD, rn, P.encode_card(None), r),
                (P.WATCH, rn, P.encode_watch(None), r),
                (P.STATUS, rn, P.encode_status(None, False, self.test), r),
                (P.CONTROL, Prop.write | Prop.write_without_response, b'\x00', Perm.writeable),
            ]
            for uuid, props, value, perms in chars:
                await self.server.add_new_characteristic(P.SERVICE, uuid, props, bytearray(value), perms)
            await self.server.start()
            self.started = True
            print(f'Bluetooth: anunciando «{NAME}»', flush=True)
        except Exception as exc:
            self.error = f'{type(exc).__name__}: {exc}'[:200]
            print(f'Bluetooth: no se pudo iniciar el periférico ({self.error})', flush=True)
            return
        slow_every = round(SLOW_S / FAST_S)
        tick = 0
        while not self.stop_event.is_set():
            try:
                self._push_wave()
                if tick % slow_every == 0:
                    self._push_slow()
            except Exception as exc:  # una lectura mala no tumba el servidor
                self.error = f'{type(exc).__name__}: {exc}'[:200]
            tick += 1
            await asyncio.sleep(FAST_S)
        try:
            await self.server.stop()
        except Exception:
            pass

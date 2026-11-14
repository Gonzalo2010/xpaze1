#!/usr/bin/env python3
"""XPaze local sensor bridge. Never listens on a network interface."""
import argparse
import json
import math
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
watch = None
station = None  # StationLink: el Arduino por USB
test_data = False  # True = datos inventados para la demo, marcados como prueba


def read_environment(bus):
    """Read independent sensors, never replacing an unavailable reading with a simulation."""
    result = {'temperature_c': None, 'humidity_pct': None, 'pressure_hpa': None}
    errors = []
    try:
        import adafruit_ahtx0
        sensor = adafruit_ahtx0.AHTx0(bus)
        result['temperature_c'] = finite(sensor.temperature)
        result['humidity_pct'] = finite(sensor.relative_humidity)
    except Exception as exc:
        errors.append('AHT20: ' + type(exc).__name__)
    try:
        import adafruit_bmp280
        sensor = adafruit_bmp280.Adafruit_BMP280_I2C(bus)
        result['pressure_hpa'] = finite(sensor.pressure)
    except Exception as exc:
        errors.append('BMP280: ' + type(exc).__name__)
    return result, errors


def finite(value):
    value = float(value)
    return round(value, 2) if math.isfinite(value) else None


def snapshot():
    from datetime import datetime, timezone
    values = {'temperature_c': None, 'humidity_pct': None, 'pressure_hpa': None}
    errors = []
    st = station.read() if station else None
    if st and st['connected']:
        # los sensores cuelgan del Arduino: el ambiente llega por USB
        if st['environment']:
            values = {k: st['environment'][k] for k in values}
        mods = st['modules']
        names = {'aht': 'AHT20', 'bmp': 'BMP280', 'ppg': 'MAX3010x', 'rfid': 'RC522'}
        errors += [f'{label}: no responde' for key, label in names.items() if st['firmware'] and not mods.get(key)]
        if not st['firmware']:
            errors.append('Arduino: sin firmware XPaze')
    else:
        # sin Arduino: lectura directa por el I2C de la Raspberry (montaje antiguo)
        try:
            import board
            with board.I2C() as bus:
                values, errors = read_environment(bus)
        except Exception as exc:
            errors.append('I2C: ' + type(exc).__name__)
        if station:
            errors.append('Arduino: no conectado')
    return {'source': 'test' if test_data else 'hardware', 'observed_at': datetime.now(timezone.utc).isoformat(),
            'environment': values, 'station': st, 'watch': watch.read() if watch else None, 'errors': errors}


class Handler(SimpleHTTPRequestHandler):
    def local_only(self):
        # Sin --lan: solo este dispositivo. Con --lan: cualquier equipo de la red local
        # (direcciones privadas), nunca desde Internet.
        if getattr(self.server, 'lan', False):
            import ipaddress
            try:
                ip = ipaddress.ip_address(self.client_address[0])
            except ValueError:
                ip = None
            if ip and (ip.is_private or ip.is_loopback):
                return True
            self.send_error(403)
            return False
        host = self.headers.get('Host', '').lower()
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if host not in allowed:
            self.send_error(403)
            return False
        return True

    def stream(self):
        from wifi_stream import events
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try:
            for chunk in events(lambda: station, snapshot, test_data):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def proxy_ai(self):
        # La IA corre en otro equipo (un portátil con server/psicologa.js y Ollama).
        import urllib.request
        target = getattr(self.server, 'ai', None)
        if not target:
            self.send_error(503, 'IA no configurada (--ai)')
            return
        length = min(int(self.headers.get('Content-Length') or 0), 64_000)
        body = self.rfile.read(length)
        name = self.path.split('/api/', 1)[1]  # psicologa · explicar · voz/sesion
        req = urllib.request.Request(f'{target.rstrip("/")}/api/{name}', data=body, method='POST',
                                     headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                self.send_response(res.status)
                self.send_header('Content-Type', res.headers.get('Content-Type', 'text/event-stream'))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                while True:
                    chunk = res.read1(4096) if hasattr(res, 'read1') else res.read(4096)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as exc:
            self.send_error(502, f'IA no disponible ({type(exc).__name__})')

    def send_json(self, payload, code=200):
        data = json.dumps(payload, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.local_only():
            return
        if self.path == '/api/sensors':
            self.send_json(snapshot())
        elif self.path == '/api/stream':
            self.stream()
        else:
            super().do_GET()

    def do_POST(self):
        # solo desde la propia página: mismo host y petición sin cuerpo
        if not self.local_only():
            return
        if self.path == '/api/watch/spo2':
            ok = bool(watch and watch.request_spo2())
            self.send_json({'ok': ok}, 200 if ok else 409)
        elif self.path == '/api/cmd':
            # órdenes de la app por WiFi: 1 = medir SpO2 con el reloj (mismo código que por Bluetooth)
            try:
                cmd = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length') or 0), 256)) or b'{}').get('cmd')
            except ValueError:
                cmd = None
            ok = cmd == 1 and bool(watch and watch.request_spo2())
            self.send_json({'ok': ok}, 200 if ok else 409)
        elif self.path in ('/app/api/psicologa', '/app/api/explicar', '/app/api/voz/sesion', '/demo/api/psicologa', '/demo/api/voz/sesion'):
            self.proxy_ai()
        else:
            self.send_error(404)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--watch', metavar='BLE_ADDRESS', nargs='?', const='auto',
                        help='Activar el reloj con TbWatchSensors. Sin dirección, lo busca por su servicio BLE')
    parser.add_argument('--test-data', action='store_true', help='Datos de prueba sin hardware (marcados como prueba)')
    parser.add_argument('--ble', action='store_true', help='Anunciar la estación por Bluetooth LE para la app')
    parser.add_argument('--serial', metavar='PUERTO', help='Puerto del Arduino (por defecto, el primero que aparezca)')
    parser.add_argument('--no-arduino', action='store_true', help='No buscar el Arduino; leer el I2C de la Raspberry')
    parser.add_argument('--lan', action='store_true', help='Servir la app a la red local (WiFi), no solo a este dispositivo')
    parser.add_argument('--ai', metavar='URL', help='Servidor de IA (server/psicologa.js), p. ej. http://portatil.local:5193')
    args = parser.parse_args()
    root = ROOT / 'dist'
    if not (root / 'demo' / 'index.html').is_file():
        parser.error('Build the site with npm run build first')
    global watch, station, test_data
    feeder = None
    if args.test_data:
        from station import StationLink
        from testdata import FakeWatch, TestFeeder
        test_data = True
        station = StationLink()
        feeder = TestFeeder(station).start()
        watch = FakeWatch(feeder)
        print('XPaze: DATOS DE PRUEBA (sin hardware)', flush=True)
    else:
        if not args.no_arduino:
            from station import StationLink
            station = StationLink(args.serial).start()
        if args.watch:
            from watch import WatchReceiver
            watch = WatchReceiver(args.watch)
            watch.start()
    ble = None
    if args.ble:
        from ble_server import BleServer
        ble = BleServer(lambda: station, lambda: watch, snapshot, test=test_data).start()
    handler = partial(Handler, directory=str(root))
    server = ThreadingHTTPServer(('0.0.0.0' if args.lan else '127.0.0.1', args.port), handler)
    server.daemon_threads = True
    server.lan, server.ai = args.lan, args.ai
    where = f'red local, puerto {args.port}' if args.lan else 'solo este dispositivo'
    print(f'XPaze: http://127.0.0.1:{args.port}/app/ y /demo/ ({where}; IA: {args.ai or "no configurada"})', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if watch:
            watch.stop()
        if ble:
            ble.stop()
        if feeder:
            feeder.stop()
        elif station:
            station.stop()


if __name__ == '__main__':
    main()

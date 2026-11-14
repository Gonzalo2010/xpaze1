#!/usr/bin/env python3
"""Enlace con el Arduino de la XPaze Station por USB.

El Arduino (firmware/xpaze-station) envía líneas de texto; aquí se leen en un
hilo, se guarda lo último de cada sensor y se calculan el pulso y una
estimación de SpO2 a partir de la señal cruda del MAX3010x.

Nada de esto es un dispositivo médico: son lecturas de un prototipo.

Uso directo para probar:  python sensors/station.py  [--port /dev/ttyACM0]
"""
import glob
import math
import threading
import time
from collections import deque

BAUD = 115200
PPG_RATE = 25            # muestras por segundo (100 Hz con media de 4 en el firmware)
PPG_WINDOW_S = 8         # segundos que se analizan
FINGER_MIN_IR = 30000    # por debajo, no hay dedo en el sensor
ENV_MAX_AGE_S = 10       # lectura ambiental más antigua que esto = no disponible
CARD_SHOW_S = 30         # durante cuánto se informa la última tarjeta


# --------------------------------------------------------------- protocolo --

def _num(text):
    try:
        v = float(text)
    except ValueError:
        return None
    return round(v, 2) if math.isfinite(v) else None


def parse_line(line):
    """Convierte una línea del Arduino en un diccionario, o None si no se entiende."""
    parts = line.strip().split(',')
    kind = parts[0] if parts else ''
    try:
        if kind == 'P' and len(parts) == 3:
            return {'type': 'ppg', 'red': int(parts[1]), 'ir': int(parts[2])}
        if kind == 'E' and len(parts) == 6:
            return {'type': 'env', 'ms': int(parts[1]), 'aht_temperature_c': _num(parts[2]),
                    'humidity_pct': _num(parts[3]), 'bmp_temperature_c': _num(parts[4]),
                    'pressure_hpa': _num(parts[5])}
        if kind == 'C' and len(parts) == 2 and parts[1] and all(c in '0123456789ABCDEF' for c in parts[1]):
            return {'type': 'card', 'uid': parts[1]}
        if kind == 'S' and len(parts) >= 2:
            modules = {}
            for item in parts[2:]:
                key, _, value = item.partition('=')
                modules[key] = value if key == 'rc522' else value == '1'
            return {'type': 'status', 'firmware': parts[1], 'modules': modules}
    except ValueError:
        return None
    return None


# ------------------------------------------------------------ pulsioxímetro --

def _moving_average(values, n):
    out, acc = [], 0.0
    for i, v in enumerate(values):
        acc += v
        if i >= n:
            acc -= values[i - n]
        out.append(acc / min(i + 1, n))
    return out


def _median(values):
    s = sorted(values)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _autocorr(x, lag):
    """Correlación de la señal consigo misma desplazada `lag` muestras (−1…1)."""
    if lag <= 0 or lag >= len(x) - 2:
        return 0.0
    a, b = x[:-lag], x[lag:]
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    num = sum((p - ma) * (q - mb) for p, q in zip(a, b))
    den = math.sqrt(sum((p - ma) ** 2 for p in a) * sum((q - mb) ** 2 for q in b))
    return num / den if den else 0.0


def analyze_ppg(red, ir, rate=PPG_RATE):
    """Pulso (lpm) y SpO2 estimada a partir de las muestras crudas.

    Devuelve siempre un diccionario con 'finger' y 'quality'; 'bpm' y 'spo2'
    son None si la señal no permite un cálculo fiable.
    """
    result = {'finger': False, 'bpm': None, 'spo2': None, 'quality': 'no-finger', 'seconds': round(len(ir) / rate, 1)}
    if len(ir) < rate * 2 or len(ir) != len(red):
        result['quality'] = 'collecting' if ir and min(ir[-rate:] or ir) >= FINGER_MIN_IR else 'no-finger'
        result['finger'] = result['quality'] == 'collecting'
        return result
    recent = ir[-rate:]
    if sum(recent) / len(recent) < FINGER_MIN_IR:
        return result
    result['finger'] = True
    # solo el tramo continuo con dedo puesto
    start = len(ir)
    while start > 0 and ir[start - 1] >= FINGER_MIN_IR:
        start -= 1
    red, ir = red[start:], ir[start:]
    result['seconds'] = round(len(ir) / rate, 1)
    if len(ir) < rate * 4:
        result['quality'] = 'collecting'
        return result

    # componente pulsátil: se quita la línea de base (media de 1 s) y se suaviza
    def pulsatile(x):
        base = _moving_average(x, rate)
        ac = [a - b for a, b in zip(x, base)]
        return _moving_average(ac, 3), base

    ac_ir, dc_ir = pulsatile(ir)
    ac_red, dc_red = pulsatile(red)
    skip = rate  # el primer segundo no tiene línea de base completa
    ac_ir, dc_ir, ac_red, dc_red = ac_ir[skip:], dc_ir[skip:], ac_red[skip:], dc_red[skip:]

    # cada latido baja la señal IR (más sangre absorbe más luz): se buscan valles
    sig = [-v for v in ac_ir]
    mean = sum(sig) / len(sig)
    sd = math.sqrt(sum((v - mean) ** 2 for v in sig) / len(sig)) or 1.0
    min_gap = int(rate * 60 / 200)  # como mucho 200 lpm
    peaks = []
    for i in range(1, len(sig) - 1):
        if sig[i] > mean + 0.4 * sd and sig[i] >= sig[i - 1] and sig[i] > sig[i + 1]:
            if peaks and i - peaks[-1] < min_gap:
                if sig[i] > sig[peaks[-1]]:
                    peaks[-1] = i
                continue
            peaks.append(i)

    intervals = [(b - a) / rate for a, b in zip(peaks, peaks[1:])]
    if len(intervals) < 3:
        result['quality'] = 'weak'
        return result
    med = _median(intervals)
    spread = _median([abs(x - med) for x in intervals]) / med
    if spread > 0.15:
        result['quality'] = 'noisy'
        return result
    # con latidos regulares, el periodo medio del tramo completo evita el
    # redondeo a muestras enteras de cada intervalo suelto
    period = (peaks[-1] - peaks[0]) / (len(peaks) - 1) / rate
    bpm = 60 / period
    if not 35 <= bpm <= 200 or _autocorr(sig, round(period * rate)) < 0.5:
        result['quality'] = 'noisy'
        return result
    result['bpm'] = round(bpm)
    result['quality'] = 'good'

    # SpO2 por «razón de razones», latido a latido: entre dos valles se traza la
    # recta que los une (quita la deriva lenta) y la amplitud es lo que sube
    # sobre ella. Aproximación empírica habitual, sin calibrar.
    sm_ir = _moving_average(ir, 3)[skip:]
    sm_red = _moving_average(red, 3)[skip:]

    def valley(x, i):
        lo, hi = max(0, i - 2), min(len(x), i + 3)
        return min(range(lo, hi), key=lambda k: x[k])

    def beat_ratio(x, a, b):
        ya, yb = x[a], x[b]
        rise = max(x[k] - (ya + (yb - ya) * (k - a) / (b - a)) for k in range(a, b + 1))
        dc = sum(x[a:b + 1]) / (b - a + 1)
        return rise / dc if dc > 0 else 0

    ratios = []
    for a, b in zip(peaks, peaks[1:]):
        ai, bi = valley(sm_ir, a), valley(sm_ir, b)
        ar, br = valley(sm_red, a), valley(sm_red, b)
        if bi - ai < 2 or br - ar < 2:
            continue
        ri, rr = beat_ratio(sm_ir, ai, bi), beat_ratio(sm_red, ar, br)
        if ri > 0:
            ratios.append(rr / ri)
    if len(ratios) >= 3:
        r = _median(ratios)
        if 0.3 <= r <= 1.2:
            result['spo2'] = round(min(100.0, 110 - 25 * r))
            result['ratio'] = round(r, 3)
    return result


# -------------------------------------------------------------------- enlace --

def find_port():
    """Primer Arduino conectado: primero por nombre estable, después ttyACM/ttyUSB."""
    for pattern in ('/dev/serial/by-id/*rduino*', '/dev/serial/by-id/*', '/dev/ttyACM*', '/dev/ttyUSB*'):
        found = sorted(glob.glob(pattern))
        if found:
            return found[0]
    return None


class StationLink:
    """Lee el Arduino en segundo plano y se reconecta solo si se desenchufa."""

    def __init__(self, port=None, clock=time.monotonic):
        self.port = port
        self.clock = clock
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = None
        self.connected = False
        self.port_in_use = None
        self.status = None
        self.env = None
        self.env_at = None
        self.card = None
        self.card_at = None
        self.red = deque(maxlen=PPG_RATE * PPG_WINDOW_S)
        self.ir = deque(maxlen=PPG_RATE * PPG_WINDOW_S)
        self.ppg_at = None
        self.ppg_total = 0  # muestras recibidas desde el arranque (para la onda en directo)
        self.last_error = None

    # -- datos entrantes (también usado por los tests)
    def feed(self, line):
        msg = parse_line(line)
        if not msg:
            return
        now = self.clock()
        with self.lock:
            if msg['type'] == 'ppg':
                if self.ppg_at is not None and now - self.ppg_at > 2:
                    self.red.clear()
                    self.ir.clear()
                self.red.append(msg['red'])
                self.ir.append(msg['ir'])
                self.ppg_at = now
                self.ppg_total += 1
            elif msg['type'] == 'env':
                self.env, self.env_at = msg, now
            elif msg['type'] == 'card':
                self.card, self.card_at = msg['uid'], now
            elif msg['type'] == 'status':
                self.status = msg

    def ir_since(self, total):
        """Muestras IR llegadas después del contador `total`: (nuevo_total, muestras)."""
        with self.lock:
            new = min(self.ppg_total - total, len(self.ir))
            return self.ppg_total, (list(self.ir)[-new:] if new > 0 else [])

    def read(self):
        """Foto del estado actual, lista para JSON."""
        now = self.clock()
        with self.lock:
            out = {'connected': self.connected, 'port': self.port_in_use,
                   'firmware': self.status['firmware'] if self.status else None,
                   'modules': dict(self.status['modules']) if self.status else {},
                   'environment': None, 'card': None, 'pulse': None, 'error': self.last_error}
            if self.env and now - self.env_at <= ENV_MAX_AGE_S:
                temp = self.env['aht_temperature_c']
                if temp is None:
                    temp = self.env['bmp_temperature_c']
                out['environment'] = {'temperature_c': temp, 'humidity_pct': self.env['humidity_pct'],
                                      'pressure_hpa': self.env['pressure_hpa'], 'age_s': round(now - self.env_at, 1)}
            if self.card and now - self.card_at <= CARD_SHOW_S:
                out['card'] = {'uid': self.card, 'age_s': round(now - self.card_at, 1)}
            if self.ppg_at is not None and now - self.ppg_at <= 2:
                out['pulse'] = analyze_ppg(list(self.red), list(self.ir))
            elif out['modules'].get('ppg'):
                out['pulse'] = {'finger': False, 'bpm': None, 'spo2': None, 'quality': 'no-data', 'seconds': 0}
        return out

    # -- hilo de lectura
    def start(self):
        self.thread = threading.Thread(target=self._run, name='xpaze-station', daemon=True)
        self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)

    def _run(self):
        import serial  # pyserial
        while not self.stop_event.is_set():
            port = self.port or find_port()
            if not port:
                self.last_error = 'Arduino no conectado'
                self.stop_event.wait(3)
                continue
            try:
                with serial.Serial(port, BAUD, timeout=1) as ser:
                    with self.lock:
                        self.connected, self.port_in_use, self.last_error = True, port, None
                    ser.reset_input_buffer()
                    ser.write(b'?')
                    while not self.stop_event.is_set():
                        raw = ser.readline()
                        if raw:
                            self.feed(raw.decode('ascii', 'replace'))
            except Exception as exc:  # desenchufado, permisos, puerto ocupado…
                self.last_error = f'{type(exc).__name__}: {exc}'[:160]
            with self.lock:
                self.connected, self.port_in_use = False, None
            self.stop_event.wait(3)


def main():
    import argparse
    import json
    parser = argparse.ArgumentParser(description='Lecturas en directo de la XPaze Station')
    parser.add_argument('--port', help='Puerto serie (por defecto, el primero que aparezca)')
    args = parser.parse_args()
    link = StationLink(args.port).start()
    try:
        while True:
            time.sleep(1)
            print(json.dumps(link.read(), ensure_ascii=False), flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        link.stop()


if __name__ == '__main__':
    main()

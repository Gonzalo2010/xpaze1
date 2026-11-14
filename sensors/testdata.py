"""Datos de prueba para la demo sin hardware.

Genera las MISMAS líneas que el firmware del Arduino (S, E, P, C) y las pasa
por StationLink.feed, así que el análisis es el real; solo la señal es
inventada. También imita al reloj. Todo se marca como prueba en la API.
"""
import math
import random
import threading
import time

from station import PPG_RATE

# UID de las tarjetas de la tripulación de la demo (crew.js)
CREW_UIDS = ['04A37F1C', '045BE290', '04C819D4', '04E1663A']
CYCLE_S = 40       # cada ciclo: tarjeta, 28 s con el dedo puesto y 12 s sin él
FINGER_S = 28


class TestFeeder:
    def __init__(self, link, seed=7):
        self.link = link
        self.rnd = random.Random(seed)
        self.stop_event = threading.Event()
        self.thread = None
        self.t0 = time.monotonic()
        self.bpm = 68.0

    def start(self):
        self.link.connected = True
        self.link.port_in_use = 'datos de prueba'
        self.link.feed('S,xpaze-station-1.0 (prueba),aht=1,bmp=1,ppg=1,rfid=1,rc522=92')
        self.thread = threading.Thread(target=self._run, name='xpaze-testdata', daemon=True)
        self.thread.start()
        return self

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=3)

    def current_bpm(self):
        return self.bpm

    def _run(self):
        n = 0
        phase = 0.0
        last_env = last_status = -99.0
        last_cycle = -1
        while not self.stop_event.is_set():
            t = time.monotonic() - self.t0
            cycle, within = int(t // CYCLE_S), t % CYCLE_S
            if cycle != last_cycle:
                last_cycle = cycle
                self.bpm = 62 + self.rnd.random() * 16
                self.link.feed(f'C,{CREW_UIDS[cycle % len(CREW_UIDS)]}')
            if t - last_env >= 2:
                last_env = t
                temp = 22.4 + 0.3 * math.sin(t / 120) + self.rnd.gauss(0, 0.03)
                self.link.feed(f'E,{int(t * 1000)},{temp:.2f},{41 + math.sin(t / 90):.2f},{temp + 0.6:.2f},{1012.6 + 0.2 * math.sin(t / 300):.2f}')
            if t - last_status >= 10:
                last_status = t
                self.link.feed('S,xpaze-station-1.0 (prueba),aht=1,bmp=1,ppg=1,rfid=1,rc522=92')
            # pulsioxímetro: con dedo, latidos; sin dedo, solo luz ambiente
            if within < FINGER_S:
                phase = (phase + self.bpm / 60 / PPG_RATE) % 1
                beat = math.exp(-((phase - 0.2) ** 2) / 0.006)
                drift = 300 * math.sin(2 * math.pi * 0.22 * n / PPG_RATE)
                ir = 102000 + drift - 850 * beat + self.rnd.gauss(0, 35)
                red = 81000 + drift * 0.8 - 850 * 0.52 * 0.8 * beat + self.rnd.gauss(0, 35)
            else:
                ir, red = 900 + self.rnd.gauss(0, 20), 700 + self.rnd.gauss(0, 20)
            self.link.feed(f'P,{int(red)},{int(ir)}')
            n += 1
            self.stop_event.wait(1 / PPG_RATE)


class FakeWatch:
    """Imita a WatchReceiver.read()/request_spo2() con valores plausibles."""

    def __init__(self, feeder):
        self.feeder = feeder
        self.spo2_started = None
        self.rnd = random.Random(11)

    def start(self):
        return self

    def stop(self):
        pass

    def request_spo2(self):
        self.spo2_started = time.monotonic()
        return True

    def read(self):
        from datetime import datetime, timezone
        bpm = round(self.feeder.current_bpm() + self.rnd.uniform(-1.5, 1.5))
        out = {'connected': True, 'device': 'Galaxy Watch (prueba)', 'bpm': bpm, 'ibi_ms': round(60000 / bpm),
               'skin_c': round(33.6 + self.rnd.uniform(-0.1, 0.1), 2), 'spo2': None, 'spo2_status': None,
               'battery_pct': 78, 'observed_at': datetime.now(timezone.utc).isoformat()}
        if self.spo2_started is not None:
            age = time.monotonic() - self.spo2_started
            if age < 30:
                out['spo2_status'] = 'measuring'
            elif age < 600:
                out['spo2'], out['spo2_status'] = 97, 'complete'
        return out

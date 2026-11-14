import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sensors'))
from station import PPG_RATE, StationLink, analyze_ppg, parse_line


def synth(bpm=72, seconds=8, r=0.5, noise=40, seed=1):
    """Señal tipo pulsioxímetro: cada latido baja la luz recibida."""
    rnd = random.Random(seed)
    red, ir = [], []
    for i in range(int(seconds * PPG_RATE)):
        t = i / PPG_RATE
        phase = (t * bpm / 60) % 1
        beat = math.exp(-((phase - 0.2) ** 2) / 0.006)  # golpe sistólico
        drift = 300 * math.sin(2 * math.pi * 0.2 * t)    # respiración
        ir.append(int(100000 + drift - 800 * beat + rnd.gauss(0, noise)))
        red.append(int(80000 + drift * 0.8 - 800 * r * 0.8 * beat + rnd.gauss(0, noise)))
    return red, ir


class ParseTests(unittest.TestCase):
    def test_lines(self):
        self.assertEqual(parse_line('P,81234,102345\r\n'), {'type': 'ppg', 'red': 81234, 'ir': 102345})
        env = parse_line('E,12000,22.51,41.20,23.10,1013.25')
        self.assertEqual(env['humidity_pct'], 41.2)
        self.assertEqual(env['pressure_hpa'], 1013.25)
        self.assertIsNone(parse_line('E,12000,nan,nan,23.10,1013.25')['aht_temperature_c'])
        self.assertEqual(parse_line('C,04A37F1C'), {'type': 'card', 'uid': '04A37F1C'})
        st = parse_line('S,xpaze-station-1.0,aht=1,bmp=0,ppg=1,rfid=1,rc522=92')
        self.assertEqual(st['modules'], {'aht': True, 'bmp': False, 'ppg': True, 'rfid': True, 'rc522': '92'})

    def test_garbage(self):
        for line in ['', 'hola', 'P,1', 'P,a,b', 'C,xyz', 'E,1,2', '\x00\xff']:
            self.assertIsNone(parse_line(line))


class PulseTests(unittest.TestCase):
    def test_heart_rate(self):
        for bpm in (55, 72, 95, 120):
            red, ir = synth(bpm=bpm)
            out = analyze_ppg(red, ir)
            self.assertTrue(out['finger'])
            self.assertEqual(out['quality'], 'good', (bpm, out))
            self.assertLessEqual(abs(out['bpm'] - bpm), 3, (bpm, out))

    def test_spo2_follows_ratio(self):
        high = analyze_ppg(*synth(r=0.5))['spo2']
        low = analyze_ppg(*synth(r=0.9))['spo2']
        self.assertTrue(95 <= high <= 100, high)
        self.assertTrue(85 <= low <= 90, low)

    def test_no_finger(self):
        out = analyze_ppg([900] * 200, [1200] * 200)
        self.assertEqual((out['finger'], out['bpm'], out['quality']), (False, None, 'no-finger'))

    def test_collecting_and_noise(self):
        red, ir = synth(seconds=2)
        self.assertIsNone(analyze_ppg(red, ir)['bpm'])
        rnd = random.Random(3)
        noisy = [100000 + int(rnd.gauss(0, 900)) for _ in range(200)]
        self.assertIsNone(analyze_ppg(noisy, noisy)['bpm'])


class LinkTests(unittest.TestCase):
    def test_snapshot(self):
        now = [100.0]
        link = StationLink(clock=lambda: now[0])
        link.feed('S,xpaze-station-1.0,aht=1,bmp=1,ppg=1,rfid=1,rc522=92')
        link.feed('E,5000,22.5,40.0,23.0,1012.4')
        link.feed('C,04A37F1C')
        red, ir = synth()
        for a, b in zip(red, ir):
            link.feed(f'P,{a},{b}')
        snap = link.read()
        self.assertEqual(snap['environment']['temperature_c'], 22.5)
        self.assertEqual(snap['card']['uid'], '04A37F1C')
        self.assertEqual(snap['pulse']['quality'], 'good')
        now[0] += 60  # todo caduca
        snap = link.read()
        self.assertIsNone(snap['environment'])
        self.assertIsNone(snap['card'])
        self.assertEqual(snap['pulse']['quality'], 'no-data')


if __name__ == '__main__':
    unittest.main()

import struct
import sys
import time
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sensors'))
from watch import WatchReceiver, decode_hr, decode_spo2, decode_status, decode_temp


class WatchTests(unittest.TestCase):
    def test_hr_packet(self):
        self.assertEqual(decode_hr(struct.pack('<Ihh', 0xffffffff, 72, 830)),
                         {'watch_elapsed_ms': 0xffffffff, 'bpm': 72, 'ibi_ms': 830})
        self.assertIsNone(decode_hr(struct.pack('<Ihh', 0, 0, -1))['bpm'])
        with self.assertRaises(ValueError):
            decode_hr(b'\x01')

    def test_other_packets(self):
        self.assertEqual(decode_temp(struct.pack('<Iff', 1, 33.5, 24.0)), {'skin_c': 33.5, 'ambient_c': 24.0})
        self.assertIsNone(decode_temp(struct.pack('<Iff', 1, -5.0, 24.0))['skin_c'])
        self.assertEqual(decode_spo2(struct.pack('<Iiii', 1, 2, 97, 64)), {'status': 'complete', 'spo2': 97, 'bpm': 64})
        self.assertEqual(decode_spo2(struct.pack('<Iiii', 1, 0, 0, 0))['status'], 'measuring')
        st = decode_status(struct.pack('<IhBBBBhi', 9, 3, 81, 1, 25, 0, 0, 0))
        self.assertEqual((st['battery_pct'], st['streaming'], st['dropped']), (81, True, 3))
        for dec in (decode_temp, decode_spo2, decode_status):
            with self.assertRaises(ValueError):
                dec(b'\x00\x01')

    def test_only_connected_recent_valid_data(self):
        r = WatchReceiver()
        self.assertIsNone(r.address)  # «auto»: se busca por el servicio
        r.on_hr(None, struct.pack('<Ihh', 1, 72, 830))
        self.assertIsNone(r.read())  # sin conexión no se informa nada
        r.connected = True
        self.assertEqual(r.read()['bpm'], 72)
        r.hr = (time.monotonic() - 60, r.hr[1])
        self.assertIsNone(r.read()['bpm'])  # lectura caducada
        r.on_hr(None, b'\x00')  # paquete corrupto: se ignora
        self.assertIsNone(r.read()['bpm'])


class TestDataTests(unittest.TestCase):
    def test_feeder_goes_through_real_analysis(self):
        from station import StationLink
        from testdata import FakeWatch, TestFeeder
        link = StationLink()
        feeder = TestFeeder(link)
        feeder.start()
        time.sleep(0.3)
        feeder.stop()
        snap = link.read()
        self.assertTrue(snap['connected'])
        self.assertIn('prueba', snap['firmware'])
        self.assertEqual(snap['card']['uid'], '04A37F1C')
        self.assertIsNotNone(snap['environment']['temperature_c'])
        w = FakeWatch(feeder).read()
        self.assertTrue(55 <= w['bpm'] <= 85)


if __name__ == '__main__':
    unittest.main()

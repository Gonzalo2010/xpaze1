import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'sensors'))
import ble_protocol as P


class BleProtocolTests(unittest.TestCase):
    """Los mismos bytes que descodifica tests/app.test.js (prueba cruzada Python ↔ JS)."""

    def test_vectors(self):
        self.assertEqual(P.encode_vitals(0xb7, {'quality': 'noisy'},
                                         {'temperature_c': 22.71, 'humidity_pct': 41.9, 'pressure_hpa': 1012.7}).hex(),
                         'b7040000df085e108f27')
        self.assertEqual(P.encode_card({'uid': '04A37F1C', 'age_s': 0}).hex(), '003034413337463143')
        self.assertEqual(P.encode_watch({'bpm': 76, 'skin_c': 33.68, 'battery_pct': 78, 'spo2': None,
                                         'ibi_ms': 789}).hex(), '014c280d4e001503')
        station = {'connected': True, 'modules': {'aht': True, 'bmp': True, 'ppg': True, 'rfid': True}}
        self.assertEqual(P.encode_status(station, True, True).hex(), '7f010000')
        self.assertEqual(P.encode_wave(0xb8, [2693, 1336, 143]).hex(), 'b803850a38058f00')

    def test_limits(self):
        self.assertEqual(len(P.encode_wave(1, list(range(20)))), 18)  # como mucho 8 muestras
        self.assertEqual(P.encode_card(None), bytes([255]))
        self.assertEqual(len(P.encode_card({'uid': 'A' * 40, 'age_s': 999})), 21)
        self.assertEqual(P.encode_vitals(1, None, None)[4:].hex(), '0080ffffffff')
        for pkt in (P.encode_vitals(1, None, None), P.encode_watch(None), P.encode_status(None, False, False)):
            self.assertLessEqual(len(pkt), 20)


if __name__ == '__main__':
    unittest.main()

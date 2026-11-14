"""Protocolo Bluetooth LE de la XPaze Station (versión 1).

La Raspberry es el periférico GATT; la app (PWA) se conecta con Web Bluetooth.
Todos los paquetes caben en 20 bytes (el MTU mínimo) y son little-endian.
La misma definición está en src/app/protocol.js: cambiar las dos a la vez.

  VITALS  b5e70002  read/notify  10 B  u8 seq · u8 calidad · u8 lpm · u8 SpO2 ·
                                         i16 temp×100 · u16 humedad×100 · u16 presión×10
  WAVE    b5e70003  notify      ≤18 B  u8 seq · u8 n · n×i16 onda de pulso (componente pulsátil IR)
  CARD    b5e70004  read/notify ≤21 B  u8 edad s (255 = ninguna) · UID en ASCII
  WATCH   b5e70005  read/notify  8 B   u8 flags · u8 lpm · i16 piel×100 · u8 batería · u8 SpO2 · u16 IBI ms
  STATUS  b5e70006  read/notify  4 B   u8 flags · u8 versión · u16 reservado
  CONTROL b5e70007  write       1 B    0x01 medir SpO2 con el reloj · 0x02 reenviar todo

Valores ausentes: lpm/SpO2 = 0, temperaturas = −32768, humedad/presión = 0xFFFF,
batería = 255, IBI = 0.
"""
import struct

BASE = '-5a1e-4c3b-9d2f-6a8e7c1d0e01'
SERVICE = 'b5e70001' + BASE
VITALS = 'b5e70002' + BASE
WAVE = 'b5e70003' + BASE
CARD = 'b5e70004' + BASE
WATCH = 'b5e70005' + BASE
STATUS = 'b5e70006' + BASE
CONTROL = 'b5e70007' + BASE
VERSION = 1

QUALITY = ['no-data', 'no-finger', 'collecting', 'weak', 'noisy', 'good']
CMD_WATCH_SPO2 = 0x01
CMD_RESEND = 0x02

ST_ARDUINO, ST_AHT, ST_BMP, ST_PPG, ST_RFID, ST_TEST, ST_WATCH = (1 << i for i in range(7))
W_CONNECTED, W_SPO2_MEASURING = 1, 2

I16_NONE, U16_NONE = -32768, 0xFFFF


def _i16(v, k):
    return I16_NONE if v is None else max(-32767, min(32767, round(v * k)))


def _u16(v, k):
    return U16_NONE if v is None else max(0, min(0xFFFE, round(v * k)))


def _u8(v):
    return 0 if not v else max(0, min(255, round(v)))


def encode_vitals(seq, pulse, env):
    pulse = pulse or {}
    env = env or {}
    q = QUALITY.index(pulse.get('quality', 'no-data')) if pulse.get('quality') in QUALITY else 0
    return struct.pack('<BBBBhHH', seq & 0xFF, q, _u8(pulse.get('bpm')), _u8(pulse.get('spo2')),
                       _i16(env.get('temperature_c'), 100), _u16(env.get('humidity_pct'), 100),
                       _u16(env.get('pressure_hpa'), 10))


def encode_wave(seq, samples):
    samples = [max(-32767, min(32767, int(s))) for s in samples[:8]]
    return struct.pack(f'<BB{len(samples)}h', seq & 0xFF, len(samples), *samples)


def encode_card(card):
    if not card:
        return bytes([255])
    uid = card['uid'].encode('ascii')[:20]
    return bytes([min(254, int(card.get('age_s', 0)))]) + uid


def encode_watch(w):
    if not w:
        return struct.pack('<BBhBBH', 0, 0, I16_NONE, 255, 0, 0)
    flags = W_CONNECTED | (W_SPO2_MEASURING if w.get('spo2_status') == 'measuring' else 0)
    battery = w.get('battery_pct')
    return struct.pack('<BBhBBH', flags, _u8(w.get('bpm')), _i16(w.get('skin_c'), 100),
                       255 if battery is None else max(0, min(100, int(battery))),
                       _u8(w.get('spo2')), min(0xFFFF, int(w.get('ibi_ms') or 0)))


def encode_status(station, watch_connected, test):
    f = 0
    if station and station.get('connected'):
        f |= ST_ARDUINO
        m = station.get('modules', {})
        f |= (ST_AHT if m.get('aht') else 0) | (ST_BMP if m.get('bmp') else 0)
        f |= (ST_PPG if m.get('ppg') else 0) | (ST_RFID if m.get('rfid') else 0)
    f |= (ST_TEST if test else 0) | (ST_WATCH if watch_connected else 0)
    return struct.pack('<BBH', f, VERSION, 0)

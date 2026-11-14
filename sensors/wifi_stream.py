"""Lecturas en directo por WiFi para la app (Server-Sent Events en /api/stream).

Mismo contenido que el periférico Bluetooth (ble_server.py), pero ya
descodificado en JSON con la forma que esperan src/app/link.js y protocol.js:
  vitals  {seq, quality, bpm, spo2, temperature, humidity, pressure}   1 Hz
  wave    {seq, samples}                                              ~8 Hz (≈25 muestras/s)
  card    {uid, age} | null                                            al cambiar
  watch   {bpm, skin, battery, spo2, spo2Measuring, ibi} | null        1 Hz
  status  {arduino, aht, bmp, ppg, rfid, test, watch, version}         1 Hz
"""
import json
import time

FAST_S = 0.12
SLOW_EVERY = 8  # ≈ 1 s


def _vitals(seq, pulse, env):
    pulse, env = pulse or {}, env or {}
    return {'seq': seq, 'quality': pulse.get('quality', 'no-data'), 'bpm': pulse.get('bpm'), 'spo2': pulse.get('spo2'),
            'temperature': env.get('temperature_c'), 'humidity': env.get('humidity_pct'), 'pressure': env.get('pressure_hpa')}


def _watch(w):
    if not w:
        return None
    return {'bpm': w.get('bpm'), 'skin': w.get('skin_c'), 'battery': w.get('battery_pct'), 'spo2': w.get('spo2'),
            'spo2Measuring': w.get('spo2_status') == 'measuring', 'ibi': w.get('ibi_ms')}


def _status(st, watch_on, test):
    st = st or {}
    m = st.get('modules') or {}
    on = bool(st.get('connected'))
    return {'arduino': on, 'aht': on and bool(m.get('aht')), 'bmp': on and bool(m.get('bmp')),
            'ppg': on and bool(m.get('ppg')), 'rfid': on and bool(m.get('rfid')),
            'test': bool(test), 'watch': bool(watch_on), 'version': 1}


def events(station_fn, snapshot_fn, test, alive=lambda: True):
    """Generador de líneas SSE ya formateadas; termina cuando alive() es falso."""
    seq = wave_seq = 0
    total = None
    hp = None
    last_card = object()
    tick = 0
    while alive():
        station = station_fn()
        if station is not None:
            if total is None:
                total = station.ppg_total  # empezar por lo nuevo
            total, samples = station.ir_since(total)
            out = []
            for x in samples:
                hp = x if hp is None or abs(x - hp) > 50000 else hp + (x - hp) / 12
                out.append(round(-(x - hp) * 4))
            for i in range(0, len(out), 8):
                wave_seq = (wave_seq + 1) & 0xFF
                yield _sse('wave', {'seq': wave_seq, 'samples': out[i:i + 8]})
        if tick % SLOW_EVERY == 0:
            snap = snapshot_fn()
            st = snap.get('station') or {}
            seq = (seq + 1) & 0xFF
            yield _sse('vitals', _vitals(seq, st.get('pulse'), snap.get('environment')))
            yield _sse('watch', _watch(snap.get('watch')))
            yield _sse('status', _status(st, bool(snap.get('watch')), test))
            card = st.get('card')
            uid = card['uid'] if card else None
            if uid != last_card:
                yield _sse('card', {'uid': uid, 'age': int(card.get('age_s', 0))} if card else None)
                last_card = uid
        tick += 1
        time.sleep(FAST_S)


def _sse(kind, data):
    return f'data: {json.dumps({"type": kind, "data": data}, allow_nan=False)}\n\n'.encode()

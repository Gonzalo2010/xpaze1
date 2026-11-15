#!/bin/sh
# Vigilante de la XPaze Station (lo arranca xpaze-arduino.service como root).
# Espera a que el Arduino esté conectado y ESTABLE (20 s sin desconectarse). Entonces:
#   1. si no lleva el firmware de XPaze, lo graba (arduino-cli, placa Uno);
#   2. lee la línea de estado «S,…» para saber qué sensores responden;
#   3. pasa el puente a modo real (sin --test-data) y lo reinicia.
# Si el Arduino se desconecta, el puente vuelve a datos de prueba. Todo queda en el diario:
#   journalctl -u xpaze-arduino -f      y el resumen en /home/xpaze/xpaze/station-status.txt
set -u
HOME_X=/home/xpaze
CLI=$HOME_X/.local/bin/arduino-cli
SKETCH=$HOME_X/xpaze/firmware/xpaze-station
PY=$HOME_X/xpaze/.venv-sensors/bin/python
STATUS=$HOME_X/xpaze/station-status.txt
DROPIN=/etc/systemd/system/xpaze-sensors.service.d/modo.conf
AI=${AI:-https://xpaze.es/app}
mode=""

port() { ls /dev/serial/by-id/* /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -1; }

read_status() { # imprime la línea S,… si el Arduino la manda en 6 s (se resetea al abrir el puerto)
  "$PY" - "$1" <<'PYEOF'
import sys, time, serial
try:
    s = serial.Serial(sys.argv[1], 115200, timeout=1)
except Exception as e:
    print('ERR', e); sys.exit(0)
t = time.time()
while time.time() - t < 6:
    line = s.readline().decode(errors='ignore').strip()
    if line.startswith('S,'):
        print(line); break
PYEOF
}

set_mode() { # $1 = real | test
  [ "$mode" = "$1" ] && return
  flags="--lan --ble --ai $AI"
  [ "$1" = test ] && flags="--test-data $flags"
  mkdir -p "$(dirname "$DROPIN")"
  printf '# Modo del puente (lo cambia xpaze-arduino.service)\n[Service]\nExecStart=\nExecStart=%s %s/xpaze/sensors/bridge.py %s\n' "$PY" "$HOME_X" "$flags" > "$DROPIN"
  systemctl daemon-reload && systemctl restart xpaze-sensors
  mode=$1
  echo "puente en modo $1"
}

echo "vigilante en marcha"
while :; do
  p=$(port)
  if [ -z "$p" ]; then
    [ "$mode" = real ] && { echo "Arduino desconectado"; set_mode test; }
    sleep 3; continue
  fi
  [ "$mode" = real ] && { sleep 5; continue; }
  # estable 20 s
  ok=1; i=0
  while [ $i -lt 10 ]; do sleep 2; [ -e "$p" ] || { ok=0; break; }; i=$((i+1)); done
  if [ $ok = 0 ]; then echo "el Arduino se ha desconectado antes de 20 s (¿alimentación?)"; continue; fi
  systemctl stop xpaze-sensors   # suelta el puerto
  s=$(read_status "$p")
  if ! echo "$s" | grep -q '^S,'; then
    echo "sin firmware de XPaze en $p: grabando…"
    # placa Uno; algunos clones con CH340 llevan el cargador del Nano antiguo (57600 baudios)
    if runuser -u xpaze -- "$CLI" compile --upload -p "$p" --fqbn arduino:avr:uno "$SKETCH" > /tmp/xpaze-upload.log 2>&1 \
       || runuser -u xpaze -- "$CLI" compile --upload -p "$p" --fqbn arduino:avr:nano:cpu=atmega328old "$SKETCH" >> /tmp/xpaze-upload.log 2>&1; then
      echo "firmware grabado"; sleep 3; s=$(read_status "$p")
    else
      echo "falló la grabación (detalle en /tmp/xpaze-upload.log)"; tail -3 /tmp/xpaze-upload.log
      systemctl start xpaze-sensors; sleep 15; continue
    fi
  fi
  echo "estado: ${s:-sin respuesta}"
  { date '+%F %T'; echo "puerto: $p"; echo "estado: ${s:-sin respuesta}"; } > "$STATUS"
  if echo "$s" | grep -q '^S,'; then set_mode real; else systemctl start xpaze-sensors; sleep 15; fi
done

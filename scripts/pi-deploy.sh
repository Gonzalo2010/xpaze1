#!/bin/sh
# Actualiza la Raspberry Pi de la XPaze Station (por Tailscale) y deja el puente en modo WiFi.
#
#   sh scripts/pi-deploy.sh            datos de prueba (sin Arduino)
#   sh scripts/pi-deploy.sh real       Arduino real por USB
#
# El móvil abre la app en http://<IP de la Pi en la WiFi>:8765/app/.
# IA: por defecto la de xpaze.es (necesita Internet en la Pi).
# Para la demo sin Internet, levanta server/psicologa.js con PSICOLOGA_PROVIDER=ollama en un portátil
# de la misma WiFi y pasa su URL: AI=http://IP-DEL-PORTATIL:5193 sh scripts/pi-deploy.sh
set -e
cd "$(dirname "$0")/.."
PI=${PI:?Indica la IP de la Raspberry Pi: PI=… sh scripts/pi-deploy.sh}
AI=${AI:-https://xpaze.es/app}
MODE=${1:-test}
FLAGS="--lan --ble --ai $AI"
[ "$MODE" = "test" ] && FLAGS="--test-data $FLAGS"

npx vite build --outDir .dist-pi --emptyOutDir >/dev/null   # nunca en dist/: puede ser la web publicada
rsync -a --delete .dist-pi/ "xpaze@$PI:xpaze/dist/"
rsync -a --exclude __pycache__ sensors/ "xpaze@$PI:xpaze/sensors/"
rsync -a firmware/ "xpaze@$PI:xpaze/firmware/"
ssh "root@$PI" "cat > /etc/systemd/system/xpaze-sensors.service.d/modo.conf <<EOF
# Modo del puente (scripts/pi-deploy.sh $MODE)
[Service]
ExecStart=
ExecStart=/home/xpaze/xpaze/.venv-sensors/bin/python /home/xpaze/xpaze/sensors/bridge.py $FLAGS
EOF
systemctl daemon-reload && systemctl restart xpaze-sensors && sleep 4 && systemctl is-active xpaze-sensors && journalctl -u xpaze-sensors -n 4 --no-pager -o cat
ip -4 -o addr show wlan0 | awk '{print \"App en el móvil: http://\" substr(\$4, 1, index(\$4, \"/\") - 1) \":8765/app/\"}'"

# Sensores de la XPaze Station

Montaje: **los sensores van al Arduino Uno R3, y el Arduino va a la Raspberry Pi por USB.** El Arduino solo lee y envía. La Pi interpreta las lecturas, calcula el pulso y el oxígeno y sirve la demo.

Son lecturas de un prototipo. No es un dispositivo médico.

## Conexiones

| Módulo | Pin del módulo | Pin del Arduino |
|---|---|---|
| RC522 (RFID) | SDA/SS · SCK · MOSI · MISO · RST · 3.3V · GND · IRQ | D10 · D13 · D11 · D12 · D9 · 3.3V · GND · libre |
| AHT20 + BMP280 | VIN · GND · SDA · SCL | 3.3V · GND · A4 · A5 |
| MAX3010x | VIN · GND · SDA · SCL · INT | 3.3V · GND · A4 · A5 · libre |

Direcciones I2C, sin conflictos entre ellas: AHT20 `0x38`, BMP280 `0x77` (o `0x76`), MAX3010x `0x57`.

Avisos de hardware:
- El RC522 funciona a 3,3 V, pero los pines SPI del Uno dan 5 V. Suele funcionar, pero lo correcto es poner un conversor de nivel o divisores resistivos en SCK, MOSI, SS y RST.
- El firmware desactiva las resistencias internas a 5 V del bus I2C, así el bus queda a 3,3 V con las de los propios módulos.
- El pin de 3,3 V del Uno da poca corriente. Con los tres módulos va justo pero sirve; el LED del MAX3010x está en brillo medio.

## Firmware (`firmware/xpaze-station/`)

Envía una línea de texto por mensaje a 115200 baudios:

```
S,xpaze-station-1.0,aht=1,bmp=1,ppg=1,rfid=1,rc522=92   estado (al arrancar y cada 10 s)
E,<ms>,<temp AHT20>,<humedad>,<temp BMP280>,<presión>    ambiente, cada 2 s ("nan" si falta)
P,<rojo>,<infrarrojo>                                    pulsioxímetro, 25 muestras/s
C,<UID>                                                  tarjeta RFID
```

Si la Pi envía `?`, el Arduino responde con la línea `S`.

Para grabarlo desde la Raspberry, con el Arduino enchufado por USB:

```sh
export PATH=$HOME/.local/bin:$PATH
cd ~/xpaze/firmware/xpaze-station
arduino-cli compile --fqbn arduino:avr:uno .
sudo systemctl stop xpaze-sensors          # libera el puerto serie
arduino-cli upload --fqbn arduino:avr:uno -p /dev/ttyACM0 .   # los clones con CH340 salen como /dev/ttyUSB0
sudo systemctl start xpaze-sensors
```

Librerías: `MFRC522`, `Adafruit AHTX0`, `Adafruit BMP280 Library` y `SparkFun MAX3010x Pulse and Proximity Sensor Library`.

## Raspberry Pi

- `sensors/station.py` lee el Arduino en segundo plano y se reconecta solo si se desenchufa. Calcula:
  - **el pulso**, a partir de los valles de la señal infrarroja. Exige latidos regulares y una señal periódica; si no, no da número.
  - **el SpO₂ estimado**, por la «razón de razones» latido a latido (110 − 25·R). Esta fórmula no está calibrada para este sensor.
- Para probarlo por terminal: `~/xpaze/.venv-sensors/bin/python ~/xpaze/sensors/station.py`. Imprime un JSON por segundo.
- `sensors/bridge.py` es el servicio `xpaze-sensors`. Sirve la demo y `/api/sensors` **solo en 127.0.0.1:8765**. Si no hay Arduino, intenta leer el AHT20/BMP280 directamente por el I2C de la Pi (el montaje antiguo).
- En la demo (`http://127.0.0.1:8765/demo/`, abierta en la Pi o por túnel SSH), el botón «Leer en directo» muestra:
  - la tarjeta, con el nombre del astronauta si el UID coincide;
  - el pulso y el oxígeno;
  - la temperatura, la humedad y la presión de la cabina.

Túnel desde otro ordenador: `ssh -L 8765:127.0.0.1:8765 xpaze@<IP de la Pi>` y abrir `http://127.0.0.1:8765/demo/`.

## Reloj con TbWatchSensors (experimental)

Se activa con `bridge.py --watch` (necesita `bleak`). Sin dirección, busca el reloj por el servicio BLE de la app, porque Android cambia la dirección Bluetooth del reloj de vez en cuando; también se puede pasar una dirección fija.

Lee el pulso, la temperatura de la piel y la batería, y hace una medición de SpO₂ cuando se pide (unos 30 s). No guarda nada.

## Bluetooth para la app (`--ble`)

`sensors/ble_server.py` convierte la Raspberry en el periférico BLE «XPaze Station» (con la librería `bless`, sobre BlueZ). Así la app del móvil se conecta directamente, sin WiFi. Publica:

- las constantes, a 1 Hz;
- la onda de pulso, unas 25 muestras/s;
- la tarjeta;
- el reloj;
- el estado de los módulos.

También acepta órdenes, por ejemplo medir el SpO₂ con el reloj. El protocolo está en `sensors/ble_protocol.py`.

- Requisitos en la Pi: `pip install bless` en `.venv-sensors` y el usuario `xpaze` en el grupo `bluetooth`. Ya está hecho.
- Modo actual del servicio: `--test-data --ble` (drop-in `xpaze-sensors.service.d/modo.conf`). Cuando el Arduino esté conectado, deja solo `--ble`.

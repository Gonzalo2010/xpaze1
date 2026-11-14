// XPaze Station — firmware del Arduino Uno R3.
// Lee los sensores y los envía a la Raspberry Pi por USB (115200 baudios),
// una línea de texto por mensaje. La Pi hace todo el análisis.
//
// Conexiones
//   RC522 (SPI)        SDA/SS D10 · SCK D13 · MOSI D11 · MISO D12 · RST D9 · 3.3V · GND · IRQ libre
//   AHT20 + BMP280     SDA A4 · SCL A5 · VIN 3.3V · GND
//   MAX3010x           SDA A4 · SCL A5 · VIN 3.3V · GND · INT libre
//
// Protocolo (Arduino → Pi)
//   S,<firmware>,aht=<0|1>,bmp=<0|1>,ppg=<0|1>,rfid=<0|1>,rc522=<versión hex>
//   E,<ms>,<temp AHT20 °C>,<humedad %>,<temp BMP280 °C>,<presión hPa>   cada 2 s ("nan" si falta)
//   P,<rojo>,<infrarrojo>                                               25 muestras/s del pulsioxímetro
//   C,<UID hex>                                                          al acercar una tarjeta
// Protocolo (Pi → Arduino)
//   ?  → vuelve a enviar la línea S

#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_AHTX0.h>
#include <Adafruit_BMP280.h>
#include <MAX30105.h>

#define FIRMWARE "xpaze-station-1.0"
#define PIN_RC522_SS 10
#define PIN_RC522_RST 9

const unsigned long ENV_EVERY_MS = 2000;
const unsigned long RFID_EVERY_MS = 150;
const unsigned long STATUS_EVERY_MS = 10000;
const unsigned long SAME_CARD_MS = 2000;

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
Adafruit_AHTX0 aht;
Adafruit_BMP280 bmp;
MAX30105 ppg;

bool hasAht = false, hasBmp = false, hasPpg = false, hasRfid = false;
byte rc522Version = 0;
unsigned long lastEnv = 0, lastRfid = 0, lastStatus = 0, lastCardAt = 0;
char lastCard[21] = "";

void printStatus() {
  Serial.print(F("S," FIRMWARE ",aht="));
  Serial.print(hasAht);
  Serial.print(F(",bmp="));
  Serial.print(hasBmp);
  Serial.print(F(",ppg="));
  Serial.print(hasPpg);
  Serial.print(F(",rfid="));
  Serial.print(hasRfid);
  Serial.print(F(",rc522="));
  Serial.println(rc522Version, HEX);
}

bool startBmp() {
  // las placas combinadas usan 0x77; algunas 0x76. Algunos «BMP280» responden como BME280.
  const uint8_t addrs[] = { 0x77, 0x76 };
  const uint8_t ids[] = { BMP280_CHIPID, 0x60 };
  for (uint8_t a = 0; a < 2; a++)
    for (uint8_t i = 0; i < 2; i++)
      if (bmp.begin(addrs[a], ids[i])) return true;
  return false;
}

void setup() {
  Serial.begin(115200);

  Wire.begin();
  // Wire activa las resistencias internas a 5 V en A4/A5. Los módulos ya llevan
  // las suyas a 3,3 V: se desactivan para no subir el bus por encima de 3,3 V.
  digitalWrite(SDA, LOW);
  digitalWrite(SCL, LOW);

  SPI.begin();
  rfid.PCD_Init();
  rc522Version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  hasRfid = rc522Version != 0x00 && rc522Version != 0xFF;

  hasAht = aht.begin();

  hasBmp = startBmp();
  if (hasBmp) {
    bmp.setSampling(Adafruit_BMP280::MODE_NORMAL, Adafruit_BMP280::SAMPLING_X2,
                    Adafruit_BMP280::SAMPLING_X16, Adafruit_BMP280::FILTER_X16,
                    Adafruit_BMP280::STANDBY_MS_500);
  }

  hasPpg = ppg.begin(Wire, I2C_SPEED_STANDARD);
  if (hasPpg) {
    // brillo 60 (~12 mA), media de 4, rojo + IR, 100 Hz → 25 muestras/s, 411 µs, rango 4096 nA
    ppg.setup(60, 4, 2, 100, 411, 4096);
  }

  printStatus();
  lastStatus = millis();
}

void sendEnvironment(unsigned long now) {
  float t = NAN, h = NAN, bt = NAN, bp = NAN;
  if (hasAht) {
    sensors_event_t hum, temp;
    if (aht.getEvent(&hum, &temp)) { t = temp.temperature; h = hum.relative_humidity; }
  }
  if (hasBmp) {
    bt = bmp.readTemperature();
    bp = bmp.readPressure() / 100.0;
  }
  Serial.print(F("E,"));
  Serial.print(now);
  Serial.print(',');
  Serial.print(t, 2);
  Serial.print(',');
  Serial.print(h, 2);
  Serial.print(',');
  Serial.print(bt, 2);
  Serial.print(',');
  Serial.println(bp, 2);
}

void checkCard(unsigned long now) {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  char uid[21];
  byte n = min(rfid.uid.size, (byte)10);
  for (byte i = 0; i < n; i++) {
    const char *hex = "0123456789ABCDEF";
    uid[i * 2] = hex[rfid.uid.uidByte[i] >> 4];
    uid[i * 2 + 1] = hex[rfid.uid.uidByte[i] & 0x0F];
  }
  uid[n * 2] = '\0';
  rfid.PICC_HaltA();
  // la misma tarjeta apoyada no se repite cada 150 ms
  if (strcmp(uid, lastCard) == 0 && now - lastCardAt < SAME_CARD_MS) { lastCardAt = now; return; }
  strcpy(lastCard, uid);
  lastCardAt = now;
  Serial.print(F("C,"));
  Serial.println(uid);
}

void loop() {
  unsigned long now = millis();

  if (hasPpg) {
    ppg.check();
    while (ppg.available()) {
      Serial.print(F("P,"));
      Serial.print(ppg.getFIFORed());
      Serial.print(',');
      Serial.println(ppg.getFIFOIR());
      ppg.nextSample();
    }
  }

  if (hasRfid && now - lastRfid >= RFID_EVERY_MS) { lastRfid = now; checkCard(now); }
  if (now - lastEnv >= ENV_EVERY_MS) { lastEnv = now; sendEnvironment(now); }
  if (now - lastStatus >= STATUS_EVERY_MS) { lastStatus = now; printStatus(); }

  while (Serial.available()) {
    if (Serial.read() == '?') printStatus();
  }
}

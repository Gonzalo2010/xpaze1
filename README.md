# XPaze — health monitoring for humans beyond Earth

XPaze learns what is normal for each astronaut, notices when that changes and explains why, without depending on Earth. It is a research prototype, not a medical device.

**Live:** https://xpaze.es · **App (the demo):** https://xpaze.es/app/ (English by default, Spanish available; `/demo/` redirects here) · Spanish documentation: [README.es.md](README.es.md)

## What is built

| Part | What it does |
|---|---|
| **App** (`/app/`, PWA) | Pick a profile and go. Guided 5-step check-up: pulse and SpO₂ from the station sensor (or typed in), blood pressure, glucose, mood and sleep (PHQ-2), and red flags. Each step explains how to measure and why it matters in space. Fixed, citable thresholds set a green, yellow or red traffic light (`src/app/clinical.js`). The AI explains the result but never changes a color. The action plan says what to do now and when to alert the crew or the flight surgeon, adapted to the mission environment (Mars transit, station, Moon base, rover). The app also shows history and trends. |
| **Paze** | Onboard psychologist AI, by voice (live WebGL orb) or by text. It uses emotional-support strategies (ESConv) and motivational interviewing. It also knows the user: their check-ups, live vitals, watch data, space weather, a "about me" note and a memory of previous sessions, all stored on the user's device. Crisis protocol: it escalates to the medical officer and gives emergency resources. Evaluation: `scripts/eval-psicologa.mjs`, 24 cases, crises must be escalated. |
| **Space weather** | Live **NASA DONKI** notifications with environment-specific rules (`src/app/space.js`): solar particles, strong flares, geomagnetic storms and radiation belts. |
| **Station** | Arduino Uno (`firmware/`) reads an RC522 RFID reader, AHT20 + BMP280 cabin sensors and a MAX3010x pulse oximeter. It sends the data over USB to a Raspberry Pi (`sensors/`), which advertises over Bluetooth LE and serves the app over local Wi-Fi. |
| **Watch** | Real Galaxy Watch data through Samsung Health → Health Connect → the Android companion app `android/xpaze-link`. |
| **Website** | Landing page with a live ECG from the simulated station v2, its 12 sensors, the live Earth–Mars light delay and the NASA data we use. |

**Simulated:** the crew and the mission environment. Astronaut physiological data is not public, so the demo crew uses published parameters.
**Next:** a single BLE chip (ESP32) for the station, and trends across weeks.

## NASA data

Live: **DONKI** space weather (api.nasa.gov). Earth–Mars delay checked against **JPL Horizons**. Grounding: **NASA-STD-3001 Vol. 2** cabin limits, **NASA Human Research Program** risks, **NASA OSDR** (OSD-569 Inspiration4; Environmental Data App). Every threshold has a source in [docs/medical-thresholds.md](docs/medical-thresholds.md).

## Run it

```sh
npm install
npm run dev          # http://localhost:5192
npm test             # thresholds, protocol, space weather, Mind engine
python3 -m unittest discover -s tests/sensors
node --env-file=.env server/psicologa.js   # AI server (Paze, explainer, space weather, watch data)
```

`.env` (not in the repo) takes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (Paze voice) and an optional `NASA_API_KEY`. Set `PSICOLOGA_PROVIDER=ollama` to run Paze's text chat on a local model.

## AI use

AI was used both to build XPaze and inside the product. The full declaration, covering tools, models, what the AI does and does not do, and our safety checks, is in **[AI_USE.md](AI_USE.md)** ([español](AI_USE.es.md)).

## Safety and privacy

- XPaze does not diagnose. Colors come from fixed rules; the AI only explains them.
- The private journal never leaves the device. Paze's memory and the profile note are stored locally.
- Watch data is kept on the server for at most 48 h, under a random pairing code.

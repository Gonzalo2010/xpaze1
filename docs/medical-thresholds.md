# XPaze — Medical thresholds, NASA HRP risks and sources

XPaze uses **fixed, explainable thresholds** to set the traffic light (green / yellow / red). The AI never decides urgency: it only explains the result in plain language and runs the psychological conversation. The single source of truth in code is [`src/app/clinical.js`](../src/app/clinical.js), covered by `tests/clinical.test.js`.

**Color logic.** Each measurement is classified independently, and the overall result is the worst of them. Any self-reported red flag (chest pain, breathlessness at rest, fainting or confusion, thoughts of self-harm) makes the result red immediately. A personal baseline (median + MAD of the person's own checks) can raise resting heart rate to yellow when it is far from that person's normal. **Red comes only from the absolute thresholds.**

> XPaze is a research prototype, not a medical device. These bands come from general clinical references for adults at rest. They have not been validated for spaceflight.

## Thresholds

| Measurement | Green | Yellow | Red | NASA HRP risk | Sources |
|---|---|---|---|---|---|
| Resting heart rate (bpm) | 51–90 | 41–50 · 91–130 | ≤ 40 · ≥ 131 | Cardiovascular | NEWS2 [1]; personal baseline (robust z ≥ 2.5 → yellow) |
| SpO₂ (%), room air | ≥ 96 | 92–95 | ≤ 91 | Medical Conditions · Hypoxia | NEWS2 Scale 1 [1]; WHO Pulse Oximetry Training Manual [2] |
| Blood pressure (mmHg) | systolic 101–129 and diastolic < 80 | 130–179 or 80–119 · systolic 91–100 | ≥ 180 or ≥ 120 · systolic ≤ 90 | Cardiovascular (includes orthostatic intolerance) | 2017 ACC/AHA [3]; NEWS2 (systolic ≤ 90) [1]; NHLBI (hypotension < 90/60) [4] |
| Glucose (mg/dL) | 70–180 | 54–69 · 181–250 | < 54 · > 250 | Food and Nutrition · Medical Conditions | ADA Standards of Care 2025 [5]; Time in Range consensus [6] |
| Mood (PHQ-2, 0–6) | ≤ 2 | ≥ 3 (positive screen: talk to a professional) | — | BMed | Kroenke et al. 2003 [7] |
| Sleep (h/night) | ≥ 7 | 4–6.9 | < 4 | Sleep | AASM/SRS consensus [8]; ISS average ≈ 6 h [9] |
| Stress (0–10, self-report) | < 8 | ≥ 8 | — | BMed | Design choice |
| Reaction test (PVT-B) | lapse = reaction > 355 ms | more lapses than personal baseline | — | Sleep · BMed | Basner et al. 2011 [10] |
| Cabin temperature / RH | 20–25 °C and 30–60 % | 18–27 °C and 25–75 % | outside 18–27 °C or 25–75 % | — (standard) | NASA-STD-3001 Vol. 2, [V2 6013] / [V2 6012] [11] |
| Cabin total pressure | 34.5–103 kPa | — | outside | Hypoxia (low-pressure cabins) | NASA-STD-3001 Vol. 2, [V2 6006] [11] |

**How the NEWS2 colors map:** a NEWS2 single-parameter score of 0 is green, 1–2 is yellow, and 3 is red (NEWS2: "a single parameter scoring 3 triggers urgent review").

**Design choices (not taken from a source):** sleep < 4 h as red (acute safety), stress ≥ 8 as yellow, the systolic 91–100 band as yellow (NEWS2 scores it 2), and mapping glucose to Food and Nutrition / Medical Conditions (no HRP risk is specific to glucose).

## Station v2 extended sensors (simulated in the cloud demo)

The physical prototype measures heart rate and SpO₂ (MAX3010x), cabin air (AHT20 + BMP280) and identifies the person with an RFID card (RC522). The **cloud demo** (`/app/`, simulated station) also simulates the planned **station v2** sensors. The physiology model is in [`src/app/simbody.js`](../src/app/simbody.js), tested in `tests/simbody.test.js`. Heart rate, RMSSD and rhythm are **computed from the generated beats** with the same function the hardware would use (`analyzeRR`), not copied from the scenario.

| Measurement | Sensor (v2) | Green | Yellow | Red | Sources |
|---|---|---|---|---|---|
| Body temperature (°C) | Contactless IR | 36.1–38.0 | 35.1–36.0 · ≥ 38.1 | ≤ 35.0 | NEWS2 [1] (≥ 39.1 scores 2, so it stays yellow) |
| Breathing rate (breaths/min) | Derived from ECG/PPG respiratory modulation | 12–20 | 9–11 · 21–24 | ≤ 8 · ≥ 25 | NEWS2 [1] |
| Heart rhythm | Single-lead ECG (copper handles, lead I) | sinus | frequent ectopic beats · irregular rhythm (possible AF) | — | ESC 2020 AF guidelines [13]: a single-lead ECG must be confirmed by a physician |
| QTc (ms, Bazett) | Same ECG | < 460 | 460–499 | ≥ 500 | AHA/ACCF/HRS 2009 [14]; Drew et al. 2010 [15] |
| HRV (RMSSD, ms) | Same ECG | — | well below the person's own baseline (below median − 2.5 robust SD) | — | No universal threshold: personal baseline only |
| Cabin CO₂ (mmHg) | NDIR CO₂ | ≤ 2.5 | 2.5–3 | > 3 | NASA-STD-3001 Vol. 2 [V2 6004] (≤ 3 mmHg, 1-h average) and OCHMO-TB-004 [11] |
| Dose rate (µSv/h) | Dosimeter | < 60 | ≥ 60 (Mars-transit level) | ≥ 200 (solar particle event) | Zeitlin et al. 2013 [16]: ≈ 1.8 mSv/day in Mars transit (≈ 75 µSv/h) |

**Information only (never sets the color):** cuffless blood pressure from pulse transit time (experimental; only the cuff reading counts), electrodermal activity (stress) and grip strength (tracks muscle loss, NASA HRP risk of reduced muscle mass and strength). Cabin CO₂ and radiation are environmental risks: they are shown with their own color, but they do not change the person's check-up color.

**Rhythm detection (`analyzeRR`):** an ectopic beat is an RR interval under 80 % of the median followed by a pause over 115 %. The rhythm is irregular when more than 45 % of successive RR differences exceed 12 % of the median RR. The test suite runs 25 resting seeds with no false positives, and detects atrial fibrillation and ectopic beats in every seed tested.

## Space weather (live, NASA DONKI)

XPaze reads the space weather notifications from **DONKI**, the database of the NASA Community Coordinated Modeling Center (https://api.nasa.gov, `DONKI/notifications`). The server fetches them once every 3 hours and caches them.

The rules are fixed and covered by `tests/space.test.js`. They live in [`src/app/space.js`](../src/app/space.js) and depend on the mission environment. Outside the magnetosphere (Mars transit, the Moon, the Martian surface), solar protons arrive unfiltered. In low Earth orbit (the station), the geomagnetic field shields most of the time.

| Event (last hours) | Mars transit / Moon / Mars surface | Low Earth orbit station |
|---|---|---|
| Solar energetic particles (SEP), 48 h | **Red**: go to the radiation shelter, suspend EVAs, record the dosimeter | **Yellow**: review the shelter plan, avoid non-essential EVAs |
| Solar flare ≥ M5.0 (FLR), 24 h | **Yellow**: energetic protons may follow within hours | Informational |
| Geomagnetic storm (GST), 24 h | Informational | **Yellow** if Kp ≥ 7; informational if Kp ≥ 5 |
| Outer radiation belt enhancement (RBE), 48 h | Not relevant | Informational (long EVAs) |

Space weather is an **environmental risk**: it adds its own block to the action plan but **never changes the health traffic light**. All notifications are detected from near-Earth assets (GOES, L1, STEREO), so in Mars transit the real exposure depends on the spacecraft's position, and the app says so. NASA HRP risk: *Space Radiation* (Human Research Roadmap). The onboard psychologist and the explainer also receive the status. A radiation alert means confinement in the shelter, a known stressor.

## Why each measurement matters in space

- **Heart rate and blood pressure.** In microgravity, fluids shift towards the head and the heart works with less load, so the cardiovascular system deconditions. Orthostatic intolerance (dizziness or fainting when standing) appears after landing.
- **SpO₂.** The ISS keeps sea-level oxygen, so a low reading points to illness or a sensor fault. A drop in several crew members at once points to the cabin air.
- **Glucose.** Inactivity, diet changes and flight stress alter insulin sensitivity. Hypoglycaemia during an EVA or while piloting is dangerous.
- **Mood, sleep and reaction time.** Isolation, confinement, the lack of a natural light/dark cycle and the workload reduce sleep (≈ 6 h/night on the ISS) and affect mood, attention and teamwork.

## NASA Human Research Program risks

These are the official titles from the Human Research Roadmap: https://humanresearchroadmap.nasa.gov/risks/

| Short name | Official title | URL |
|---|---|---|
| Cardiovascular | Risk of Cardiovascular Adaptations Contributing to Adverse Mission Performance and Health Outcomes. Orthostatic intolerance is now part of this risk. | https://humanresearchroadmap.nasa.gov/Risks/?i=179 |
| Medical Conditions | Risk of Adverse Health Outcomes and Decrements in Performance Due to Medical Conditions that occur in Mission, as well as Long Term Health Outcomes Due to Mission Exposures | https://humanresearchroadmap.nasa.gov/Risks/?i=95 |
| Hypoxia | Risk of Reduced Crew Health and Performance Due to Hypoxia | https://humanresearchroadmap.nasa.gov/Risks/?i=173 |
| Food and Nutrition | Risk of Performance Decrement and Crew Illness Due to Inadequate Food and Nutrition | https://humanresearchroadmap.nasa.gov/Risks/?i=176 |
| Sleep | Risk of Performance Decrements and Adverse Health Outcomes Resulting from Sleep Loss, Circadian Desynchronization, and Work Overload | https://humanresearchroadmap.nasa.gov/Risks/?i=100 |
| BMed | Risk of Adverse Cognitive or Behavioral Changes and Psychiatric Disorders Leading to In-mission Health and Performance and Long-term Health Effects | https://humanresearchroadmap.nasa.gov/Risks/?i=99 |
| Team | Risk of In-Mission Performance and Behavioral Health Decrements Due to Inadequate Cooperation, Coordination, Communication, and Psychosocial Adaptation within a Team | https://humanresearchroadmap.nasa.gov/Risks/?i=101 |

## NASA data used

| Data | Access | Use in XPaze |
|---|---|---|
| **DONKI** space weather notifications (NASA CCMC), https://api.nasa.gov | Open (free API key; `DEMO_KEY` works with the 3-hour cache) | **Live** radiation and space weather alerts in the app, by mission environment |
| **OSDR Environmental Data App** (ISS cabin temperature, CO₂, RH and radiation per mission), https://visualization.osdr.nasa.gov/eda/ | Open | Justifies the cabin bands and the realistic cabin values used in the simulation |
| **JPL Horizons** ephemerides, https://ssd.jpl.nasa.gov/api/horizons.api | Open | Real Earth–Mars light time. XPaze computes the same value locally from mean orbital elements: 11.0 min on 2026-11-14, matching Horizons |
| **NASA-STD-3001 Vol. 2** (OCHMO-TB-002 and TB-004) | Open | Cabin limits: temperature, humidity, pressure and CO₂ (≤ 3 mmHg 1-h average, [V2 6004]) |
| **Basner et al. 2011** (PVT-B, used in ISS research) | Paper | 355 ms lapse threshold of the 3-min reaction test |
| **Barger et al. 2014** (sleep on Shuttle and ISS) | Paper | Realistic sleep values in the simulation (≈ 6 h) |

Astronaut physiological data (wearables, ECG, cognition) is **not public**. It is only available through approved requests, such as TRISH EXPAND or NASA LSDA/NLSP. **All crew data in the demo is therefore simulated with published parameters**, and the app labels it as simulated.

## AI and its safety

- **Explainer** (`/api/explicar`). It receives the already-classified result and the action plan. It must not change any color, diagnose or recommend medication. Plain text, at most 120 words.
- **Onboard psychologist** (`/api/psicologa`).
  - Uses the emotional-support strategies of ESConv [12] and a motivational-interviewing style.
  - Gets a crisis protocol: it escalates to the medical officer or commander and ground support, and gives emergency numbers. The server also appends emergency resources whenever a crisis message is detected.
  - Never receives the private journal and does not store conversations.
- **Evaluation** (`tests/ai/psicologa-eval.json`, `scripts/eval-psicologa.mjs`). 24 cases: 14 normal, 5 crisis and 5 adversarial, scored by an LLM judge with a rubric. Crisis escalation is mandatory to pass. Last run: **24/24 passed, 5/5 crises escalated, mean empathy 4.63/5**.

## References

1. Royal College of Physicians. *National Early Warning Score (NEWS) 2.* 2017. https://www.rcp.ac.uk/improving-care/resources/national-early-warning-score-news-2/
2. World Health Organization. *Pulse Oximetry Training Manual.* 2011.
3. Whelton PK et al. *2017 ACC/AHA Guideline for High Blood Pressure in Adults.* https://professional.heart.org/en/science-news/2017-hypertension-clinical-guidelines/top-things-to-know
4. NHLBI. *Low Blood Pressure.* https://www.nhlbi.nih.gov/health/low-blood-pressure
5. American Diabetes Association. *Standards of Care in Diabetes—2025*, Section 6. Diabetes Care 48(Suppl 1):S128. doi:10.2337/dc25-S006
6. Battelino T et al. *International Consensus on Time in Range.* Diabetes Care 2019;42:1593. doi:10.2337/dci19-0028
7. Kroenke K, Spitzer RL, Williams JBW. *The Patient Health Questionnaire-2.* Med Care 2003;41:1284. (Free to use; no permission required.)
8. Watson NF et al. *Recommended Amount of Sleep for a Healthy Adult.* J Clin Sleep Med 2015;11(6):591.
9. Barger LK et al. *Prevalence of sleep deficiency and use of hypnotics in astronauts.* Lancet Neurol 2014;13:904. doi:10.1016/S1474-4422(14)70122-X
10. Basner M, Mollicone D, Dinges DF. *Validity and sensitivity of a brief psychomotor vigilance test (PVT-B).* Acta Astronautica 2011;69:949. https://pmc.ncbi.nlm.nih.gov/articles/PMC3197786
11. NASA. *NASA-STD-3001 Vol. 2*; OCHMO-TB-002 (ECLSS) https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-002-eclss.pdf; OCHMO-TB-004 (CO₂) https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf
12. Liu S et al. *Towards Emotional Support Dialog Systems* (ESConv). ACL 2021. https://github.com/thu-coai/Emotional-Support-Conversation (CC BY-NC 4.0). Strategy taxonomy adapted; no dialogues redistributed.
13. Hindricks G et al. *2020 ESC Guidelines for the diagnosis and management of atrial fibrillation.* Eur Heart J 2021;42:373. https://doi.org/10.1093/eurheartj/ehaa612
14. Rautaharju PM et al. *AHA/ACCF/HRS Recommendations for the Standardization and Interpretation of the Electrocardiogram, Part IV: the ST segment, T and U waves, and the QT interval.* Circulation 2009;119:e241. https://doi.org/10.1161/CIRCULATIONAHA.108.191096
15. Drew BJ et al. *Prevention of Torsade de Pointes in Hospital Settings.* Circulation 2010;121:1047. https://doi.org/10.1161/CIRCULATIONAHA.109.192704
16. Zeitlin C et al. *Measurements of Energetic Particle Radiation in Transit to Mars on the Mars Science Laboratory.* Science 2013;340:1080. https://doi.org/10.1126/science.1235989

**Not verified directly:** the NEWS2 bands were taken from reproductions of the official chart; the WHO cut-offs came from copies of the manual; the 2025 BP guideline update was seen only in secondary summaries.

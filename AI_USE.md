# AI use declaration — XPaze

We used AI extensively, both to **build** XPaze and **inside the product**. This page states where, with which tools, and what the team decided and checked. Spanish version: [AI_USE.es.md](AI_USE.es.md).

## 1. AI used to build the project

| Tool | Provider | What it was used for |
|---|---|---|
| **Claude Code** (model **Claude Opus 5.5**, plus its sub-agents) | Anthropic | Most of the code in this repository: website, app, Mind module integration, AI server, Arduino firmware, Raspberry Pi bridge, Android companion app and tests. It also wrote the documentation, ran the browser tests and screenshots, and handled server deployment. |
| **Claude Code research sub-agents** | Anthropic | Searching and checking sources: NASA HRP risk titles, NASA-STD-3001 limits, NEWS2, ACC/AHA, ADA, PHQ-2, AASM, PVT-B, NASA OSDR and DONKI, and emotional-support datasets (ESConv, AnnoMI). Each finding was checked against the cited source, and anything not verified is marked as such in [docs/medical-thresholds.md](docs/medical-thresholds.md). |
| **OpenAI Codex** | OpenAI | The first version of the Mind psychology engine (`src/demo/psych/engine/`). |
| *[Team: add any other AI you used, e.g. for the logo, images, slides, video or texts]* | | |

**What the team decided and did:**
- The idea, the product decisions and the priorities.
- The physical station design and its hardware.
- Choosing which sources and thresholds to accept.
- Reviewing and testing the results.
- The pitch.

*[Team: complete with who did what.]*

The AI proposed code and text. The team accepted, changed or rejected it.

## 2. AI inside the product

| Feature | Model | Provider | What the AI does, and what it does not do |
|---|---|---|---|
| **Check-up explanation** | Claude Opus 5.5 | Anthropic | Explains in plain language a result that is **already classified by fixed rules**. It **cannot change any color**. Those come from `src/app/clinical.js`: NEWS2, ACC/AHA, ADA, PHQ-2, AASM and NASA-STD-3001. |
| **Paze, text chat** | Claude Opus 5.5 (Claude Sonnet 5.5 in the voice fallback); server-side fallback models if a request is declined | Anthropic | Supportive conversation based on ESConv strategies and motivational interviewing. It does not diagnose or prescribe. A crisis protocol escalates to the medical officer and gives emergency resources; the server adds those resources whenever a crisis message is detected. |
| **Paze, live voice** | gpt-realtime-2.1 (speech-to-speech); gpt-4o-mini-transcribe for subtitles | OpenAI | The same rules as the text chat, by voice. The browser connects directly with a short-lived key issued by our server. |
| **Paze, session memory** | Claude Opus 5.5 | Anthropic | Writes a short summary and stable facts at the end of a session. They are stored **only on the user's device** and the user can view or delete them. |
| **Local option** | Any Ollama model, e.g. qwen2.5:3b | Local, open | `PSICOLOGA_PROVIDER=ollama` runs Paze's text chat without internet. *[Team: state whether you tested it and with which model.]* |

**What is NOT AI:** the traffic light, the action plans, the personal baseline (median + MAD, EWMA, Isolation Forest), the space-weather rules and the Earth–Mars delay are deterministic code with tests (`npm test`, more than 80 tests).

## 3. Safety checks on the AI

- **Evaluation of Paze** (`tests/ai/psicologa-eval.json`, `scripts/eval-psicologa.mjs`). 24 cases: 14 normal, 5 crisis and 5 adversarial (diagnosis requests, medication doses, requests to hide a risk, leaving the role). An LLM judge scores each answer with a rubric, and escalating a crisis is mandatory to pass. Last run: 24/24 passed, 5/5 crises escalated. *[Team: re-run before submitting; the prompts changed after that run.]*
- The user always sees that they are talking to an AI ("You are talking to an AI").
- Privacy:
  - Paze **never** receives the private journal.
  - Watch data is kept on the server for at most 48 h, under a random pairing code.
  - Conversations are not stored on the server.

## 4. Limits we accept

XPaze is a research prototype, **not a medical device**. AI answers can be wrong; that is why the AI never decides urgency. Clinical decisions belong to health professionals.

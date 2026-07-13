<div align="center">

# TH‑Labs — AI Dubbing with Voice Preservation

**Translate any video into 30+ languages while keeping the speaker's own voice.**

A full‑stack implementation of the RSEF 2026 cascaded **ASR → NMT → TTS‑VC → Sync**
dubbing pipeline — an interactive landing page, a live dubbing **Studio**, and a
**Research** page, backed by a modular FastAPI pipeline.

</div>

---

## ✨ What it is

TH‑Labs turns a source video into a dubbed video in another language **without
replacing the speaker's voice**. It follows the four‑stage cascade from the paper
*"An Automatic AI Dubbing System for Multilingual Video Translation with Voice
Preservation"* (Isoqov Jo'rabek & Asilbek Abdug'afforov, New Uzbekistan
University):

| Stage | Engine | What it does |
|-------|--------|--------------|
| **ASR** — Speech‑to‑Text | **Whisper medium** | Transcribes source audio with word‑level timestamps |
| **NMT** — Translation | **NLLB‑200 (distilled‑600M)** | Transformer translation, length‑scored to fit the original timing |
| **TTS‑VC** — Voice Cloning | **OmniVoice** | Re‑voices the translation conditioned on a speaker embedding |
| **Lip Sync** *(optional)* | **Wav2Lip** | Reshapes the speaker's mouth to the new speech |
| **Sync & Mux** | **ffmpeg** | Time‑aligns audio to the video and muxes the final output |

> **Why NLLB‑200 for NMT?** The paper specifies a *Transformer‑based* NMT. NLLB‑200
> is exactly that, is openly available, covers 200 languages (matching the
> "multilingual" goal), and the distilled‑600M variant fits a 6 GB GPU. It's set
> in one place (`TH_LABS_NMT_MODEL`) so you can swap in OPUS‑MT/MarianMT if you
> prefer a lighter model.

---

## 🧩 Architecture

```
frontend/                      React + Vite + TypeScript + Tailwind v4 + Framer Motion
  src/
    pages/      Landing · Studio · Research
    components/ PipelineDiagram, MetricsShowcase, Uploader, LanguageSelect,
                StageTimeline, VideoCompare, SegmentTable, ...
    lib/        api.ts (fetch + SSE), types.ts

backend/                       FastAPI, modular pipeline
  app/
    main.py         REST + SSE endpoints, /media static serving
    jobs.py         in‑memory job store + async runner + SSE broadcast
    schemas.py      Pydantic models
    languages.py    32 languages (Whisper + NLLB codes)
    pipeline/
      orchestrator.py   runs ASR→NMT→TTS→(lip)→sync, emits live progress
      stt.py  nmt.py  tts.py  lipsync.py  sync.py   ← one adapter per stage
      metrics.py  media.py  samples.py
```

Each stage adapter exposes a **real** implementation and a **labelled simulation
fallback**. Every heavy import is lazy, so the server always starts and each
stage independently reports `real` or `simulation` at `/api/health`.

### 🔬 Real inference vs. Simulation

The app ships in **`demo` mode by default** (`TH_LABS_MODE`): every stage runs a
clearly‑labelled simulation and the server never imports heavy CUDA libraries, so
it starts instantly and never crashes — ideal for a live demo or a fresh machine.

Set **`TH_LABS_MODE=auto`** to enable real inference:

| Path | Behaviour in `auto` mode |
|------|--------------------------|
| **Built‑in sample clip** | Always simulated (the sample is synthetic with no real speech), using hand‑authored translations — a flawless, instant demo. |
| **Your uploaded video** | Real **Whisper + NLLB** when `faster-whisper` / `transformers` + `torch` are installed; per‑stage fallback to simulation if a model is missing. |
| **TTS (OmniVoice) / Lip Sync (Wav2Lip)** | Simulation until you configure an OmniVoice endpoint / Wav2Lip checkout (see below). |

> ⚠️ **Python 3.14 note:** running `faster-whisper` (ctranslate2) and `torch`
> (CUDA) in the same process can segfault on Python 3.14. For real inference use
> **Python 3.11 or 3.12**, where the stack is stable.

The UI never fakes silently — a `simulation` / `live inference` badge and
per‑stage `real`/`simulation` tags always show what actually ran.

---

## 🚀 Running it

**Prerequisites:** Node 18+, Python 3.11–3.13 (3.14 works for the API but ML
wheels may be unavailable), and `ffmpeg` on PATH.

### 1 — Backend (port 8000)

```bash
cd backend
python -m pip install -r requirements.txt        # core API only (lightweight)
python run.py                                     # → http://localhost:8000
```

### 2 — Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev                                       # → http://localhost:5173
```

Open **http://localhost:5173**. The Vite dev server proxies `/api` and `/media`
to the backend, so no CORS setup is needed.

---

## ⚙️ Enabling real models

Everything is opt‑in via env vars (`backend/.env`, see `.env.example`):

```bash
# STT — real Whisper medium
pip install faster-whisper

# NMT — real NLLB-200 (downloads ~2.4 GB on first run)
pip install "transformers>=4.40" torch sentencepiece

# TTS — real OmniVoice voice cloning
TH_LABS_OMNIVOICE_API_URL=https://your-omnivoice-endpoint/synthesize
TH_LABS_OMNIVOICE_API_KEY=sk-...

# Lip Sync — real Wav2Lip
TH_LABS_WAV2LIP_DIR=/path/to/Wav2Lip     # with checkpoints/wav2lip_gan.pth

# Force behaviour:  auto (default) | demo (all simulation) | real (require models)
TH_LABS_MODE=auto
```

Wiring points for OmniVoice and Wav2Lip live in `app/pipeline/tts.py` and
`app/pipeline/lipsync.py` — thin, documented integration functions.

---

## 📡 API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/api/health` | Mode + per‑stage engine status |
| `GET`  | `/api/languages` | Supported languages (32) |
| `POST` | `/api/jobs` | Create a dubbing job (multipart upload or `sample=true`) |
| `GET`  | `/api/jobs/{id}` | Job snapshot |
| `GET`  | `/api/jobs/{id}/events` | **SSE** live pipeline progress |
| `GET`  | `/media/...` | Source & dubbed media |
| `GET`  | `/docs` | Interactive OpenAPI docs |

---

## 📊 Evaluation (from the RSEF 2026 study)

`11% WER · BLEU 38.7 / COMET 0.86 · MOS 3.5/5 · 87.3% speaker similarity · 41 ms sync offset`
— the sync offset sits inside the ITU‑R BT.1359‑1 imperceptibility threshold.

---

## 🔐 Ethics

Voice cloning here is intended to re‑voice a speaker's **own** words for their
**own** video. Any third‑party use should carry explicit speaker consent and
clear "AI‑dubbed" labeling.

---

<div align="center">
<sub>Built for research & authorized use · New Uzbekistan University · RSEF 2026</sub>
</div>

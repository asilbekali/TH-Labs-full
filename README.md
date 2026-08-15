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
| **VAD** — Voice Activity Detection | **silero‑vad** | Finds real speech regions so ASR ignores music/silence |
| **ASR** — Speech‑to‑Text | **Whisper medium** (openai‑whisper) | Transcribes only the speech, with timestamps |
| **NMT** — Translation | **NLLB‑200 (distilled‑600M)** | Transformer translation, length‑scored to fit the original timing |
| **TTS** — Text‑to‑Speech | **edge‑tts** (neural) | Speaks the translation in a natural per‑language voice (incl. Uzbek) |
| **Voice cloning** | **OpenVoice v2** (→ OmniVoice on cloud) | Transfers the *source speaker's* timbre onto the edge‑tts voice — 131 MB, runs on a 6 GB GPU, reports the real measured speaker similarity |
| **Background** — Source separation | **Demucs** | Keeps the original music/FX and removes only the original speech, so the dub is mixed *over* the background |
| **Lip Sync** *(optional)* | **Wav2Lip** | Reshapes the speaker's mouth to the new speech |
| **Sync & Mux** | **ffmpeg** | Time‑aligns audio to the video and muxes the final output |

> **Why NLLB‑200 for NMT?** The paper specifies a *Transformer‑based* NMT. NLLB‑200
> is exactly that, is openly available, covers 200 languages (matching the
> "multilingual" goal), and the distilled‑600M variant fits a 6 GB GPU. It's set
> in one place (`TH_LABS_NMT_MODEL`) so you can swap in OPUS‑MT/MarianMT if you
> prefer a lighter model.

---

## 🧩 Architecture

> This section covers the Studio's own tree. For how the **whole product** fits
> together — the landing page and account API on the VPS, the Studio on Modal,
> the cross-origin sign-in handoff, credits and Stripe, and what breaks when the
> two halves drift apart — see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

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

The app ships in **`auto` mode by default** (`TH_LABS_MODE`): each stage uses its
real model when installed and a labelled simulation otherwise.

| Path | Behaviour in `auto` mode |
|------|--------------------------|
| **Built‑in sample clip** | Carries **real English speech** (a short lecture), so it runs real Whisper + NLLB end‑to‑end — a genuine EN→UZ (or any target) demo with no upload. |
| **Your uploaded video** | Real **Whisper (STT) + NLLB (NMT)** transcription and translation; per‑stage fallback to simulation only if a model errors. |
| **TTS** | **edge‑tts** speaks the translation in a real per‑language neural voice (the dubbed audio you hear). **OmniVoice** clones the *source speaker's* voice when it can load (needs newer transformers); otherwise the engine chain falls back edge‑tts → tone. |
| **Background** | **Demucs** splits the original audio into speech (removed) and music/FX (kept), so the dub is mixed *over* the background — the video is *dubbed*, not *replaced*, and the original language is inaudible. Toggle "Keep background music & effects" (on by default). Runs on CPU by default here (`TH_LABS_SEPARATION_DEVICE=cuda` on a bigger GPU). |
| **Lip Sync (Wav2Lip)** | Simulation until a Wav2Lip checkout is configured. |

Set `TH_LABS_MODE=demo` to force all‑simulation (never imports heavy libs).

> ⚠️ **Python 3.14 note:** the HuggingFace `tokenizers` Rust extension segfaults
> on 3.14, which breaks faster‑whisper and NLLB's *fast* tokenizer. This app
> sidesteps it — **STT via openai‑whisper** (torch + tiktoken) and **NMT with the
> slow SentencePiece tokenizer** — so real STT + NMT run on 3.14. OmniVoice TTS
> still wants Python 3.11/3.12. On the first request the models warm in the
> background (~30 s once); after that a 30 s clip dubs in ~15–20 s.

The UI never fakes silently — a `simulation` / `live inference` badge and
per‑stage `real`/`simulation` tags always show what actually ran. On a real
upload with no detectable speech, the ASR stage reports **"No speech detected"**
rather than inventing a transcript.

**Long videos:** real inference runs at ~0.3–0.6× real‑time, so a 15‑minute clip
takes several minutes. The ASR/NMT stages emit a **progress heartbeat**, the SSE
stream sends **keepalives**, and the frontend **falls back to polling** if the
stream drops — so long jobs show steady progress instead of appearing frozen.

### 🎙️ VAD (why your real video now works)

Whisper hallucinates phantom text on non‑speech audio (music, silence, intros —
e.g. "Thanks for watching!"). **silero‑vad** runs first to isolate real speech
regions; Whisper only transcribes those, and segments that don't overlap speech
(or that Whisper flags as non‑speech) are dropped. If VAD finds no speech, the
job says so honestly. Jobs also run **one at a time** — the shared Whisper model
isn't thread‑safe, and a 6 GB GPU can't hold two runs at once.

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
# STT — real Whisper medium (openai-whisper: torch + tiktoken, 3.14-safe)
pip install openai-whisper

# NMT — real NLLB-200 (downloads ~2.4 GB on first run)
pip install "transformers>=4.40" torch sentencepiece

# TTS — real OmniVoice zero-shot voice cloning
pip install omnivoice soundfile         # needs transformers with HiggsAudioV2TokenizerModel
TH_LABS_OMNIVOICE_MODEL=k2-fsa/OmniVoice

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

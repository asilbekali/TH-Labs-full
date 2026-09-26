# Deploy TH-Labs on Modal (permanent URL, GPU, scale-to-zero)

[`modal_app.py`](./modal_app.py) serves the **whole app** — Studio UI, FastAPI,
and the full ASR → NMT → **OmniVoice** → Demucs pipeline — from one Modal
function on an **L4 GPU**, at a **URL that doesn't change**.

This is the fix for Colab's two annoyances: no 12-hour session cap, no new URL
every run, and no browser tab to keep open.

## Setup (once)

```bash
pip install modal
```
```bash
modal setup
```

## Deploy

```bash
modal deploy deploy/modal/modal_app.py
```

Prints a permanent `https://<workspace>--th-labs-dubbing-web.modal.run` URL.
For iterating, `modal serve …` hot-reloads on save.

**First deploy takes ~15–20 min** — it installs CUDA torch, builds the React
app with Node, and bakes ~6 GB of model weights into the image. Later deploys
reuse cached layers and take seconds unless dependencies changed.

## Check it before demoing

```bash
modal run deploy/modal/modal_app.py::preflight
```

Verifies the three things that actually break: **OmniVoice imports**, the
**uz/ru/en language mapping**, and **NLLB translating under transformers 5.x**.
Seconds, versus finding out mid-demo.

## What the cost actually is

Billed per second, scale-to-zero — you pay for dubbing time, not uptime.

| Usage | GPU-hrs/mo | L4 @ $0.80/hr |
|---|---|---|
| Light (~1 dub/day) | ~1.4 | ~$1 |
| **Moderate (~5/day)** | **~5.4** | **~$4** |
| Busy (~17/day) | ~17 | ~$14 |

Modal's **$30/month free credit** covers moderate use outright. Compare with an
always-on GPU VM at ~$580/month for the same card — the bursty workload is why
serverless is the right shape here.

## Billing is enforced here, not just in the browser

The Studio calls `/v1/payments/can-dub` before it starts a job — but that is a
browser asking politely. Anyone holding a valid access token can `POST
/api/jobs` on this deployment directly and skip it, which on an L4 is real
money. So `modal_app.py` sets:

```python
"TH_LABS_ACCOUNT_API_URL": ACCOUNT_API_URL,   # https://th-labs.uz/v1
```

which turns on `backend/app/billing.py`: the same `can-dub` / `commit-dub`
calls, made server-side with the caller's own token, where they cannot be
skipped. `commit-dub` is idempotent on the job id, so the Studio still calling
it never double-charges. Unset that variable and every dub runs unbilled.

If the account API is unreachable the dub is **refused** (`503`) rather than
run for free — see `api/PAYMENTS.md`.

## Design notes (why it's built this way)

- **Python 3.12.** `omnivoice` needs `transformers>=5.3`, unreachable on the dev
  box's Python 3.14 (the newer Rust `tokenizers` segfaults there). This is the
  entire reason OmniVoice runs in the cloud and not on the laptop.
- **L4, not the cheaper T4.** OmniVoice is only **~2.2 GB of VRAM** (measured),
  so capacity isn't the constraint — **bf16** is. T4 is Turing with no native
  bf16; L4 is Ada and has it. Whisper-medium + NLLB + OmniVoice + Demucs total
  ≈10 GB of the L4's 24 GB.
  *If TTS feels slow, A10 ($1.10/hr) has 600 GB/s vs L4's 300 GB/s — OmniVoice
  generates autoregressively, so it's bandwidth-bound and A10 may cost less per
  dub despite the higher hourly rate.*
- **`max_containers=1`.** `backend/app/jobs.py` holds jobs in an in-memory dict
  and streams progress over SSE. A second container has its own empty store and
  returns *"Job not found"* mid-job. One container keeps the existing design
  correct — to scale out, move the job store to a `modal.Dict`.
- **Weights baked into the image** via `run_function`, so a cold start doesn't
  re-download 6 GB.
- **`modal.Volume` at `backend/data`** so finished dubs survive a scale-down
  instead of 404ing once the container stops.
- **Install order is load-bearing:** `torchaudio` before `omnivoice`, and
  `numba>=0.61` pinned. Otherwise the resolver backtracks to numba 0.53.1, which
  cannot build on Python ≥3.10.

## Language configuration

`generate(language=…)` is passed per segment (see
`backend/app/pipeline/tts.py`), which OmniVoice's docs note is better than
language-agnostic mode — and for Uzbek prevents it being voiced with a
neighbouring language's phonetics.

| App | → OmniVoice |
|-----|-------------|
| `uz` Uzbek | `uz` (NLLB emits `uzn_Latn`; `uzn` also valid for the narrower variant) |
| `ru` Russian | `ru` |
| `en` English | `en` |
| `ar` Arabic | `arb` — no generic `ar` exists, only variants |

All 32 app languages resolve; `auto` → `None` (language-agnostic) rather than a
bogus code.

## Ops

```bash
modal app logs th-labs-dubbing
```
```bash
modal app stop th-labs-dubbing
```

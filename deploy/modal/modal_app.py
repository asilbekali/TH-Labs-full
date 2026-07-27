"""TH-Labs AI Dubbing — Modal deployment.

Serves the whole app (Studio UI + FastAPI + the full ASR→NMT→OmniVoice→Demucs
pipeline) from ONE Modal function on an L4 GPU, at a permanent URL:

    modal deploy deploy/modal/modal_app.py     # persistent URL
    modal serve  deploy/modal/modal_app.py     # dev, hot-reloads on save

Why this shape
--------------
* **Python 3.12** — `omnivoice` needs `transformers>=5.3`, which is unreachable
  on the dev box's Python 3.14 (the newer Rust `tokenizers` segfaults there).
  This is the whole reason OmniVoice runs in the cloud and not on the laptop.
* **L4 (24 GB)** — OmniVoice is only ~2.2 GB of VRAM, so the real driver is
  bf16: the cheaper T4 is Turing and has no native bf16, which modern audio-LLM
  stacks assume. L4 is Ada and does. Whisper-medium + NLLB + OmniVoice + Demucs
  together sit around 10 GB, so there is plenty of headroom.
* **max_containers=1** — `backend/app/jobs.py` keeps jobs in an in-memory dict
  and streams progress over SSE. A second container would have its own empty
  store and return "Job not found" mid-job. Pinning to one container keeps the
  existing design correct. (To scale out, move the job store to a modal.Dict.)
* **Weights baked into the image** — ~6 GB of models are downloaded at build
  time and snapshotted, so a cold start does not re-download them.
* **Volume for media** — uploads/outputs live on a Volume so finished dubs
  survive a scale-down instead of 404ing once the container stops.
"""
from __future__ import annotations

from pathlib import Path

import modal

APP_NAME = "th-labs-dubbing"
REPO = Path(__file__).resolve().parents[2]      # repo root (local, at build time)
REMOTE = "/app"                                  # where the repo lands in the image
DATA_DIR = f"{REMOTE}/backend/data"              # matches Settings.data_dir

app = modal.App(APP_NAME)

# Finished dubs + uploads persist here across container restarts.
media = modal.Volume.from_name(f"{APP_NAME}-media", create_if_missing=True)


# ── build-time: pre-download every model so cold starts are fast ───────────
def _download_models() -> None:
    """Snapshotted into the image, so containers start with weights present."""
    from huggingface_hub import snapshot_download

    # OmniVoice (~3.1 GB) and NLLB-200 (~2.4 GB): download only, don't load.
    snapshot_download("k2-fsa/OmniVoice")
    snapshot_download("facebook/nllb-200-distilled-600M")

    # Whisper caches to ~/.cache/whisper. "medium" is the paper setting;
    # "base"/"small" are pulled too so the Fast/Balanced quality tiers don't
    # download mid-request.
    import whisper
    for name in ("base", "small", "medium"):
        whisper.load_model(name, device="cpu")

    # silero-VAD gates ASR to real speech.
    from silero_vad import load_silero_vad
    load_silero_vad()

    # Demucs background separation.
    try:
        from demucs.pretrained import get_model
        get_model("htdemucs")
    except Exception as exc:      # non-fatal: stage degrades to simulation
        print(f"demucs prefetch skipped: {exc}")


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "git", "curl", "ca-certificates")
    # Node, for building the React Studio into static files
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    # CUDA torch FIRST. torchaudio must exist before omnivoice is resolved —
    # without it the resolver backtracks to numba 0.53.1, which cannot build
    # on Python >=3.10. (Learned the hard way locally.)
    .pip_install(
        "torch", "torchaudio",
        extra_index_url="https://download.pytorch.org/whl/cu128",
    )
    # Core API + pipeline engines
    .pip_install(
        "fastapi>=0.110", "uvicorn[standard]>=0.29", "python-multipart>=0.0.9",
        "pydantic>=2.6", "pydantic-settings>=2.2",
        "openai-whisper", "sentencepiece", "edge-tts", "soundfile",
        "silero-vad", "demucs", "huggingface_hub",
    )
    # OmniVoice — this is what pulls transformers>=5.3. numba pinned for the
    # reason above.
    .pip_install("omnivoice", "numba>=0.61", "librosa>=0.11")
    .env({
        "PYTHONPATH": f"{REMOTE}/backend",     # so `app.main:app` imports
        "PYTHONUNBUFFERED": "1",
        "TH_LABS_MODE": "auto",
        "TH_LABS_WHISPER_MODEL": "medium",     # paper setting; L4 handles it
        "TH_LABS_WHISPER_DEVICE": "cuda",
        "TH_LABS_OMNIVOICE_DEVICE": "cuda:0",  # voice cloning on GPU
        "TH_LABS_SEPARATION_DEVICE": "cuda",   # Demucs on GPU (24 GB fits it)
        "TH_LABS_CLONE_DEVICE": "cuda",        # OpenVoice fallback, if present
    })
    # copy=True so the npm build below can see these files.
    .add_local_dir(
        str(REPO / "backend"), f"{REMOTE}/backend", copy=True,
        ignore=["**/__pycache__", "**/data/uploads/*", "**/data/outputs/*",
                "**/models/*", "**/.env"],
    )
    .add_local_dir(
        str(REPO / "frontend"), f"{REMOTE}/frontend", copy=True,
        ignore=["**/node_modules", "**/dist", "**/.vite"],
    )
    # Build the Studio UI -> frontend/dist, which FastAPI serves at "/".
    .run_commands(
        f"cd {REMOTE}/frontend && npm ci --no-audit --no-fund && npm run build"
    )
    .run_function(_download_models)
)


@app.function(
    image=image,
    gpu="L4",
    volumes={DATA_DIR: media},
    max_containers=1,      # in-memory job store — see module docstring
    scaledown_window=300,  # stay warm 5 min after the last request
    timeout=3600,          # long videos: ASR+TTS on a 15-min clip takes a while
)
@modal.concurrent(max_inputs=50)   # SSE streams + polling must not block uploads
@modal.asgi_app()
def web():
    """Return the existing FastAPI app unchanged."""
    from app.main import app as fastapi_app
    return fastapi_app


@app.function(image=image, gpu="L4", timeout=900)
def preflight() -> dict:
    """Sanity-check the deployment without going through the UI.

        modal run deploy/modal/modal_app.py::preflight

    Verifies the three things that actually break: OmniVoice importing,
    the uz/ru/en language mapping, and NLLB under transformers 5.x.
    """
    import torch
    out: dict = {}

    import transformers
    out["transformers"] = transformers.__version__
    out["torch"] = torch.__version__
    out["cuda"] = torch.cuda.is_available()
    out["gpu"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else None

    try:
        from omnivoice import OmniVoice          # noqa: F401
        out["omnivoice_import"] = "ok"
    except Exception as exc:
        out["omnivoice_import"] = f"FAIL {type(exc).__name__}: {exc}"

    try:
        from app.pipeline.tts import resolve_language
        out["languages"] = {c: resolve_language(c) for c in ("uz", "ru", "en", "ar", "auto")}
    except Exception as exc:
        out["languages"] = f"FAIL {type(exc).__name__}: {exc}"

    try:
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        mid = "facebook/nllb-200-distilled-600M"
        tok = AutoTokenizer.from_pretrained(mid, src_lang="eng_Latn")
        mdl = AutoModelForSeq2SeqLM.from_pretrained(mid).to("cuda").eval()
        enc = tok("Today we translate video with artificial intelligence.",
                  return_tensors="pt").to("cuda")
        with torch.no_grad():
            gen = mdl.generate(**enc,
                               forced_bos_token_id=tok.convert_tokens_to_ids("uzn_Latn"),
                               max_new_tokens=48)
        out["nllb_en_uz"] = tok.batch_decode(gen, skip_special_tokens=True)[0]
    except Exception as exc:
        out["nllb_en_uz"] = f"FAIL {type(exc).__name__}: {exc}"

    for k, v in out.items():
        print(f"{k}: {v}")
    return out

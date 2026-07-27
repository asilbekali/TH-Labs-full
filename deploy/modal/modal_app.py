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
REMOTE = "/app"                                  # where the repo lands in the image

# Media volume mount point. Deliberately OUTSIDE the copied repo: Modal refuses
# to mount a Volume on a non-empty path, and the repo's own backend/data/ ships
# .gitkeep files, so mounting there crash-loops the container with
#   "cannot mount volume on non-empty path: /app/backend/data"
# Settings.data_dir is configurable, so we point TH_LABS_DATA_DIR here instead
# and let the app create uploads/ outputs/ assets/ inside it.
DATA_DIR = "/data"

# Repo root — used ONLY at build time, by the add_local_dir steps below.
# Modal re-imports this module inside the container (to locate the function it
# is running), where the file lives at /root/modal_app.py and therefore has no
# parents[2]. Resolving it unguarded raises IndexError and kills the build, so
# fall back to the in-image location, which is what those paths mean remotely.
_HERE = Path(__file__).resolve()
REPO = _HERE.parents[2] if len(_HERE.parents) > 2 else Path(REMOTE)

app = modal.App(APP_NAME)

# Finished dubs + uploads persist here across container restarts.
media = modal.Volume.from_name(f"{APP_NAME}-media", create_if_missing=True)


# ── build-time: pre-download every model so cold starts are fast ───────────
def _download_models() -> None:
    """Snapshotted into the image, so containers start with weights present.

    Every prefetch is individually non-fatal. This step is a cold-start
    optimisation, not a correctness requirement — anything missed here is
    simply downloaded on first use at runtime. A broken *environment* should
    fail earlier, at the import check right after the torch install, not after
    several GB of downloads.
    """
    import gc

    def step(label: str, fn) -> None:
        try:
            fn()
            print(f"  ok    {label}")
        except Exception as exc:
            print(f"  SKIP  {label} -> {type(exc).__name__}: {exc}")
        gc.collect()

    from huggingface_hub import snapshot_download

    # OmniVoice (~3.1 GB) and NLLB-200 (~2.4 GB): download only, don't load.
    step("OmniVoice weights", lambda: snapshot_download("k2-fsa/OmniVoice"))
    step("NLLB-200 weights",
         lambda: snapshot_download("facebook/nllb-200-distilled-600M"))

    # Whisper caches to ~/.cache/whisper. "medium" is the paper setting;
    # "base"/"small" back the Fast/Balanced quality tiers. Loaded one at a
    # time and released, so the build container isn't holding all three.
    def _whisper(name: str) -> None:
        import whisper
        m = whisper.load_model(name, device="cpu")
        del m

    for _name in ("base", "small", "medium"):
        step(f"whisper {_name}", lambda n=_name: _whisper(n))

    # silero-VAD gates ASR to real speech. Imports torchaudio, so this is also
    # a de-facto check that the torch/torchaudio pair is sane.
    def _vad() -> None:
        from silero_vad import load_silero_vad
        load_silero_vad()

    step("silero-VAD", _vad)

    # Demucs background separation.
    def _demucs() -> None:
        from demucs.pretrained import get_model
        get_model("htdemucs")

    step("demucs htdemucs", _demucs)


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
    # torch + torchaudio from PyPI, with NO index override.
    #
    # The earlier `extra_index_url=".../cu128"` let pip satisfy torch from one
    # index and torchaudio from the other; the two builds then disagreed about
    # where the CUDA runtime lives and torchaudio's compiled extension died on
    # import with `OSError: libcudart.so.12: cannot open shared object file`.
    #
    # On Linux the plain PyPI wheels are already CUDA builds (they pull the
    # nvidia-*-cu12 runtime packages as dependencies), so resolving both from a
    # single index is what guarantees a matched pair. Installing them in one
    # call matters too — it lets pip solve them together.
    .pip_install("torch", "torchaudio")
    # Fail HERE rather than after ~6 GB of model downloads: torchaudio only
    # loads its CUDA extension on import, so a mismatch is invisible until
    # something imports it (silero-vad does).
    .run_commands(
        'python -c "import torch, torchaudio; '
        "print('torch', torch.__version__, 'torchaudio', torchaudio.__version__)\""
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
        "TH_LABS_DATA_DIR": DATA_DIR,          # uploads/outputs on the Volume
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
        # data/ is excluded wholesale — it lives on the Volume at DATA_DIR, and
        # copying it in only bloats the image. models/ likewise (weights are
        # fetched by _download_models).
        ignore=["**/__pycache__", "**/data/**", "**/models/**", "**/.env"],
    )
    .add_local_dir(
        str(REPO / "frontend"), f"{REMOTE}/frontend", copy=True,
        ignore=["**/node_modules", "**/dist", "**/.vite"],
    )
    # Build the Studio UI -> frontend/dist, which FastAPI serves at "/".
    #
    # `npm ci` is tried first (fast, reproducible) but falls back to
    # `npm install`: package-lock.json is generated on Windows and omits
    # @emnapi/runtime, which npm needs on Linux for the wasm-fallback
    # bindings. `npm ci` is strict about that mismatch and aborts; `npm
    # install` resolves the missing platform packages. Regenerating the
    # lockfile on Linux would let the `ci` path win again.
    .run_commands(
        f"cd {REMOTE}/frontend && "
        f"(npm ci --no-audit --no-fund || npm install --no-audit --no-fund) && "
        f"npm run build"
    )
    .run_function(_download_models)
)


@app.function(
    image=image,
    gpu="L4",
    volumes={DATA_DIR: media},
    # Whisper + NLLB + OmniVoice + Demucs keep several GB resident on the CPU
    # side, and a dub also holds decoded audio and ffmpeg intermediates. Ask
    # for explicit headroom so a long upload can't squeeze the container into
    # an OOM — which surfaces as a request cancelled with no entry in the
    # access log, rather than as an obvious error.
    memory=16384,          # MiB, minimum guarantee
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

"""Runtime configuration for the TH-Labs dubbing backend.

Every heavy dependency is optional. The `mode` for each stage is resolved at
startup by probing whether the real implementation is importable / configured;
if not, the stage runs in a clearly-labelled *simulation* fallback so the whole
service is always demonstrable.
"""
from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TH_LABS_", extra="ignore")

    # ── General ───────────────────────────────────────────────────────────
    app_name: str = "TH-Labs AI Dubbing"
    # "auto"  → use real models where installed, simulate the rest (default).
    #           Real STT (openai-whisper) + NMT (NLLB) run on the source audio;
    #           TTS falls back to simulation unless OmniVoice can load.
    # "demo"  → force simulation for every stage (never imports heavy libs).
    # "real"  → require real models.
    mode: str = "auto"

    # CORS — the Vite dev server origins
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
    ]

    # ── Storage ───────────────────────────────────────────────────────────
    data_dir: Path = Path(__file__).resolve().parent.parent / "data"

    # ── STT · Whisper ─────────────────────────────────────────────────────
    whisper_model: str = "medium"          # per the RSEF paper
    whisper_device: str = "auto"           # auto|cuda|cpu
    whisper_compute_type: str = "auto"     # e.g. float16 / int8

    # ── VAD · silero-vad ──────────────────────────────────────────────────
    # Gates ASR to real speech regions so Whisper doesn't hallucinate text on
    # music/silence (and so "no speech" is reported honestly, not faked).
    vad_enabled: bool = True

    # ── Background preservation · Demucs source separation ────────────────
    # Splits the original audio into speech (removed) and background music/FX
    # (kept), so the dub is mixed OVER the background instead of replacing it,
    # while the original language becomes inaudible.
    separation_model: str = "htdemucs"
    # cpu is reliable on this 6 GB box (GPU is full with STT/NMT). On a bigger
    # GPU / cloud set TH_LABS_SEPARATION_DEVICE=cuda for a big speed-up.
    separation_device: str = "cpu"       # cpu | cuda
    separation_timeout: int = 900        # seconds; on timeout → voice-only
    background_gain: float = 0.55        # background level under the dubbed voice
    voice_gain: float = 1.25             # dubbed voice level

    # ── NMT · NLLB-200 ────────────────────────────────────────────────────
    nmt_model: str = "facebook/nllb-200-distilled-600M"

    # ── Voice cloning · OpenVoice v2 tone-color converter ─────────────────
    # Clones the source speaker's timbre onto the edge-tts output — real voice
    # cloning that fits a 6 GB GPU (131 MB model). Works for any language.
    openvoice_converter_dir: Path = (
        Path(__file__).resolve().parent.parent
        / "models" / "openvoice_v2" / "converter")
    # The 131 MB converter needs only ~280 MB VRAM and is ~15× faster on GPU;
    # it fits alongside Whisper+NLLB. Falls back to CPU automatically on OOM.
    clone_device: str = "cuda"           # cuda | cpu

    # ── TTS · OmniVoice (zero-shot voice cloning) ────────────────────────-
    # Uses the `omnivoice` package: OmniVoice.from_pretrained(model).generate(
    #   text, ref_audio, ref_text)  →  list[np.ndarray] @ 24 kHz
    omnivoice_model: str = "k2-fsa/OmniVoice"
    omnivoice_device: str = "auto"       # auto|cuda:0|cpu
    omnivoice_ref_seconds: float = 12.0  # length of speaker reference clip

    # ── Lip sync · Wav2Lip (optional) ─────────────────────────────────────
    wav2lip_dir: Path | None = None

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.data_dir / "outputs"

    @property
    def assets_dir(self) -> Path:
        return self.data_dir / "assets"

    def ensure_dirs(self) -> None:
        for d in (self.uploads_dir, self.outputs_dir, self.assets_dir):
            d.mkdir(parents=True, exist_ok=True)

    @property
    def ffmpeg(self) -> str | None:
        return shutil.which("ffmpeg")


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s

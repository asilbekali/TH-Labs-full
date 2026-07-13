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
    # "demo"  → force simulation for every stage (default: rock-solid, never
    #           imports heavy CUDA libs — safe on any Python incl. 3.14)
    # "auto"  → use real models where installed, simulate the rest. Best on
    #           Python 3.11/3.12; on 3.14 torch+ctranslate2 can segfault.
    # "real"  → require real models.
    #
    # Default is "demo" for reliability. Set TH_LABS_MODE=auto to enable real
    # Whisper + NLLB inference on uploaded videos.
    mode: str = "demo"

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

    # ── NMT · NLLB-200 ────────────────────────────────────────────────────
    nmt_model: str = "facebook/nllb-200-distilled-600M"

    # ── TTS · OmniVoice (voice cloning) ──────────────────────────────────-
    omnivoice_api_url: str | None = None
    omnivoice_api_key: str | None = None

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

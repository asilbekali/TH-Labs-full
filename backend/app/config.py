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

    # ── Auth ──────────────────────────────────────────────────────────────
    # Shared HS256 secret, verified against tokens minted by the NestJS
    # account API. Must be byte-identical to JWT_SECRET there. Empty by
    # default and NOT given a dev fallback on purpose: a literal committed
    # here would let anyone forge a token for any user (see app/auth.py,
    # which fails closed instead of verifying against a known string).
    jwt_secret: str = ""

    # Where to send a visitor who arrives without a session. This is the
    # landing page, which owns sign-in; the Studio has no login form of its
    # own and deliberately does not grow one.
    landing_url: str = "https://th-labs.uz"

    # CORS — browser origins allowed to call this API.
    # The deployed Studio is served by THIS app (main.py mounts frontend/dist),
    # so in production the calls are same-origin and never consult this list;
    # it exists for the Vite dev server, which serves the UI on :5173 and
    # proxies here. Add a real origin only if the Studio is ever hosted apart
    # from its API.
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

    # ── ASR · GigaAM Multilingual (Turkic + Russian) ──────────────────────
    # A second ASR engine for the languages Whisper cannot transcribe. Measured
    # on clean synthesized Uzbek against a known transcript: whisper small and
    # large-v3 both 80% WER, GigaAM large_ctc 0% — and 25x faster. English is
    # deliberately NOT routed here; Whisper is more than twice as accurate on it
    # (3.9 vs 9.4 on FLEURS, GigaAM's own figures). See pipeline/stt_gigaam.py.
    gigaam_enabled: bool = True
    gigaam_model: str = "ai-sage/GigaAM-Multilingual"
    gigaam_revision: str = "large_ctc"   # ctc = 220M, large_ctc = 600M
    # Which source languages it handles. Comma-separated so a deployment can
    # widen or narrow it without a code change.
    gigaam_languages: str = "uz,kk,ky,ru"

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
    # Background level under the dubbed voice. Was 0.55 (only ~5 dB down),
    # which is loud enough that whatever original dialogue survives Demucs is
    # clearly audible under the dub. 0.25 is ~12 dB down, in the range dubbing
    # mixes actually use for a music-and-effects bed, and the mix additionally
    # ducks this further while the dubbed voice speaks (see
    # media.mix_voice_over_background).
    background_gain: float = 0.25

    # How much louder the no_vocals stem may get while the original speaker is
    # talking before we conclude it is carrying the source dialogue rather than
    # a music bed, and go voice-only. See separation.speech_lift_db: a real M&E
    # bed is indifferent to the speech and measures around 0 dB, while a stem
    # holding the speaker measured +26.4 dB on a real job. 6 dB sits in the wide
    # gap between those. Raise it to keep more background, lower it to be
    # stricter about source-language bleed.
    background_max_speech_lift_db: float = 6.0
    voice_gain: float = 1.25             # dubbed voice level

    # ── NMT · NLLB-200 ────────────────────────────────────────────────────
    nmt_model: str = "facebook/nllb-200-distilled-600M"

    # ── Translation repair ────────────────────────────────────────────────
    # A second pass over segments NLLB rendered badly — copied through
    # untranslated, truncated, looping, or impossibly long. Only those segments
    # are sent anywhere; see pipeline/refine.py for the tests and for why every
    # failure here keeps the original translation.
    #
    # The key is NEVER a literal in this file. It arrives from the environment,
    # which on Modal means a Secret (see deploy/modal/modal_app.py) and locally
    # means TH_LABS_REFINE_API_KEY. Unset, the whole stage is inert and the
    # pipeline behaves exactly as it did before.
    refine_enabled: bool = True
    refine_api_key: str = ""
    refine_base_url: str = "https://api.deepseek.com/v1"
    refine_model: str = "deepseek-chat"
    refine_timeout: int = 25             # seconds per request

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

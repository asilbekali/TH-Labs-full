"""Voice cloning via OpenVoice v2 tone-color conversion.

OmniVoice can't run on a 6 GB GPU (16 GB model), so we clone the speaker a
lighter way: edge-tts speaks the translation in a generic neural voice, then
OpenVoice's tone-color converter transfers the *source speaker's* timbre onto it.
The converter is a 131 MB model that fits the GPU and works for any language
(including Uzbek) on Python 3.14.

We bypass OpenVoice's `se_extractor` (it depends on whisper-timestamped, which is
awkward on 3.14) and drive `ToneColorConverter` directly with our own reference
clip. `clone()` also returns the measured speaker similarity (cosine of the
source-speaker vs. cloned-output embeddings) so the pipeline can report a *real*
number, not a baseline guess.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings


class OpenVoiceCloner:
    key = "clone"
    engine = "OpenVoice v2"

    def __init__(self) -> None:
        import threading
        self._conv = None
        self._device = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo":
            return False
        ckpt = s.openvoice_converter_dir / "checkpoint.pth"
        return (importlib.util.find_spec("openvoice") is not None
                and importlib.util.find_spec("soundfile") is not None
                and ckpt.exists())

    def _build(self, device: str):
        from openvoice.api import ToneColorConverter
        s = get_settings()
        conv = ToneColorConverter(
            str(s.openvoice_converter_dir / "config.json"), device=device)
        conv.load_ckpt(str(s.openvoice_converter_dir / "checkpoint.pth"))
        return conv

    def _load(self):
        if self._conv is not None:
            return self._conv
        with self._lock:
            if self._conv is not None:
                return self._conv
            s = get_settings()
            device = s.clone_device
            if device == "cuda":
                try:
                    import torch
                    device = "cuda:0" if torch.cuda.is_available() else "cpu"
                except Exception:
                    device = "cpu"
            self._device = device
            self._conv = self._build(device)
        return self._conv

    def _fallback_cpu(self) -> None:
        """Rebuild the converter on CPU (called if a CUDA convert OOMs)."""
        with self._lock:
            self._device = "cpu"
            self._conv = self._build("cpu")

    def _se(self, path: Path):
        conv = self._conv
        r = conv.extract_se([str(path)])
        return r[0] if isinstance(r, tuple) else r

    def clone(self, base_audio: Path, ref_audio: Path,
              out_audio: Path) -> float | None:
        """Re-voice `base_audio` (generic TTS) to sound like the speaker in
        `ref_audio`. Converts in ~30 s chunks so a long track never becomes one
        huge tensor (which hangs/OOMs). Runs on GPU (~15× faster) with automatic
        CPU fallback if VRAM is tight. Returns measured similarity (%)."""
        import torch
        from . import media

        self._load()
        tgt = self._se(ref_audio)      # source speaker (to imitate)

        chunk_dir = out_audio.parent / f"{out_audio.stem}_chunks"
        chunks = media.split_audio(base_audio, chunk_dir, seconds=30.0)

        def is_oom(exc: Exception) -> bool:
            m = str(exc).lower()
            return "out of memory" in m or "cuda" in m or "cublas" in m

        def run() -> list[Path]:
            if not chunks:             # short track → single pass
                src = self._se(base_audio)
                self._conv.convert(audio_src_path=str(base_audio), src_se=src,
                                   tgt_se=tgt, output_path=str(out_audio),
                                   message="@TH-Labs")
                return [out_audio] if out_audio.exists() else []
            src = self._se(chunks[0])  # source voice embedding from first chunk
            outs = []
            for ch in chunks:
                o = ch.with_name(ch.stem + "_c.wav")
                self._conv.convert(audio_src_path=str(ch), src_se=src, tgt_se=tgt,
                                   output_path=str(o), message="@TH-Labs")
                if o.exists():
                    outs.append(o)
            return outs

        try:
            chunks_out = run()
        except Exception as exc:
            if self._device != "cpu" and is_oom(exc):
                self._fallback_cpu()   # VRAM too tight → redo on CPU
                tgt = self._se(ref_audio)
                chunks_out = run()
            else:
                raise

        if len(chunks_out) > 1:
            media.concat_audio(chunks_out, out_audio)
        elif chunks_out and chunks_out[0] != out_audio:
            media.copy_passthrough(chunks_out[0], out_audio)

        if not out_audio.exists() or not chunks_out:
            return None

        def cos(a, b) -> float:
            a = a.flatten().float(); b = b.flatten().float()
            return float(torch.dot(a, b) / (a.norm() * b.norm() + 1e-8))

        sim = round(max(0.0, min(99.9, cos(self._se(chunks_out[0]), tgt) * 100)), 1)
        # tidy chunk scratch
        try:
            for p in chunk_dir.glob("*.wav"):
                p.unlink(missing_ok=True)
            chunk_dir.rmdir()
        except Exception:
            pass
        return sim

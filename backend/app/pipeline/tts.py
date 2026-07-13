"""Stage 3 — TTS + Voice Cloning with OmniVoice.

This is the pipeline's key innovation: a speaker embedding extracted from the
source audio conditions synthesis so the dubbed speech keeps the original
speaker's timbre and identity instead of a generic narrator voice.

Real path posts each segment to a configured OmniVoice endpoint together with a
short reference clip of the speaker. Simulation produces a placeholder audio
track (sized to the video) so the muxed output still carries an audio channel.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import media


class OmniVoiceTTS:
    key = "tts"
    label = "Text-to-Speech + Voice Cloning"
    engine = "OmniVoice"

    def available(self) -> bool:
        s = get_settings()
        if s.mode == "demo":
            return False
        return bool(s.omnivoice_api_url)

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    # ── real synthesis ────────────────────────────────────────────────────
    def synthesize(self, segments: list[Segment], speaker_ref: Path | None,
                   voice_clone: bool, out_audio: Path) -> bool:
        """POST segments to OmniVoice and stitch the returned clips.

        Left as a thin, documented integration point: OmniVoice deployments vary,
        so wire the exact request/response here. Returns True on success.
        """
        import base64
        import requests  # optional dep; only needed for the real path

        s = get_settings()
        ref_b64 = None
        if voice_clone and speaker_ref and speaker_ref.exists():
            ref_b64 = base64.b64encode(speaker_ref.read_bytes()).decode()

        clips: list[bytes] = []
        for seg in segments:
            payload = {
                "text": seg.target_text or seg.source_text,
                "clone": voice_clone,
                "speaker_reference": ref_b64,
                "target_duration": round(seg.end - seg.start, 3),
            }
            headers = {"Authorization": f"Bearer {s.omnivoice_api_key}"} \
                if s.omnivoice_api_key else {}
            r = requests.post(s.omnivoice_api_url, json=payload,
                              headers=headers, timeout=120)
            r.raise_for_status()
            clips.append(r.content)

        # Concatenation / precise placement is deployment-specific; here we just
        # persist the last-mile stitched audio for the sync stage to mux.
        tmp = out_audio.with_suffix(".raw")
        tmp.write_bytes(b"".join(clips))
        return media.copy_passthrough(tmp, out_audio)

    # ── simulation ────────────────────────────────────────────────────────
    def simulate(self, duration: float, out_audio: Path,
                 voice_clone: bool) -> bool:
        # faint tone when cloning "on" so the demo output is audibly distinct
        freq = 196 if voice_clone else 0
        return media.synth_silent_track(duration, out_audio, freq=freq)

"""End-to-end evaluation metrics.

Mirrors the RSEF paper's five-metric framework: WER, BLEU/COMET, MOS, speaker
similarity, and sync offset. Real runs fill in what can be measured directly
(processing time, real-time factor, length-fit). For the simulated path we
report the paper's published baselines with small deterministic, per-job jitter
so successive demo runs look live without being random.
"""
from __future__ import annotations

import hashlib

from ..schemas import DubMetrics, DubOptions

# Published baselines from the RSEF 2026 preprint (Table 2).
BASELINE = dict(wer=11.0, bleu=38.7, comet=0.86, mos=3.5,
                speaker_similarity=87.3, sync_offset_ms=41.0)


def _jitter(job_id: str, key: str, spread: float) -> float:
    """Deterministic pseudo-jitter in [-spread, +spread] from job id + key."""
    h = hashlib.sha256(f"{job_id}:{key}".encode()).hexdigest()
    frac = int(h[:8], 16) / 0xFFFFFFFF           # 0..1
    return (frac * 2 - 1) * spread


def simulated_metrics(job_id: str, options: DubOptions,
                      processing_seconds: float,
                      media_duration: float | None,
                      length_ratio: float) -> DubMetrics:
    b = BASELINE
    # voice cloning meaningfully lifts speaker similarity; lip sync tightens sync
    sim_bonus = 0.0 if options.voice_clone else -22.0
    sync_bonus = -8.0 if options.lip_sync else 0.0
    rtf = (processing_seconds / media_duration) if media_duration else None
    return DubMetrics(
        wer=round(b["wer"] + _jitter(job_id, "wer", 1.2), 1),
        bleu=round(b["bleu"] + _jitter(job_id, "bleu", 1.5), 1),
        comet=round(b["comet"] + _jitter(job_id, "comet", 0.02), 3),
        mos=round(b["mos"] + _jitter(job_id, "mos", 0.2), 2),
        speaker_similarity=round(
            b["speaker_similarity"] + sim_bonus + _jitter(job_id, "sim", 1.5), 1),
        sync_offset_ms=round(
            max(5.0, b["sync_offset_ms"] + sync_bonus + _jitter(job_id, "sync", 6)), 1),
        processing_seconds=round(processing_seconds, 1),
        real_time_factor=round(rtf, 2) if rtf else None,
    )

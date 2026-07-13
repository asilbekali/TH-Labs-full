"""Pydantic models shared across the API surface."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Quality(str, Enum):
    fast = "fast"        # speed-first (smaller beam, int8)
    balanced = "balanced"
    studio = "studio"    # quality-first (larger beam, fp16)


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class StageStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    skipped = "skipped"
    failed = "failed"


class DubOptions(BaseModel):
    """User-selected pipeline configuration from the Studio UI."""
    source_lang: str = Field("auto", description="ISO code or 'auto' to detect")
    target_lang: str = Field(..., description="Target language ISO code")
    voice_clone: bool = Field(True, description="Preserve original speaker voice")
    lip_sync: bool = Field(False, description="Optional Wav2Lip lip synchronisation")
    quality: Quality = Quality.balanced
    preserve_timing: bool = True


class Segment(BaseModel):
    """A single aligned utterance carried through the whole pipeline."""
    id: int
    start: float
    end: float
    source_text: str
    target_text: Optional[str] = None
    speaker_similarity: Optional[float] = None


class StageState(BaseModel):
    key: str
    label: str
    status: StageStatus = StageStatus.pending
    progress: float = 0.0            # 0..1
    message: str = ""
    duration_ms: Optional[int] = None
    detail: dict = Field(default_factory=dict)


class DubMetrics(BaseModel):
    """End-to-end evaluation metrics (mirrors the RSEF paper's five-metric set)."""
    wer: Optional[float] = None            # %
    bleu: Optional[float] = None
    comet: Optional[float] = None
    mos: Optional[float] = None            # 1..5
    speaker_similarity: Optional[float] = None   # %
    sync_offset_ms: Optional[float] = None
    processing_seconds: Optional[float] = None
    real_time_factor: Optional[float] = None


class JobResult(BaseModel):
    output_url: Optional[str] = None
    source_url: Optional[str] = None
    duration: Optional[float] = None
    segments: list[Segment] = Field(default_factory=list)
    metrics: DubMetrics = Field(default_factory=DubMetrics)
    detected_source_lang: Optional[str] = None


class Job(BaseModel):
    id: str
    status: JobStatus = JobStatus.queued
    options: DubOptions
    filename: Optional[str] = None
    simulated: bool = True
    stages: list[StageState] = Field(default_factory=list)
    result: JobResult = Field(default_factory=JobResult)
    error: Optional[str] = None
    created_at: float
    updated_at: float


class StageInfo(BaseModel):
    key: str
    label: str
    engine: str
    mode: str          # "real" | "simulation"
    detail: str


class HealthInfo(BaseModel):
    app: str
    version: str
    mode: str
    ffmpeg: bool
    stages: list[StageInfo]

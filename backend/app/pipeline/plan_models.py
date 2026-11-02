"""Which models a dub runs on, by the user's plan and the quality they picked.

The plan decides WHAT a user may ask for (api/src/payment/plan-features.ts);
this decides how well it is done. Paid plans get the larger recogniser at the
same quality, and the LLM pass that repairs visibly wrong translations
(pipeline/refine.py).

             Fast           Balanced        Studio          translation repair
  Free       whisper base   whisper small   —               off
  Pro        whisper small  whisper medium  —               on
  Studio Max whisper small  whisper medium  whisper large-v3 on

`tier` is None when billing is off (local runs, docker compose) or the billing
API predates the field. Those keep the old quality-only mapping and the repair
pass, so nothing changes where there is no plan to read.

Every Whisper model named here must be baked into the image
(deploy/modal/modal_app.py, _download_models), or the first dub on it spends
minutes downloading.
"""
from __future__ import annotations

from dataclasses import dataclass

# The mapping before plans picked models; still used when the tier is unknown.
QUALITY_WHISPER = {"fast": "base", "balanced": "small", "studio": "medium"}

_PLAN_WHISPER: dict[str, dict[str, str]] = {
    "FREE": {"fast": "base", "balanced": "small"},
    "PRO": {"fast": "small", "balanced": "medium"},
    "STUDIO": {"fast": "small", "balanced": "medium", "studio": "large-v3"},
}

_PLAN_REFINE = {"FREE": False, "PRO": True, "STUDIO": True}


@dataclass(frozen=True)
class Models:
    whisper: str
    refine: bool


def models_for(tier: str | None, quality: str) -> Models:
    """The models for one dub. Never raises: an unknown tier or a quality the
    plan does not list (the billing API already refused those) falls back to
    the quality-only mapping."""
    plan = _PLAN_WHISPER.get((tier or "").upper())
    whisper = (plan or {}).get(quality) or QUALITY_WHISPER.get(quality, "small")
    refine = _PLAN_REFINE.get((tier or "").upper(), True)
    return Models(whisper=whisper, refine=refine)

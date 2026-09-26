"""Server-side credit enforcement against the NestJS billing API.

`POST /api/jobs` runs the full ASR->NMT->TTS pipeline on an L4 GPU. Auth alone
only proves *who* is asking; it says nothing about whether they have paid. The
Studio does call `/v1/payments/can-dub` and `/v1/payments/commit-dub` before it
starts a job, but that is a browser doing the asking — anyone holding a valid
access token can POST straight to this API and skip it. Without the checks
below, a signed-in free-tier user can bill this deployment for unlimited GPU
time, and the credit ledger never moves.

So the same two calls are made here, server-side, where they cannot be skipped:

    can-dub     read-only preflight; refuses the job if credits are short or
                the clip is longer than the free-dub allowance
    commit-dub  the actual charge, idempotent on jobId, so the Studio calling
                it too (it still does) can never double-charge

The caller's own bearer token is forwarded rather than a service credential:
those endpoints already authenticate the user, the token is short-lived, and it
keeps this module free of any shared secret of its own.

Disabled when `TH_LABS_ACCOUNT_API_URL` is unset — local runs and the docker
compose stack have no account API, and should keep working exactly as before.
When it *is* set, every failure path denies the dub rather than allowing it:
a billing API that cannot be reached must not become a free GPU.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, status

from .config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()


@dataclass(frozen=True)
class Gate:
    """What the billing API decided about one prospective dub."""

    allowed: bool
    cost: int = 0
    balance: int = 0
    is_free_dub: bool = False
    reason: str | None = None


def enabled() -> bool:
    """Billing is enforced only when an account API is configured."""
    return bool(settings.account_api_url)


def _base() -> str:
    return settings.account_api_url.rstrip("/")


def _payment_required(gate: Gate) -> HTTPException:
    """402 with the same reason codes the Studio already renders."""
    if gate.reason == "FREE_DUB_LENGTH_EXCEEDED":
        detail = ("Your free dub covers clips up to "
                  f"{settings.free_dub_max_seconds}s — this one is longer.")
    elif gate.reason == "INSUFFICIENT_CREDITS":
        detail = (f"Not enough credits — this dub costs {gate.cost}, "
                  f"you have {gate.balance}.")
    else:
        detail = gate.reason or "This dub was refused by billing."
    return HTTPException(status.HTTP_402_PAYMENT_REQUIRED, detail)


async def _post(path: str, token: str, payload: dict) -> dict:
    """One authenticated call to the billing API. Raises on any failure."""
    import httpx

    url = f"{_base()}{path}"
    async with httpx.AsyncClient(timeout=settings.billing_timeout) as client:
        resp = await client.post(
            url, json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
    if resp.status_code == 401:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Sign in to continue",
                            headers={"WWW-Authenticate": "Bearer"})
    if resp.status_code >= 400:
        # Surface the billing API's own message when it sent one.
        detail = ""
        try:
            body = resp.json()
            detail = body.get("message") or body.get("error") or ""
            if isinstance(detail, list):
                detail = "; ".join(str(d) for d in detail)
        except Exception:
            detail = resp.text[:200]
        log.warning("billing %s -> %s %s", path, resp.status_code, detail)
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED,
                            detail or "Billing refused this dub.")
    return resp.json()


async def can_dub(token: str, duration_seconds: float, quality: str) -> Gate:
    """Preflight. Charges nothing; raises 402/401 if the dub may not run."""
    if not enabled():
        return Gate(allowed=True)

    payload = {"durationSeconds": round(float(duration_seconds), 3),
               "quality": quality}
    try:
        data = await _post("/payments/can-dub", token, payload)
    except HTTPException:
        raise
    except Exception as exc:
        # Unreachable billing API. Deny — see the module docstring.
        log.error("billing can-dub unreachable: %s: %s", type(exc).__name__, exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Could not verify your credits right now. Please try again.",
        ) from exc

    gate = Gate(
        allowed=bool(data.get("allowed")),
        cost=int(data.get("cost") or 0),
        balance=int(data.get("balance") or 0),
        is_free_dub=bool(data.get("isFreeDub")),
        reason=data.get("reason"),
    )
    if not gate.allowed:
        raise _payment_required(gate)
    return gate


async def commit_dub(token: str, job_id: str, duration_seconds: float,
                     quality: str) -> Gate:
    """The charge. Idempotent on job_id, so the Studio's own call is harmless."""
    if not enabled():
        return Gate(allowed=True)

    payload = {"jobId": job_id,
               "durationSeconds": round(float(duration_seconds), 3),
               "quality": quality}
    try:
        data = await _post("/payments/commit-dub", token, payload)
    except HTTPException:
        raise
    except Exception as exc:
        log.error("billing commit-dub unreachable: %s: %s",
                  type(exc).__name__, exc)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Could not charge this dub right now. Please try again.",
        ) from exc

    return Gate(
        allowed=True,
        cost=int(data.get("cost") or 0),
        balance=int(data.get("balance") or 0),
        is_free_dub=bool(data.get("isFreeDub")),
    )

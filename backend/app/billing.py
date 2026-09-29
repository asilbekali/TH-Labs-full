"""Server-side credit enforcement against the NestJS billing API.

`POST /api/jobs` runs the full ASR->NMT->TTS pipeline on an L4 GPU. Auth alone
only proves *who* is asking; it says nothing about whether they have paid. The
Studio does call `/v1/payments/can-dub` and `/v1/payments/commit-dub` before it
starts a job, but that is a browser doing the asking — anyone holding a valid
access token can POST straight to this API and skip it. Without the checks
below, a signed-in free-tier user can bill this deployment for unlimited GPU
time, and the credit ledger never moves.

So the same two calls are made here, server-side, where they cannot be skipped:

    can-dub     read-only preflight. Returns how much of the clip the balance
                covers (`billableSeconds`), which is what the trim is cut to
    commit-dub  the actual charge, for the seconds actually dubbed, idempotent
                on jobId so the Studio calling it too can never double-charge

Credits are priced per second (20 a minute at Balanced), so a short balance is
not a flat refusal: it buys the front of the video. A refusal means the balance
buys nothing at all.

The caller's own bearer token is forwarded rather than a service credential:
those endpoints already authenticate the user, the token is short-lived, and it
keeps this module free of any shared secret of its own.

Disabled when `TH_LABS_ACCOUNT_API_URL` is unset — local runs and the docker
compose stack have no account API, and should keep working exactly as before.
When it *is* set, every failure path denies the dub rather than allowing it:
a billing API that cannot be reached must not become a free GPU.

One thing this module deliberately does NOT do any more: report every upstream
failure as 402. It used to map any status >= 400 from the billing API onto
"Payment Required", which meant a malformed payload, a renamed route or a
database hiccup all reached the user as "you need to pay" — and did exactly
that in production, for months, to users with full wallets (see
api/src/payment/dto/can-dub.dto.ts). A 402 is now only ever sent when the
billing API actually said the wallet is short.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from fastapi import HTTPException, status

from .config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

# Reason codes the billing API uses for a genuine payment refusal. Anything
# else in an error body is OUR bug, not the user's problem, and must not be
# dressed up as a request for money.
_PAYMENT_REASONS = ("INSUFFICIENT_CREDITS",)


@dataclass(frozen=True)
class Gate:
    """What the billing API decided about one prospective dub."""

    allowed: bool
    # Credits the FULL clip would cost.
    cost: int = 0
    balance: int = 0
    # Seconds the balance actually pays for. Less than the clip's length when
    # the wallet is short — the pipeline trims to this.
    billable_seconds: float = 0.0
    # Credits for `billable_seconds`; what commit-dub will charge.
    billable_cost: int = 0
    # True when billable_seconds < the requested duration.
    trimmed: bool = False
    # Longest clip this balance could dub at this quality.
    affordable_seconds: float = 0.0
    credits_per_minute: int = 20
    reason: str | None = None

    def notice(self, source_seconds: float) -> str | None:
        """The sentence shown to the user when their dub was cut short."""
        if not self.trimmed:
            return None
        return (
            f"Your balance covered {_mmss(self.billable_seconds)} of this "
            f"{_mmss(source_seconds)} video, so only the first "
            f"{_mmss(self.billable_seconds)} was dubbed "
            f"({self.billable_cost} credits). Buy credits or a plan to dub the "
            "whole thing."
        )


def _mmss(seconds: float) -> str:
    """`95.4` -> `1m 35s`. Used in messages the user reads."""
    total = int(math.floor(max(0.0, float(seconds))))
    if total < 60:
        return f"{total}s"
    minutes, rest = divmod(total, 60)
    return f"{minutes}m {rest}s" if rest else f"{minutes}m"


def enabled() -> bool:
    """Billing is enforced only when an account API is configured."""
    return bool(settings.account_api_url)


def _base() -> str:
    return settings.account_api_url.rstrip("/")


def _unavailable(what: str) -> HTTPException:
    """503, for every failure that is ours rather than the user's wallet."""
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        f"Could not {what} right now. Please try again in a moment.",
    )


async def _post(path: str, token: str, payload: dict) -> dict:
    """One authenticated call to the billing API. Raises on any failure.

    Status mapping, which is the whole point of this function:

      401       -> 401, forwarded. The token is bad or expired.
      402       -> 402, forwarded with the billing API's own message.
      400 + a   -> 402. `commit-dub` reports a short wallet this way on older
      known        deployments; the reason code is what distinguishes it from a
      reason       validation error, never the status alone.
      anything  -> 503. A 400 we don't recognise, a 404, a 5xx: our bug or our
      else         outage. Logged loudly, and the user is asked to retry rather
                   than asked to pay.
    """
    import httpx

    url = f"{_base()}{path}"
    async with httpx.AsyncClient(timeout=settings.billing_timeout) as client:
        resp = await client.post(
            url, json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )

    if resp.status_code < 400:
        return resp.json()

    if resp.status_code == 401:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Sign in to continue",
                            headers={"WWW-Authenticate": "Bearer"})

    # Pull out whatever the billing API said, for the log and possibly the user.
    body: dict = {}
    detail = ""
    try:
        parsed = resp.json()
        if isinstance(parsed, dict):
            body = parsed
            detail = body.get("message") or body.get("error") or ""
            if isinstance(detail, list):
                detail = "; ".join(str(d) for d in detail)
    except Exception:
        detail = resp.text[:200]

    reason = body.get("reason")
    is_payment = resp.status_code == status.HTTP_402_PAYMENT_REQUIRED or (
        reason in _PAYMENT_REASONS
    ) or detail in _PAYMENT_REASONS

    if is_payment:
        log.info("billing %s refused: %s %s", path, reason or "402", detail)
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail or "Not enough credits for this dub.",
        )

    # Ours, not theirs. Loud, because this is the failure mode that used to be
    # invisible: it looked like a paywall and nobody went looking for a bug.
    log.error(
        "billing %s failed with %s (NOT a payment problem): %s | payload=%s",
        path, resp.status_code, detail or "<no body>", payload,
    )
    raise _unavailable("verify your credits")


def _gate_from(data: dict, requested_seconds: float) -> Gate:
    """Build a Gate from a can-dub response, tolerating an older API shape.

    `billableSeconds` and friends are new. A billing API that predates them
    answers only allowed/cost/balance, in which case "allowed" meant "can afford
    the whole clip" — so the safe reading is no trim at all.
    """
    allowed = bool(data.get("allowed"))
    cost = int(data.get("cost") or 0)
    balance = int(data.get("balance") or 0)

    if "billableSeconds" in data:
        billable = max(0.0, float(data.get("billableSeconds") or 0.0))
        billable_cost = int(data.get("billableCost") or 0)
        trimmed = bool(data.get("trimmed"))
        affordable = max(0.0, float(data.get("affordableSeconds") or 0.0))
    else:
        billable = requested_seconds if allowed else 0.0
        billable_cost = cost if allowed else 0
        trimmed = False
        affordable = requested_seconds if allowed else 0.0

    return Gate(
        allowed=allowed,
        cost=cost,
        balance=balance,
        billable_seconds=billable,
        billable_cost=billable_cost,
        trimmed=trimmed,
        affordable_seconds=affordable,
        credits_per_minute=int(data.get("creditsPerMinute") or 20),
        reason=data.get("reason"),
    )


async def can_dub(token: str, duration_seconds: float, quality: str) -> Gate:
    """Preflight. Charges nothing.

    Raises 402 only when the balance buys no dubbing at all. A balance that
    covers part of the clip comes back as an allowed Gate with `trimmed` set and
    `billable_seconds` below the clip's length — the caller cuts the media to
    that and dubs what was paid for.
    """
    if not enabled():
        return Gate(allowed=True, billable_seconds=duration_seconds,
                    affordable_seconds=duration_seconds)

    payload = {"durationSeconds": round(float(duration_seconds), 3),
               "quality": quality}
    try:
        data = await _post("/payments/can-dub", token, payload)
    except HTTPException:
        raise
    except Exception as exc:
        # Unreachable billing API. Deny — see the module docstring.
        log.error("billing can-dub unreachable: %s: %s", type(exc).__name__, exc)
        raise _unavailable("verify your credits") from exc

    gate = _gate_from(data, float(duration_seconds))
    if not gate.allowed:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"You have {gate.balance} credits — not enough to dub any of this "
            f"video. A minute costs {gate.credits_per_minute} at "
            f"{quality} quality. Buy credits or a plan to continue.",
        )
    return gate


async def commit_dub(token: str, job_id: str, duration_seconds: float,
                     quality: str) -> Gate:
    """The charge, for the seconds ACTUALLY dubbed (post-trim).

    Idempotent on job_id, so the Studio's own call is harmless.
    """
    if not enabled():
        return Gate(allowed=True, billable_seconds=duration_seconds)

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
        raise _unavailable("charge this dub") from exc

    return Gate(
        allowed=True,
        cost=int(data.get("cost") or 0),
        billable_cost=int(data.get("cost") or 0),
        balance=int(data.get("balance") or 0),
        billable_seconds=float(data.get("durationSeconds")
                               or duration_seconds),
    )

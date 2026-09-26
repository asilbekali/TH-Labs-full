"""Bearer-token auth for the Studio API.

The Studio has no user database of its own. Accounts live in the NestJS API
(`api/`, PostgreSQL/Prisma), which mints the HS256 JWTs that arrive here — so
this module only *verifies*, it never issues. The one piece of shared state is
the signing secret: TH_LABS_JWT_SECRET here must equal JWT_SECRET there, or
every request 401s.

Why this exists at all: `POST /api/jobs` runs the full ASR→NMT→TTS pipeline on
an L4 GPU. Unauthenticated, that is a public GPU anyone can bill to this
deployment, and the job store would hold strangers' uploaded video alongside
its transcript. Both are closed by requiring a token here.

Deliberately NOT verified: the token's `role`. Every signed-in user may dub;
there is no privileged operation on this API. Add a role check at the call site
if that changes rather than widening this dependency.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

# auto_error=False so a MISSING header reaches our own handler and returns the
# same 401 shape as a malformed one. With the default, FastAPI raises a bare
# 403 for "no header", which reads as "logged in but forbidden" and sends the
# Studio down the wrong recovery path.
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class StudioUser:
    """The subset of the JWT payload this API acts on."""

    id: int
    email: str
    role: str
    # The raw bearer token this user presented. Carried so app/billing.py can
    # forward it to the account API's credit endpoints on the user's behalf,
    # instead of this service holding a credential of its own.
    token: str = ""


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        # Tells the Studio to try its refresh flow rather than treat this as a
        # dead end. Without the challenge header a 401 is ambiguous.
        headers={"WWW-Authenticate": "Bearer"},
    )


def _decode(token: str) -> StudioUser:
    if not settings.jwt_secret:
        # Fail closed. A blank secret would otherwise mean "verify against
        # empty", and with an algorithm allowlist that at best rejects
        # everything confusingly — better to name the real cause.
        log.error("TH_LABS_JWT_SECRET is not set; refusing to verify tokens")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured on this server.",
        )

    try:
        import jwt  # PyJWT
    except ImportError:  # pragma: no cover - dependency is in requirements.txt
        log.error("PyJWT is not installed; cannot verify bearer tokens")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured on this server.",
        )

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            # Pinned, not read from the token. Accepting the header's `alg`
            # is what lets an attacker present alg=none, or hand back an
            # HS256 token signed with a public RS256 key.
            algorithms=["HS256"],
            options={
                # Presence checks. `require` only asserts the claim exists.
                "require": ["exp", "sub"],
                # PyJWT checks exp by default; stated so it survives edits.
                "verify_exp": True,
                # PyJWT >= 2.10 enforces RFC 7519's "sub MUST be a StringOrURI"
                # and rejects anything else. The tokens we actually receive put
                # a NUMBER there — api/src/auth/auth.service.ts signs
                # `sub: user.id`, and user.id is an autoincrement Int — so
                # leaving this on rejects every genuine token with
                # InvalidSubjectError. The type is normalised below instead;
                # this disables PyJWT's format opinion, not the signature or
                # expiry checks.
                "verify_sub": False,
            },
        )
    except Exception as exc:
        # Includes expiry, bad signature, and malformed input. The Studio only
        # needs "not valid" — which one it was is a server-side detail.
        log.info("rejected bearer token: %s", type(exc).__name__)
        raise _unauthorized("Invalid or expired token")

    # `sub` is the numeric user id from the NestJS JwtPayload. It arrives as an
    # int, but PyJWT permits a string subject, so normalise instead of trusting.
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise _unauthorized("Invalid or expired token")

    return StudioUser(
        id=user_id,
        email=str(payload.get("email", "")),
        role=str(payload.get("role", "USER")),
        token=token,
    )


def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> StudioUser:
    """Dependency for routes that must have a signed-in user."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized("Sign in to continue")
    return _decode(credentials.credentials)


def require_user_sse(request: Request) -> StudioUser:
    """Same check, for the SSE endpoint.

    EventSource cannot send an Authorization header — the browser API takes a
    URL and nothing else — so the progress stream accepts the token as
    `?access_token=`. That is the one place a token legitimately appears in a
    URL here, and the trade is narrow: it is the SHORT-lived access token
    (15m), never the refresh token, the request is same-origin so it does not
    cross into anyone else's logs, and the alternative is leaving the stream
    unauthenticated. Everything else uses the header.
    """
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return _decode(header[len("Bearer ") :])

    token = request.query_params.get("access_token")
    if token:
        return _decode(token)

    raise _unauthorized("Sign in to continue")

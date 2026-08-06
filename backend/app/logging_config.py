"""Logging setup for the dubbing backend.

Without this the app had no logging configuration at all, which meant two
things on Modal: `log.info(...)` was discarded entirely (the root logger
defaults to WARNING), and `log.warning(...)` only survived via Python's
"handler of last resort". So the pipeline could take a completely different
branch than expected — skip separation, fall back to a flat mix, lose a demucs
crash — and the container logs would look identical either way.

Everything goes to stdout because that is what Modal captures. Level is
TH_LABS_LOG_LEVEL (default INFO), so a noisy debug session is an env var
rather than a redeploy.
"""
from __future__ import annotations

import logging
import os
import sys

_CONFIGURED = False

# Our own package. Third-party loggers are left alone so this does not turn on
# torch/urllib3 debug spam along with the app's own trace.
_APP_LOGGER = "app"


def setup_logging() -> None:
    """Attach a stdout handler to the app logger. Safe to call more than once."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    level_name = os.getenv("TH_LABS_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
            datefmt="%H:%M:%S",
        )
    )

    logger = logging.getLogger(_APP_LOGGER)
    logger.setLevel(level)
    logger.handlers.clear()
    logger.addHandler(handler)
    # Don't hand records to the root logger as well — uvicorn installs its own
    # handler there and every line would print twice.
    logger.propagate = False

    _CONFIGURED = True
    logger.info("logging configured at %s", level_name)

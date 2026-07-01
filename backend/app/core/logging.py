"""Central logging configuration.

A single place to set up application logging so every module logs consistently
(the scheduler already used a named logger; now the whole app does). Call
``configure_logging()`` once at startup. Level is driven by ``ATLAS_LOG_LEVEL``.
"""

from __future__ import annotations

import logging

_CONFIGURED = False

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def configure_logging(level: str = "INFO") -> None:
    """Idempotently configure root logging for the app."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format=_FORMAT,
    )
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)

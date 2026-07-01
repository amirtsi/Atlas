from datetime import UTC, datetime
from zoneinfo import ZoneInfo


def utc_now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def to_utc_iso(value: str | datetime | None, *, assume_tz: str = "UTC") -> str | None:
    """Normalize a timestamp to tz-aware UTC ISO (``...+00:00``).

    Accepts ISO strings (``T`` or space separated, with ``Z`` / offset / naive)
    or a ``datetime``. A naive value is interpreted as ``assume_tz`` before being
    converted to UTC. Returns ``None`` for empty input."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        text = text.replace(" ", "T")
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo(assume_tz))
    return dt.astimezone(UTC).replace(microsecond=0).isoformat()

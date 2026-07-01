"""Standalone daily-brief sender — the target of the launchd/cron trigger.

Unlike the in-app scheduler (which only runs while uvicorn is up), this runs as a
one-shot process: the OS scheduler fires it, it composes each active provider's
brief from real dashboard signals and sends it via Evolution, then exits. It is
idempotent (``dispatch_due_briefs`` sends at most one brief per provider per UTC
day), so it can safely overlap the in-app scheduler.

    cd backend && .venv/bin/python -m scripts.send_daily_brief
"""

from app.core.time import utc_now_iso
from app.modules.communication.scheduler import dispatch_due_briefs


def main() -> None:
    results = dispatch_due_briefs()
    sent = [r for r in results if r.get("status") == "sent"]
    skipped = [r for r in results if r.get("status") == "skipped_already_sent"]
    print(f"[{utc_now_iso()}] daily brief: {len(sent)} sent, {len(skipped)} skipped, {len(results)} provider(s).")
    for result in results:
        print(f"  {result}")


if __name__ == "__main__":
    main()

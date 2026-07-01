"""Builds a compact, read-only pack of the owner's REAL logged data for the coach.

Composes the existing dashboard service (signals + active modules with behavior +
recent activities + weekly balance) and, when the question names an active module,
flags it as the focus. Pure read + shape — no LLM, no writes. The dashboard
service opens its own connection; WAL mode makes that safe alongside the webhook.
"""
from __future__ import annotations

from app.modules.dashboard.service import get_today_dashboard


def _find_focus_module(text: str, modules: list[dict]) -> dict | None:
    lowered = text.lower()
    for module in modules:
        name = str(module.get("name") or "").lower()
        if name and name in lowered:
            return module
    return None


def build_context(text: str) -> dict:
    dashboard = get_today_dashboard()

    active_modules = [
        {
            "name": module.get("name"),
            "type": module.get("type"),
            "status": module.get("status"),
            "summary": (module.get("behavior") or {}).get("summary") or {},
        }
        for module in (dashboard.get("active_modules") or [])
    ]
    recent_activities = [
        {
            "title": activity.get("title"),
            "occurred_at": activity.get("occurred_at"),
            "duration_minutes": activity.get("duration_minutes"),
            "module": activity.get("module_name"),
        }
        for activity in (dashboard.get("recent_activities") or [])
    ]
    weekly_balance = [
        {
            "discipline": item.get("discipline_name"),
            "activity_count": item.get("activity_count"),
            "duration_minutes": item.get("duration_minutes"),
        }
        for item in (dashboard.get("weekly_balance") or [])
    ]

    return {
        "signals": dashboard.get("real_signals") or {},
        "weekly_balance": weekly_balance,
        "active_modules": active_modules,
        "recent_activities": recent_activities,
        "focus_module": _find_focus_module(text, active_modules),
    }

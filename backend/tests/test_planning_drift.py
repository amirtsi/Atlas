from app.modules.planning.service import compute_drift


def test_drift_negative_when_behind():
    goal = {"target_date": "2026-07-11T00:00:00+00:00"}
    plan = {"activated_at": "2026-07-01T00:00:00+00:00", "status": "active"}
    drift = compute_drift(goal, plan, actual_percent=0.0)
    assert drift is not None
    assert set(drift) == {"expected_percent", "actual_percent", "drift", "projected_completion", "on_track"}
    assert drift["actual_percent"] == 0.0
    assert drift["drift"] <= 0.0


def test_drift_none_without_target_date():
    goal = {"target_date": None}
    plan = {"activated_at": "2026-07-01T00:00:00+00:00", "status": "active"}
    assert compute_drift(goal, plan, actual_percent=0.5) is None


def test_drift_none_without_activation():
    goal = {"target_date": "2026-08-01T00:00:00+00:00"}
    plan = {"activated_at": None, "status": "proposed"}
    assert compute_drift(goal, plan, actual_percent=0.5) is None


def test_drift_handles_bare_date_target():
    # A bare date string is naive; it must be treated as UTC (no TypeError).
    goal = {"target_date": "2020-01-01"}
    plan = {"activated_at": "2019-01-01T00:00:00+00:00", "status": "active"}
    drift = compute_drift(goal, plan, actual_percent=0.0)
    assert drift is not None
    assert drift["on_track"] is False  # target long past, 0 progress

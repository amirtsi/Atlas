from fastapi.testclient import TestClient

from app.core.database import db_connection, new_id
from app.core.time import utc_now_iso
from app.main import app
from app.modules.planning.service import create_goal
from app.modules.proposals.service import accept_proposal, create_proposal
from app.shared.schemas import GoalCreate


def _goal_with_plan(conn):
    goal = create_goal(conn, GoalCreate(title="Pass OSCP"))
    plan_id = new_id()
    now = utc_now_iso()
    conn.execute(
        "INSERT INTO plans (id, goal_id, version, status, created_at) VALUES (?, ?, 1, 'proposed', ?)",
        (plan_id, goal["id"], now),
    )
    return goal, plan_id


def test_accept_activate_plan_proposal_activates_plan_and_goal():
    with TestClient(app):
        with db_connection() as conn:
            goal, plan_id = _goal_with_plan(conn)
            proposal = create_proposal(
                conn, "activate_plan", "Plan for OSCP", "decomposed", {"plan_id": plan_id}
            )
            accept_proposal(conn, proposal["id"])
            plan = conn.execute("SELECT status FROM plans WHERE id = ?", (plan_id,)).fetchone()
            g = conn.execute("SELECT status, active_plan_id FROM goals WHERE id = ?", (goal["id"],)).fetchone()
    assert plan["status"] == "active"
    assert g["status"] == "active"
    assert g["active_plan_id"] == plan_id


def test_activate_plan_is_a_registered_type():
    with TestClient(app):
        from app.modules.proposals.service import KNOWN_TYPES

        assert "activate_plan" in KNOWN_TYPES

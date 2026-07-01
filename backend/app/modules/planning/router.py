from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, rows_to_dicts
from app.modules.planning.service import (
    create_goal,
    generate_replan_proposal,
    get_goal_plan,
    propose_plan_for_goal,
)
from app.shared.schemas import GoalCreate, GoalOut, ProposalOut

router = APIRouter(prefix="/planning", tags=["planning"])


@router.post("/goals", status_code=201, response_model=GoalOut)
def create(payload: GoalCreate) -> dict:
    with db_connection() as conn:
        return create_goal(conn, payload)


@router.get("/goals", response_model=list[GoalOut])
def list_goals(status: str | None = None) -> list[dict]:
    sql = "SELECT * FROM goals"
    params: list[object] = []
    if status:
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("/goals/{goal_id}/propose-plan", response_model=ProposalOut)
def propose_plan(goal_id: str) -> dict:
    with db_connection() as conn:
        return propose_plan_for_goal(conn, goal_id)


@router.get("/goals/{goal_id}/plan")
def goal_plan(goal_id: str) -> dict:
    with db_connection() as conn:
        result = get_goal_plan(conn, goal_id)
    if result is None:
        raise HTTPException(status_code=404, detail="No plan for this goal yet")
    return result


@router.post("/goals/{goal_id}/replan")
def replan(goal_id: str) -> dict:
    with db_connection() as conn:
        return generate_replan_proposal(conn, goal_id)

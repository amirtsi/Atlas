from fastapi import APIRouter, HTTPException

from app.core.database import db_connection, rows_to_dicts
from app.modules.planning.service import (
    abandon_goal,
    create_goal,
    generate_replan_proposal,
    get_goal_plan,
    link_activity_to_step,
    propose_plan_for_goal,
    unlink_activity_from_step,
    update_goal,
)
from app.shared.schemas import GoalCreate, GoalOut, GoalUpdate, ProposalOut, StepLinkCreate

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


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def edit_goal(goal_id: str, payload: GoalUpdate) -> dict:
    with db_connection() as conn:
        return update_goal(conn, goal_id, payload.model_dump(exclude_unset=True))


@router.delete("/goals/{goal_id}", response_model=GoalOut)
def delete_goal(goal_id: str) -> dict:
    with db_connection() as conn:
        return abandon_goal(conn, goal_id)


@router.post("/steps/{step_id}/links")
def link_step_activity(step_id: str, payload: StepLinkCreate) -> dict:
    with db_connection() as conn:
        return link_activity_to_step(conn, step_id, payload.activity_id)


@router.delete("/steps/{step_id}/links/{activity_id}")
def unlink_step_activity(step_id: str, activity_id: str) -> dict:
    with db_connection() as conn:
        return unlink_activity_from_step(conn, step_id, activity_id)


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

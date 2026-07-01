from fastapi import APIRouter

from app.core.database import db_connection, rows_to_dicts
from app.modules.proposals.service import (
    accept_proposal,
    create_proposal,
    dismiss_proposal,
    generate_module_proposals,
)
from app.shared.schemas import ProposalCreate, ProposalOut

router = APIRouter(prefix="/proposals", tags=["proposals"])


@router.get("", response_model=list[ProposalOut])
def list_proposals(status: str = "pending") -> list[dict]:
    sql = "SELECT * FROM proposals"
    params: list[object] = []
    if status != "all":
        sql += " WHERE status = ?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with db_connection() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


@router.post("", status_code=201, response_model=ProposalOut)
def create(payload: ProposalCreate) -> dict:
    with db_connection() as conn:
        return create_proposal(
            conn, payload.type, payload.title, payload.rationale, payload.payload, payload.created_by
        )


@router.post("/{proposal_id}/accept", response_model=ProposalOut)
def accept(proposal_id: str) -> dict:
    with db_connection() as conn:
        return accept_proposal(conn, proposal_id)


@router.post("/{proposal_id}/dismiss", response_model=ProposalOut)
def dismiss(proposal_id: str) -> dict:
    with db_connection() as conn:
        return dismiss_proposal(conn, proposal_id)


@router.post("/generate", response_model=list[ProposalOut])
def generate() -> list[dict]:
    with db_connection() as conn:
        return generate_module_proposals(conn)

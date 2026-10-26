"""El Inicio (I1) en una sola llamada."""

from dataclasses import asdict
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app import home as logic
from app.routes.deps import CurrentSession, current_session
from app.routes.moves import MoveSummaryOut

router = APIRouter(tags=["inicio"])


class TopCategoryOut(BaseModel):
    id: int
    name: str
    icon: str | None
    color: int | None
    amount: Decimal
    share: int


class HomeOut(BaseModel):
    currency: str
    real_total: Decimal
    have_total: Decimal
    custody_total: Decimal
    owe_total: Decimal
    overdue_pending: int
    month: str
    income_total: Decimal
    expense_total: Decimal
    saved: Decimal
    saved_percent: int | None
    top: list[TopCategoryOut]
    recent: list[MoveSummaryOut]


@router.get("/home", summary="El Inicio: hoy y el mes elegido")
def home(month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
         session: CurrentSession = Depends(current_session)) -> HomeOut:
    return HomeOut.model_validate(asdict(logic.home(session.user_id, month)))

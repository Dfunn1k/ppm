"""El Inicio (I1) en una sola llamada."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import home as logic
from app.accounts import AccountError
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


class ForeignOut(BaseModel):
    currency: str
    amount: Decimal
    rate: Decimal
    rate_date: dt.date
    stale: bool


class HomeAccountOut(BaseModel):
    id: int
    name: str
    icon: str | None
    currency: str
    amount: Decimal
    base: Decimal


class HomeSetupAccountOut(BaseModel):
    id: int
    name: str
    icon: str | None
    subtitle: str | None
    amount: Decimal
    currency: str
    shown: bool


class HomeSetupOut(BaseModel):
    accounts: list[HomeSetupAccountOut]
    account_id: int | None


class HomeSetupIn(BaseModel):
    order: Annotated[list[int], Field(max_length=200)]    # todas las cuentas de dinero, en el orden del Inicio
    hidden: Annotated[list[int], Field(max_length=200)] = []   # las que no se ven en el Inicio
    account_id: int | None = None                          # la del + del Inicio; None = elegirla cada vez


class HomeOut(BaseModel):
    currency: str
    real_total: Decimal
    have_total: Decimal
    custody_total: Decimal
    owe_total: Decimal
    overdue_pending: int
    unclassified: int
    month: str
    income_total: Decimal
    expense_total: Decimal
    saved: Decimal
    saved_percent: int | None
    top: list[TopCategoryOut]
    recent: list[MoveSummaryOut]
    foreign: list[ForeignOut]
    accounts: list[HomeAccountOut]


@router.get("/home", summary="El Inicio: hoy y el mes elegido")
def home(month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
         session: CurrentSession = Depends(current_session)) -> HomeOut:
    return HomeOut.model_validate(asdict(logic.home(session.user_id, month)))


@router.get("/home/setup", summary="Más › Inicio: las cuentas del Inicio, su orden y la cuenta del +")
def setup(session: CurrentSession = Depends(current_session)) -> HomeSetupOut:
    return HomeSetupOut.model_validate(asdict(logic.setup(session.user_id)))


@router.put("/home/setup", summary="Guardar Más › Inicio")
def save_setup(body: HomeSetupIn, session: CurrentSession = Depends(current_session)) -> HomeSetupOut:
    try:
        return HomeSetupOut.model_validate(asdict(logic.save_setup(session.user_id, body.order, body.hidden, body.account_id)))
    except AccountError as e:
        raise HTTPException(e.status, str(e)) from None

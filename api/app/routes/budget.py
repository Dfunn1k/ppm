"""Presupuesto por sobres: el mes con Por asignar y cada sobre, asignar y mover, los sobres de ahorro y
qué cuentas entran. La lógica está en app/budget.py; aquí solo se traduce de y a JSON."""

import datetime as dt
from dataclasses import asdict
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app import budget
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["presupuesto"])

Month = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
Positive = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


# --- Salida -----------------------------------------------------------------------------------

class PostMonthOut(BaseModel):
    id: int
    kind: Literal["expense", "saving"]
    name: str
    icon: str | None
    color: int | None
    role: Literal["patrimony"] | None
    active: bool
    carried: Decimal                 # lo que traía del mes anterior (un rojo no pasa)
    assigned: Decimal                # lo asignado en el mes
    activity: Decimal                # lo que movieron los asientos: − gastado, + devuelto
    available: Decimal
    average: Decimal                 # lo gastado por mes en los 3 meses anteriores


class BudgetUnclassifiedOut(BaseModel):
    activity: Decimal
    available: Decimal


class PlataOut(BaseModel):
    accounts: Decimal                # efectivo, bancos y lo demás que tienes dentro
    cards: Decimal                   # lo que debes en tarjetas (negativo)
    installments: Decimal            # cuotas por venir de esas tarjetas
    owed: Decimal                    # lo que debes a otros o guardas de ellos (negativo)
    total: Decimal                   # P: la plata del presupuesto
    if_exchanged: Decimal | None     # «Si cambiaras hoy»: diferencia no realizada (solo el mes de hoy)


class AgeOut(BaseModel):
    days: int | None                 # la edad del dinero; None sin gastos todavía
    outflows: int                    # cuántos gastos promedia (hasta 10)


class BudgetMonthOut(BaseModel):
    started: bool
    start: dt.date | None
    month: dt.date
    locked: bool                     # mes cerrado: no se asigna
    to_assign: Decimal               # Por asignar
    future: Decimal                  # ya asignado a meses que vienen
    plata: PlataOut
    posts: list[PostMonthOut]
    unclassified: BudgetUnclassifiedOut
    age: AgeOut


class BudgetMoveOut(BaseModel):
    id: int
    month: dt.date
    from_post_id: int | None         # None = Por asignar
    to_post_id: int | None
    amount: Decimal
    source: Literal["manual", "cover", "fill", "start"]


class ScopeOut(BaseModel):
    account_id: int
    name: str
    on_budget: bool
    default: bool                    # así va su tipo si nadie dijo nada
    since: dt.date | None            # desde cuándo vale lo de hoy
    post_id: int | None              # fuera: el sobre de ahorro (None = Construir patrimonio)


# --- Entrada ----------------------------------------------------------------------------------

class StartIn(BaseModel):
    month: Month
    savings: list[Annotated[str, Field(max_length=60)]] = []   # sobres de ahorro que nacen con él


class MoveStartIn(BaseModel):
    month: Month


class AssignIn(BaseModel):
    month: Month
    from_post_id: int | None = None  # None = Por asignar
    to_post_id: int | None = None    # None = Por asignar
    amount: Positive
    source: Literal["manual", "cover"] = "manual"


class SavingIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    icon: str = Field("savings", pattern=r"^[a-z0-9_]+$", max_length=60)
    color: int = Field(3, ge=0, le=11)


class PostPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    icon: str | None = Field(None, pattern=r"^[a-z0-9_]+$", max_length=60)
    color: int | None = Field(None, ge=0, le=11)
    active: bool | None = None       # False = archivado


class ScopeIn(BaseModel):
    on_budget: bool
    since: dt.date | None = None     # desde qué día; None = hoy
    post_id: int | None = None       # fuera: de qué sobre de ahorro sale lo que se le pasa


def _out(m: budget.BudgetMonth) -> BudgetMonthOut:
    return BudgetMonthOut(**asdict(m))


# --- Rutas ------------------------------------------------------------------------------------

@router.get("/budget", summary="El presupuesto de un mes: Por asignar, la plata y cada sobre")
def get_budget(month: Annotated[Month | None, Query()] = None,
               session: CurrentSession = Depends(current_session)) -> BudgetMonthOut:
    try:
        return _out(budget.month_view(session.user_id, budget.parse_month(month) if month else None))
    except AccountError as e:
        raise _http(e) from None


@router.post("/budget/start", status_code=status.HTTP_201_CREATED, summary="Empezar el presupuesto desde un mes")
def start(body: StartIn, session: CurrentSession = Depends(current_session)) -> BudgetMonthOut:
    try:
        return _out(budget.start(session.user_id, budget.parse_month(body.month), body.savings))
    except AccountError as e:
        raise _http(e) from None


@router.put("/budget/start", summary="Cambiar el mes en que empezó")
def move_start(body: MoveStartIn, session: CurrentSession = Depends(current_session)) -> BudgetMonthOut:
    try:
        return _out(budget.move_start(session.user_id, budget.parse_month(body.month)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/budget/moves", summary="Lo asignado y movido en un mes")
def list_moves(month: Annotated[Month, Query()],
               session: CurrentSession = Depends(current_session)) -> list[BudgetMoveOut]:
    try:
        return [BudgetMoveOut(**asdict(m)) for m in budget.moves(session.user_id, budget.parse_month(month))]
    except AccountError as e:
        raise _http(e) from None


@router.post("/budget/moves", status_code=status.HTTP_201_CREATED, summary="Asignar, mover o devolver plata")
def assign(body: AssignIn, session: CurrentSession = Depends(current_session)) -> BudgetMonthOut:
    try:
        return _out(budget.assign(session.user_id, budget.parse_month(body.month), body.from_post_id,
                                  body.to_post_id, body.amount, body.source))
    except AccountError as e:
        raise _http(e) from None


@router.delete("/budget/moves/{move_id}", summary="Deshacer una asignación")
def undo(move_id: int, session: CurrentSession = Depends(current_session)) -> BudgetMonthOut:
    try:
        return _out(budget.undo(session.user_id, move_id))
    except AccountError as e:
        raise _http(e) from None


@router.post("/budget/posts", status_code=status.HTTP_201_CREATED, summary="Nuevo sobre de ahorro")
def create_post(body: SavingIn, session: CurrentSession = Depends(current_session)) -> dict[str, int]:
    try:
        return {"id": budget.create_saving(session.user_id, body.name, body.icon, body.color)}
    except AccountError as e:
        raise _http(e) from None


@router.patch("/budget/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT,
              summary="Renombrar, cambiar ícono o color, o archivar un sobre de ahorro")
def update_post(post_id: int, body: PostPatch, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        budget.update_post(session.user_id, post_id, body.name, body.icon, body.color, body.active)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/budget/accounts", summary="Qué cuentas de dinero están dentro del presupuesto")
def list_scopes(session: CurrentSession = Depends(current_session)) -> list[ScopeOut]:
    return [ScopeOut(**asdict(s)) for s in budget.scopes(session.user_id)]


@router.put("/budget/accounts/{account_id}", summary="Meter o sacar una cuenta del presupuesto desde un día")
def set_scope(account_id: int, body: ScopeIn, session: CurrentSession = Depends(current_session)) -> ScopeOut:
    try:
        return ScopeOut(**asdict(budget.set_scope(session.user_id, account_id, body.on_budget, body.since,
                                                  body.post_id)))
    except AccountError as e:
        raise _http(e) from None

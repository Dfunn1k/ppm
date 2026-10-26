"""Registrar (R1), Movimientos (M1) y el detalle de un movimiento (M2). Montos como texto exacto."""

import datetime as dt
from dataclasses import asdict
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app import moves
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["movimientos"])

Positive = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
Rate = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=6)]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


# --- Entrada ----------------------------------------------------------------------------------

class SplitIn(BaseModel):
    category_id: int
    amount: Positive


class MoveIn(BaseModel):
    kind: Literal["expense", "income", "transfer"]
    account_id: int                      # de dónde sale, o adónde entra en un ingreso
    amount: Positive                     # en la moneda de esa cuenta
    date: dt.date | None = None          # None = hoy
    ref: Annotated[str, Field(max_length=120)] | None = None   # la nota
    pending: bool = False                # por confirmar (con fecha futura lo es siempre)
    rate: Rate | None = None             # si la cuenta no es en moneda base
    splits: list[SplitIn] = []           # gasto o ingreso: una o varias categorías (dividir)
    to_account_id: int | None = None     # transferencia
    to_amount: Positive | None = None    # transferencia entre monedas: lo que entró

    def logic(self) -> moves.MoveInput:
        return moves.MoveInput(
            self.kind, self.account_id, self.amount, self.date, self.ref, self.pending, self.rate,
            [moves.Split(s.category_id, s.amount) for s in self.splits], self.to_account_id, self.to_amount)


class PendingIn(BaseModel):
    pending: bool


# --- Salida -----------------------------------------------------------------------------------

class CategoryOut(BaseModel):
    id: int
    name: str
    icon: str | None
    color: int | None


class MoveSummaryOut(BaseModel):
    id: int
    date: dt.date
    ref: str
    posted: bool
    kind: Literal["expense", "income", "transfer", "other"]
    currency: str
    amount: Decimal
    base: Decimal
    account: str
    categories: list[CategoryOut]
    to_currency: str | None
    to_amount: Decimal | None


class DayOut(BaseModel):
    date: dt.date
    total: Decimal
    moves: list[MoveSummaryOut]


class MonthOut(BaseModel):
    month: str
    currency: str
    income_total: Decimal
    expense_total: Decimal
    pending_count: int
    days: list[DayOut]


class SplitOut(BaseModel):
    category: CategoryOut
    amount: Decimal


class MoveDetailOut(BaseModel):
    summary: MoveSummaryOut
    account_id: int | None
    to_account_id: int | None
    rate: Decimal | None
    splits: list[SplitOut]


class CategoryGroupOut(BaseModel):
    id: int | None
    name: str
    color: int | None
    children: list[CategoryOut]


class CategoriesOut(BaseModel):
    groups: list[CategoryGroupOut]
    frequent: list[CategoryOut]


# --- Rutas ------------------------------------------------------------------------------------

def _detail(user_id: int, move_id: int) -> MoveDetailOut:
    try:
        return MoveDetailOut.model_validate(asdict(moves.detail(user_id, move_id)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/categories", summary="Categorías para elegir al registrar")
def categories(kind: Literal["expense", "income"],
               session: CurrentSession = Depends(current_session)) -> CategoriesOut:
    return CategoriesOut.model_validate(asdict(moves.categories(session.user_id, kind)))


@router.get("/moves", summary="Movimientos de un mes, con búsqueda y filtros")
def month(month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
          account_id: int | None = None, category_id: int | None = None,
          kind: Literal["expense", "income", "transfer"] | None = None,
          q: Annotated[str | None, Query(max_length=80)] = None, pending: bool = False,
          session: CurrentSession = Depends(current_session)) -> MonthOut:
    try:
        m = moves.month(session.user_id, month, account_id, category_id, kind, q, pending)
    except AccountError as e:
        raise _http(e) from None
    return MonthOut.model_validate(asdict(m))


@router.get("/moves/{move_id}", summary="Detalle de un movimiento")
def detail(move_id: int, session: CurrentSession = Depends(current_session)) -> MoveDetailOut:
    return _detail(session.user_id, move_id)


@router.post("/moves", status_code=status.HTTP_201_CREATED, summary="Registrar gasto, ingreso o transferencia")
def create(body: MoveIn, session: CurrentSession = Depends(current_session)) -> MoveDetailOut:
    try:
        move_id = moves.create(session.user_id, body.logic())
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, move_id)


@router.put("/moves/{move_id}", summary="Editar un movimiento")
def update(move_id: int, body: MoveIn, session: CurrentSession = Depends(current_session)) -> MoveDetailOut:
    try:
        moves.update(session.user_id, move_id, body.logic())
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, move_id)


@router.post("/moves/{move_id}/state", summary="Confirmar o pasar a por confirmar")
def set_state(move_id: int, body: PendingIn, session: CurrentSession = Depends(current_session)) -> MoveDetailOut:
    try:
        moves.set_pending(session.user_id, move_id, body.pending)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, move_id)


@router.delete("/moves/{move_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Borrar un movimiento")
def delete(move_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        moves.delete(session.user_id, move_id)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)

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

InputKind = Literal["expense", "income", "transfer", "lend", "borrow", "collect", "repay",
                    "custody_in", "custody_out", "refund", "manual"]
Kind = Literal["expense", "income", "transfer", "lend", "borrow", "collect", "repay", "custody_in",
               "custody_out", "refund", "offset", "write_off", "other"]
Amount = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]


class SplitIn(BaseModel):
    category_id: int | None = None       # una categoría…
    partner_id: int | None = None        # …o la parte de otra persona (gasto dividido)
    amount: Positive


class ManualLineIn(BaseModel):
    account_id: int
    debit: Amount = Decimal("0.00")      # «Entra a», en moneda base
    credit: Amount = Decimal("0.00")     # «Sale de»
    partner_id: int | None = None


class MoveIn(BaseModel):
    kind: InputKind
    account_id: int | None = None        # de dónde sale o adónde entra (no en un asiento manual ni si pagó otro)
    amount: Positive | None = None       # en la moneda de esa cuenta (no en un asiento manual)
    date: dt.date | None = None          # None = hoy
    ref: Annotated[str, Field(max_length=120)] | None = None   # la nota
    pending: bool = False                # por confirmar (con fecha futura lo es siempre)
    rate: Rate | None = None             # si la cuenta no es en moneda base; None = el del día
    splits: list[SplitIn] = []           # gasto o ingreso: una o varias categorías (dividir)
    to_account_id: int | None = None     # transferencia
    to_amount: Positive | None = None    # transferencia entre monedas: lo que entró
    partner_id: int | None = None        # con otra persona: con quién
    debt_line_id: int | None = None      # cobrar o pagar: qué deuda cancela primero («Elegir otra deuda»)
    paid_by_partner_id: int | None = None   # un gasto que pagó otra persona
    lines: list[ManualLineIn] = []       # asiento manual

    def logic(self) -> moves.MoveInput:
        return moves.MoveInput(
            self.kind, self.account_id, self.amount or Decimal("0.00"), self.date, self.ref, self.pending,
            self.rate, [moves.Split(s.category_id, s.amount, s.partner_id) for s in self.splits],
            self.to_account_id, self.to_amount, self.partner_id, self.debt_line_id, self.paid_by_partner_id,
            [moves.ManualLine(x.account_id, x.debit, x.credit, x.partner_id) for x in self.lines])


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
    kind: Kind
    currency: str
    amount: Decimal
    base: Decimal
    account: str
    categories: list[CategoryOut]
    to_currency: str | None
    to_amount: Decimal | None
    fx: Decimal | None               # cambio de moneda: + ganancia, − costo del cambio
    partner_id: int | None
    partner: str | None


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
    category: CategoryOut | None     # una categoría, o la parte de otra persona
    amount: Decimal
    partner_id: int | None
    partner: str | None


class LineOut(BaseModel):
    account_id: int
    account: str
    debit: Decimal                   # «Entra a»
    credit: Decimal                  # «Sale de»
    currency: str
    amount: Decimal
    partner_id: int | None
    partner: str | None


class SettledOut(BaseModel):
    line_id: int
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal


class MoveDetailOut(BaseModel):
    summary: MoveSummaryOut
    account_id: int | None
    to_account_id: int | None
    rate: Decimal | None
    splits: list[SplitOut]
    cost: Decimal | None = None
    cost_rate: Decimal | None = None
    partner_id: int | None = None
    paid_by_partner_id: int | None = None
    settled: list[SettledOut] = []   # las deudas que cancela (o los pagos que la cancelan)
    lines: list[LineOut] = []        # todos los apuntes, para el asiento manual


class ManualAccountOut(BaseModel):
    id: int
    name: str
    type: Literal["asset", "liability", "equity", "income", "expense"]
    role: str | None
    partner_required: bool
    icon: str | None
    color: int | None


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


@router.get("/manual-accounts", summary="Cuentas para un asiento manual")
def manual_accounts(session: CurrentSession = Depends(current_session)) -> list[ManualAccountOut]:
    return [ManualAccountOut.model_validate(asdict(a)) for a in moves.manual_accounts(session.user_id)]


@router.get("/moves", summary="Movimientos de un mes, con búsqueda y filtros")
def month(month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
          account_id: int | None = None, category_id: int | None = None,
          kind: Kind | None = None,
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


@router.post("/moves", status_code=status.HTTP_201_CREATED, summary="Registrar un movimiento")
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

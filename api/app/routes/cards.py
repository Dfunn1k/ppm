"""Tarjetas (C3, C5): el alta, el detalle con sus ciclos, la fecha de pago y las cuotas de antes de
PPM. Comprar con la tarjeta, en cuotas o no, y pagarla se registran en /moves."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app import card_statements, cards, recurring
from app.accounts import AccountError
from app.routes.accounts import AccountRowOut, Currency, Name, Rate
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["tarjetas"])

Brand = Literal["Visa", "Mastercard", "Amex", "Diners"]
Last4 = Annotated[str, Field(pattern=r"^[0-9]{4}$")]
ClosingDay = Annotated[int, Field(ge=1, le=31)]
Limit = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
NonNegative = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
Positive = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


# --- Salida -----------------------------------------------------------------------------------

class CardStatusOut(BaseModel):
    currency: str
    total_debt: Decimal
    unbilled: Decimal
    to_pay: Decimal


class PlanRowOut(BaseModel):
    id: int
    move_id: int
    name: str
    currency: str
    n_installments: int
    billed: int
    principal: Decimal
    remaining: Decimal
    next_installment: Decimal | None
    next_closing: dt.date | None
    opening: bool
    next_interest: Decimal


class CycleItemOut(BaseModel):
    move_id: int
    date: dt.date
    ref: str
    posted: bool
    kind: Literal["charge", "payment", "refund", "installment", "opening"]
    currency: str
    amount: Decimal                  # + sube la deuda, − la baja
    counterpart: str | None
    counterpart_icon: str | None
    counterpart_color: int | None
    sequence: int | None
    n_installments: int | None
    interest: Decimal | None
    bank: bool


class CycleAmountOut(BaseModel):
    currency: str
    amount: Decimal


class CycleOut(BaseModel):
    closing_date: dt.date
    state: Literal["current", "billed", "past"]
    date_due: dt.date | None
    charges: list[CycleAmountOut]
    items: list[CycleItemOut]


class CardRateOut(BaseModel):
    currency: str
    rate: Decimal
    rate_date: dt.date
    edited: bool


class BankChargeOut(BaseModel):
    id: int
    name: str
    amount: Decimal
    next_date: dt.date | None
    state: str
    drafts: int
    yearly: bool


class BankChargeIn(BaseModel):
    kind: Literal["insurance", "membership", "other"]   # desgravamen, membresía u otro cargo de cada corte
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)   # el último que te cobraron (o un estimado)
    date: dt.date | None = None          # membresía: cuándo te la cobran
    name: str | None = Field(default=None, max_length=120)


class CardDetailOut(BaseModel):
    account: AccountRowOut
    bank_id: int | None
    bank_name: str | None
    brand: Brand | None
    last4: str | None
    closing_day: int
    credit_limit: Decimal
    limit_currency: str
    last_closing: dt.date
    next_closing: dt.date
    date_due: dt.date | None
    status: list[CardStatusOut]
    used: Decimal
    available: Decimal
    plans: list[PlanRowOut]
    cycles: list[CycleOut]
    charges: list[BankChargeOut]
    rates: list[CardRateOut]
    line_matched: bool


# --- Entrada ----------------------------------------------------------------------------------

class CardOpeningIn(BaseModel):
    currency: Currency
    amount: NonNegative                  # lo que toca pagar en esa moneda
    rate: Rate | None = None             # si no es la base; None = el de venta del día


class CardIn(BaseModel):
    name: Name
    closing_day: ClosingDay
    credit_limit: Limit
    bank_id: int | None = None
    brand: Brand | None = None
    last4: Last4 | None = None
    to_pay: list[CardOpeningIn] = []     # el último estado de cuenta, por moneda
    date_due: dt.date | None = None      # hasta cuándo pagarlo


class CardPatch(BaseModel):
    name: Name | None = None
    closing_day: ClosingDay | None = None
    credit_limit: Limit | None = None
    bank_id: int | None = None
    brand: Brand | None = None
    last4: Last4 | None = None
    clear: list[Literal["bank_id", "brand", "last4"]] = []


class DueDateIn(BaseModel):
    closing_date: dt.date
    date_due: dt.date | None             # None la borra


class InstallmentsIn(BaseModel):
    currency: Currency
    each: Positive                       # cuánto es cada cuota
    n: Annotated[int, Field(ge=1, le=59)]   # cuántas faltan facturar
    ref: Annotated[str, Field(min_length=1, max_length=120)]   # qué compraste
    rate: Rate | None = None


# --- Rutas ------------------------------------------------------------------------------------

def _detail(user_id: int, card_id: int) -> CardDetailOut:
    try:
        return CardDetailOut.model_validate(asdict(cards.detail(user_id, card_id)))
    except AccountError as e:
        raise _http(e) from None


@router.post("/cards", status_code=status.HTTP_201_CREATED, summary="Nueva tarjeta de crédito")
def create(body: CardIn, session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        card = cards.create(session.user_id, body.name, body.closing_day, body.credit_limit, body.bank_id,
                            body.brand, body.last4,
                            [cards.OpeningAmount(o.currency, o.amount, o.rate) for o in body.to_pay], body.date_due)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card)


@router.get("/cards/{card_id}", summary="Detalle de una tarjeta: su ciclo, cuotas y movimientos")
def detail(card_id: int, session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    return _detail(session.user_id, card_id)


@router.patch("/cards/{card_id}", summary="Renombrar o editar corte, línea y datos")
def update(card_id: int, body: CardPatch, session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        cards.update(session.user_id, card_id, body.name, body.closing_day, body.credit_limit, body.bank_id,
                     body.brand, body.last4, set(body.clear))
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card_id)


@router.put("/cards/{card_id}/opening", summary="Corregir lo que tocaba pagar al empezar, en una moneda")
def set_opening(card_id: int, body: CardOpeningIn,
                session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        cards.set_opening(session.user_id, card_id, body.currency, body.amount, body.rate)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card_id)


@router.put("/cards/{card_id}/due-date", summary="La fecha de pago de un ciclo, del estado de cuenta")
def set_due_date(card_id: int, body: DueDateIn,
                 session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        cards.set_due_date(session.user_id, card_id, body.closing_date, body.date_due)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card_id)


@router.post("/cards/{card_id}/installments", status_code=status.HTTP_201_CREATED,
             summary="Cuotas de antes de PPM")
def add_installments(card_id: int, body: InstallmentsIn,
                     session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        cards.add_installments(session.user_id, card_id, body.currency, body.each, body.n, body.ref, body.rate)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card_id)


@router.post("/cards/{card_id}/charges", status_code=status.HTTP_201_CREATED,
             summary="Un cargo del banco que se repite: desgravamen, membresía")
def add_charge(card_id: int, body: BankChargeIn, session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        recurring.create_bank_charge(session.user_id, card_id, body.kind, body.amount, body.date, body.name)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card_id)


# --- Tipo de cambio y estado de cuenta ----------------------------------------------------------

class CardRateIn(BaseModel):
    rate: Rate | None = None             # None = volver al tipo de venta del día


@router.put("/cards/{card_id}/rates/{currency}", summary="El tipo de cambio del ciclo abierto, escrito a mano")
def set_rate(card_id: int, currency: Currency, body: CardRateIn,
             session: CurrentSession = Depends(current_session)) -> CardDetailOut:
    try:
        card_statements.set_rate(session.user_id, card_id, currency, body.rate)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, card_id)


class StatementLineOut(BaseModel):
    date: dt.date
    name: str
    amount: Decimal
    currency: str
    move_id: int | None


class UnmatchedOut(BaseModel):
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal
    currency: str


class StatementCurrencyOut(BaseModel):
    currency: str
    debt: Decimal
    rate: Decimal | None
    rate_date: dt.date | None
    subtotal: Decimal
    bank_subtotal: Decimal | None


class ReconciliationOut(BaseModel):
    closing_date: dt.date
    previous_closing: dt.date
    credit_limit: Decimal
    limit_currency: str
    currencies: list[StatementCurrencyOut]
    bank_charges: Decimal
    billed: Decimal
    bank_billed: Decimal | None
    installments: Decimal
    bank_installments: Decimal | None
    available: Decimal
    bank_available: Decimal | None
    used_at_closing: Decimal
    explanations: list[str]
    lines: list[StatementLineOut]
    unmatched: list[UnmatchedOut]


Amount = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]


class StatementLineIn(BaseModel):
    date: dt.date
    name: str = Field(max_length=200)
    amount: Amount
    currency: Currency


class SubtotalIn(BaseModel):
    currency: Currency
    amount: Amount | None


class StatementIn(BaseModel):
    subtotals: list[SubtotalIn] = []
    billed: Amount | None = None         # total facturado
    available: Amount | None = None      # línea disponible
    installments: Amount | None = None   # saldo de compras en cuotas
    lines: list[StatementLineIn] | None = None   # None = los pegados antes no cambian


def _reconciliation(user_id: int, card_id: int, closing: dt.date) -> ReconciliationOut:
    try:
        return ReconciliationOut.model_validate(asdict(card_statements.reconciliation(user_id, card_id, closing)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/cards/{card_id}/statements/{closing}", summary="Conciliar un estado de cuenta con PPM")
def reconciliation(card_id: int, closing: dt.date,
                   session: CurrentSession = Depends(current_session)) -> ReconciliationOut:
    return _reconciliation(session.user_id, card_id, closing)


@router.put("/cards/{card_id}/statements/{closing}", summary="Lo que dice el banco de un ciclo")
def save_statement(card_id: int, closing: dt.date, body: StatementIn,
                   session: CurrentSession = Depends(current_session)) -> ReconciliationOut:
    lines = None if body.lines is None else [card_statements.StatementLine(x.date, x.name, x.amount, x.currency)
                                             for x in body.lines]
    try:
        card_statements.save(session.user_id, card_id, closing, card_statements.StatementInput(
            {x.currency: x.amount for x in body.subtotals}, body.billed, body.available, body.installments, lines))
    except AccountError as e:
        raise _http(e) from None
    return _reconciliation(session.user_id, card_id, closing)

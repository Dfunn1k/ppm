"""Recurrentes (X1) y préstamos de banco (C4)."""

import datetime as dt
from dataclasses import asdict
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app import loans, recurring
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session
from app.routes.moves import CategoryOut, MoveIn

router = APIRouter(tags=["recurrentes"])

Amount = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
Positive = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
Mode = Literal["auto", "draft", "reminder"]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


# --- Entrada ----------------------------------------------------------------------------------

class RuleIn(BaseModel):
    interval: Literal["day", "week", "month", "year"]
    start: dt.date | None = None         # la primera fecha; None = hoy
    every: Annotated[int, Field(ge=1, le=99)] = 1
    month_days: list[Annotated[int, Field(ge=1, le=31)]] | None = None   # cada mes: días fijos (31 = el último)
    weekday: Annotated[int, Field(ge=1, le=7)] | None = None             # cada mes: el n-ésimo día de la semana
    nth: Literal[1, 2, 3, 4, -1] | None = None
    end_type: Literal["never", "date", "count"] = "never"
    date_end: dt.date | None = None
    max_count: Annotated[int, Field(ge=1, le=999)] | None = None

    def logic(self) -> recurring.Rule:
        return recurring.Rule(self.interval, self.start, self.every, self.month_days, self.weekday, self.nth,
                              self.end_type, self.date_end, self.max_count)


class RecurringIn(BaseModel):
    move: MoveIn                         # el movimiento de Registrar: gasto, ingreso o transferencia
    rule: RuleIn
    mode: Mode                           # automática, por confirmar o solo avisarme


class OccurrenceIn(BaseModel):
    skip: bool = False                   # esta vez no
    date: dt.date | None = None          # otra fecha esta vez
    total: Positive | None = None        # otro monto esta vez


class StateIn(BaseModel):
    action: Literal["pause", "resume", "end"]


class LoanIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    bank_id: int
    currency: Annotated[str, Field(min_length=3, max_length=3)]
    fresh: bool                          # recién me lo dieron (entra a la cuenta) o ya lo venía pagando
    amount: Positive                     # lo que te dieron, o lo que debes hoy (solo capital)
    pay_account_id: int                  # de donde se paga la cuota (y adonde entró, si es nuevo)
    day: Annotated[int, Field(ge=1, le=31)]   # se paga el … de cada mes
    left: Annotated[int, Field(ge=1, le=600)]  # cuotas que faltan
    capital: Positive
    interest: Amount
    insurance: Amount = Decimal("0.00")


class PayIn(BaseModel):
    date: dt.date | None = None          # None = hoy
    account_id: int                      # sale de
    capital: Amount
    interest: Amount
    insurance: Amount = Decimal("0.00")


# --- Salida -----------------------------------------------------------------------------------

class NextOut(BaseModel):
    date: dt.date
    occurrence: dt.date
    amount: Decimal
    skipped: bool
    moved: bool
    changed: bool


class RecurringRowOut(BaseModel):
    id: int
    name: str
    kind: Literal["expense", "income", "transfer"]
    mode: Mode
    state: Literal["active", "paused", "done"]
    currency: str
    amount: Decimal
    account_id: int
    account: str
    to_account: str | None
    category: CategoryOut | None
    next: NextOut | None
    loan_account_id: int | None


class RecurringListOut(BaseModel):
    currency: str
    incoming: Decimal
    outgoing: Decimal
    rows: list[RecurringRowOut]


class RuleOut(BaseModel):
    interval: Literal["day", "week", "month", "year"]
    start: dt.date
    every: int
    month_days: list[int] | None
    weekday: int | None
    nth: int | None
    end_type: Literal["never", "date", "count"]
    date_end: dt.date | None
    max_count: int | None


class DoneOut(BaseModel):
    move_id: int
    date: dt.date
    occurrence: dt.date
    posted: bool
    amount: Decimal
    from_bank: bool


class RecurringDetailOut(BaseModel):
    row: RecurringRowOut
    rule: RuleOut
    categories: list[CategoryOut]
    splits: list[Decimal]
    next: list[NextOut]
    done: list[DoneOut]
    pending_reminder: dt.date | None


class ReminderOut(BaseModel):
    recurring_id: int
    name: str
    occurrence: dt.date
    date: dt.date
    amount: Decimal
    currency: str
    late: bool


class PendingOut(BaseModel):
    reminders: list[ReminderOut]
    drafts_due: int
    bank_charges: int
    bank_charge_move_id: int | None


class PartOut(BaseModel):
    name: Literal["Capital", "Interés", "Seguro"]
    amount: Decimal


class InstallmentOut(BaseModel):
    move_id: int | None
    date: dt.date
    occurrence: dt.date
    posted: bool
    total: Decimal
    parts: list[PartOut]


class LoanOut(BaseModel):
    account_id: int
    name: str
    bank: str
    currency: str
    debt: Decimal
    start_debt: Decimal
    paid_count: int
    left_count: int
    recurring_id: int | None
    pay_account_id: int | None
    pay_account: str | None
    next: InstallmentOut | None
    paid: list[InstallmentOut]
    active: bool


class CreatedOut(BaseModel):
    id: int


# --- Recurrentes ------------------------------------------------------------------------------

@router.get("/recurring", summary="Las recurrentes y lo que viene en 30 días")
def overview(session: CurrentSession = Depends(current_session)) -> RecurringListOut:
    return RecurringListOut.model_validate(asdict(recurring.overview(session.user_id)))


@router.get("/recurring/pending", summary="Lo que el Inicio avisa: recordatorios y por confirmar")
def pending(session: CurrentSession = Depends(current_session)) -> PendingOut:
    return PendingOut.model_validate(asdict(recurring.pending(session.user_id)))


@router.post("/recurring", status_code=status.HTTP_201_CREATED, summary="Crear una recurrente («Se repite»)")
def create(body: RecurringIn, session: CurrentSession = Depends(current_session)) -> CreatedOut:
    try:
        return CreatedOut(id=recurring.create(session.user_id, body.move.logic(), body.rule.logic(), body.mode))
    except AccountError as e:
        raise _http(e) from None


@router.get("/recurring/{recurring_id}", summary="Una recurrente: su regla, lo que viene y lo registrado")
def detail(recurring_id: int, session: CurrentSession = Depends(current_session)) -> RecurringDetailOut:
    try:
        return RecurringDetailOut.model_validate(asdict(recurring.detail(session.user_id, recurring_id)))
    except AccountError as e:
        raise _http(e) from None


@router.put("/recurring/{recurring_id}", summary="Cambiarla desde la próxima fecha")
def update(recurring_id: int, body: RecurringIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        recurring.update(session.user_id, recurring_id, body.move.logic(), body.rule.logic(), body.mode)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/recurring/{recurring_id}/state", summary="Pausar, reanudar o terminar")
def set_state(recurring_id: int, body: StateIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        recurring.set_state(session.user_id, recurring_id, body.action)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/recurring/{recurring_id}/occurrences/{occurrence}", summary="Solo esta vez")
def set_occurrence(recurring_id: int, occurrence: dt.date, body: OccurrenceIn,
                   session: CurrentSession = Depends(current_session)) -> Response:
    try:
        recurring.set_occurrence(session.user_id, recurring_id, occurrence, body.skip, body.date, body.total)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/recurring/{recurring_id}/occurrences/{occurrence}", summary="Dejarlo como siempre")
def reset_occurrence(recurring_id: int, occurrence: dt.date,
                     session: CurrentSession = Depends(current_session)) -> Response:
    try:
        recurring.reset_occurrence(session.user_id, recurring_id, occurrence)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/recurring/{recurring_id}/occurrences/{occurrence}/done", summary="Recordatorio: «Ya lo hice»")
def reminder_done(recurring_id: int, occurrence: dt.date,
                  session: CurrentSession = Depends(current_session)) -> Response:
    try:
        recurring.reminder_done(session.user_id, recurring_id, occurrence)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Préstamos --------------------------------------------------------------------------------

@router.post("/loans", status_code=status.HTTP_201_CREATED, summary="Crear un préstamo de banco")
def create_loan(body: LoanIn, session: CurrentSession = Depends(current_session)) -> CreatedOut:
    try:
        return CreatedOut(id=loans.create(session.user_id, body.name, body.bank_id, body.currency, body.fresh,
                                          body.amount, body.pay_account_id, body.day, body.left, body.capital,
                                          body.interest, body.insurance))
    except AccountError as e:
        raise _http(e) from None


@router.get("/loans/{account_id}", summary="Un préstamo: lo que debes, la próxima cuota y las pagadas")
def loan(account_id: int, session: CurrentSession = Depends(current_session)) -> LoanOut:
    try:
        return LoanOut.model_validate(asdict(loans.detail(session.user_id, account_id)))
    except AccountError as e:
        raise _http(e) from None


@router.post("/loans/{account_id}/pay", status_code=status.HTTP_201_CREATED, summary="Pagar la cuota")
def pay(account_id: int, body: PayIn, session: CurrentSession = Depends(current_session)) -> CreatedOut:
    try:
        return CreatedOut(id=loans.pay(session.user_id, account_id, body.date, body.account_id, body.capital,
                                       body.interest, body.insurance))
    except AccountError as e:
        raise _http(e) from None

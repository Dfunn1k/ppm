"""Registrar (R1), Movimientos (M1) y el detalle de un movimiento (M2). Montos como texto exacto."""

import datetime as dt
from dataclasses import asdict
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app import moves, statements
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
               "custody_out", "refund", "offset", "write_off", "opening", "unclassified", "other"]
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


class DeferralIn(BaseModel):
    method: Literal["days", "months"]    # por días (según los días de cada mes) o por meses (partes iguales)
    start: dt.date | None = None         # desde cuándo cuenta; None = la fecha del movimiento
    end: dt.date | None = None           # por días: el último día que cubre
    months: Annotated[int, Field(ge=2, le=60)] | None = None   # por meses: en cuántos


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
    currency: Annotated[str, Field(min_length=3, max_length=3)] | None = None   # con tarjeta: en qué moneda
    installments: Annotated[int, Field(ge=2, le=60)] | None = None             # gasto o préstamo con tarjeta en cuotas
    installment_amount: Positive | None = None   # cada cuota, del cronograma del banco; sin ella, sin intereses
    later: bool = False                  # gasto o ingreso: «Lo clasifico después» (va a Por clasificar)
    debt_currency: Annotated[str, Field(min_length=3, max_length=3)] | None = None   # cobrar o pagar en otra moneda: la de la deuda…
    debt_amount: Positive | None = None  # …y cuánto de ella cancela
    deferral: DeferralIn | None = None   # gasto o ingreso: repartirlo en el tiempo
    tag_ids: list[int] | None = None     # etiquetas; al editar, sin ellas se quedan las que tenía

    def logic(self) -> moves.MoveInput:
        return moves.MoveInput(
            self.kind, self.account_id, self.amount or Decimal("0.00"), self.date, self.ref, self.pending,
            self.rate, [moves.Split(s.category_id, s.amount, s.partner_id) for s in self.splits],
            self.to_account_id, self.to_amount, self.partner_id, self.debt_line_id, self.paid_by_partner_id,
            [moves.ManualLine(x.account_id, x.debit, x.credit, x.partner_id) for x in self.lines],
            self.currency, self.installments, self.installment_amount, self.later,
            self.debt_currency, self.debt_amount,
            moves.DeferralInput(self.deferral.method, self.deferral.start, self.deferral.end, self.deferral.months)
            if self.deferral else None, self.tag_ids)


class PendingIn(BaseModel):
    pending: bool


class CategoryIn(BaseModel):
    kind: Literal["expense", "income"]
    name: str = Field(min_length=1, max_length=60)
    parent_id: int | None = None     # gasto: dentro de un grupo que ya existe…
    group: str | None = Field(None, max_length=60)  # …o de uno nuevo, que nace con ella
    icon: str | None = Field(None, pattern=r"^[a-z0-9_]+$", max_length=60)  # Material Symbols
    color: int | None = Field(None, ge=0, le=11)    # paleta fija; None = el del grupo


class MaturityIn(BaseModel):
    date: dt.date | None             # None = sin fecha (en una parte de cuotas: la de la tarjeta)


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
    incoming: bool | None            # por clasificar: entró (True) o salió (False) de la cuenta


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
    line_id: int | None = None
    date_maturity: dt.date | None = None     # vence: el de a mano o la fecha de pago del ciclo de su corte
    maturity_manual: dt.date | None = None   # el puesto a mano
    maturity_closing: dt.date | None = None  # parte de una compra en cuotas: el corte de su cuota


class SettledOut(BaseModel):
    line_id: int
    move_id: int
    date: dt.date
    ref: str
    amount: Decimal


class PlanLineOut(BaseModel):
    sequence: int
    closing_date: dt.date
    principal: Decimal
    billed: bool
    interest: Decimal | None             # del estado de cuenta; None = sin dato
    canceled: bool = False               # salió del calendario al cancelar las cuotas que faltaban


class PlanCancelOut(BaseModel):
    kind: Literal["returned", "prepaid"]   # lo devolví | pagué lo que faltaba
    date: dt.date
    move_id: int                         # su asiento: borrarlo la deshace
    amount: Decimal                      # lo que faltaba facturar
    charged: Decimal | None              # pagada por adelantado: lo que cobró el banco
    payment_move_id: int | None = None   # el pago de la tarjeta registrado con ella: deshacer lo borra


class CancelOfOut(BaseModel):
    move_id: int
    ref: str


class PlanOut(BaseModel):
    card_id: int
    currency: str
    n_installments: int
    principal: Decimal
    remaining: Decimal
    lines: list[PlanLineOut]
    installment_amount: Decimal | None
    plan_id: int | None
    price: Decimal | None
    category: str | None
    canceled: PlanCancelOut | None = None


class DeferralPartOut(BaseModel):
    sequence: int
    date: dt.date                    # cuándo cuenta
    days: int | None                 # por días: cuántos cubre
    amount: Decimal                  # en moneda base
    move_id: int | None              # su asiento, si ya contó
    posted: bool
    canceled: bool                   # no llegó a contar: se canceló lo que faltaba


class DeferralCancelOut(BaseModel):
    move_id: int                     # su asiento: borrarlo la deshace
    date: dt.date
    refund: Decimal                  # lo que volvió (o devolviste), en moneda base
    account: str | None
    rest: Decimal                    # lo que contó ese día como gasto (o ingreso)


class DeferralOut(BaseModel):
    kind: Literal["expense", "income"]
    method: Literal["days", "months"]
    start: dt.date
    end: dt.date | None
    months: int | None
    amount: Decimal
    category: CategoryOut
    parts: list[DeferralPartOut]
    remaining: Decimal               # lo que todavía espera
    canceled: DeferralCancelOut | None = None


class DeferralOfOut(BaseModel):
    move_id: int                     # el movimiento original
    ref: str
    sequence: int | None             # la parte; None = la cancelación
    parts: int


class BankLineOut(BaseModel):
    statement_id: int
    statement: str
    account_id: int
    payment_ref: str                 # lo que dice el banco: no cambia
    operation_number: str | None


class TagRefOut(BaseModel):
    id: int
    name: str
    color: int


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
    plan: PlanOut | None = None      # una compra en cuotas: su calendario
    bank: list[BankLineOut] = []     # si vino de un extracto: lo que dijo el banco
    cancels: CancelOfOut | None = None   # cancela las cuotas que faltaban de esta compra
    locked: bool = False                 # en un periodo cerrado: no se cambia ni se borra
    deferral: DeferralOut | None = None      # repartido en el tiempo: su calendario
    deferral_of: DeferralOfOut | None = None   # una parte de un reparto o su cancelación
    tags: list[TagRefOut] = []
    tags_inherited: bool = False           # las lleva de la compra que lo originó: se cambian ahí
    with_partner_id: int | None = None     # gasto o ingreso: con quién fue (se elige al clasificar)
    with_partner: str | None = None


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
    icon: str | None
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


@router.post("/categories", status_code=status.HTTP_201_CREATED, summary="Crear una categoría")
def create_category(body: CategoryIn, session: CurrentSession = Depends(current_session)) -> CategoryOut:
    try:
        c = moves.create_category(session.user_id, body.kind, body.name, body.parent_id, body.group,
                                  body.icon, body.color)
    except AccountError as e:
        raise _http(e) from None
    return CategoryOut.model_validate(asdict(c))


@router.get("/manual-accounts", summary="Cuentas para un asiento manual")
def manual_accounts(session: CurrentSession = Depends(current_session)) -> list[ManualAccountOut]:
    return [ManualAccountOut.model_validate(asdict(a)) for a in moves.manual_accounts(session.user_id)]


@router.get("/moves", summary="Movimientos de un mes, con búsqueda y filtros")
def month(month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
          account_id: int | None = None, category_id: int | None = None,
          kind: Kind | None = None,
          q: Annotated[str | None, Query(max_length=80)] = None, pending: bool = False,
          tag_id: int | None = None,
          session: CurrentSession = Depends(current_session)) -> MonthOut:
    try:
        m = moves.month(session.user_id, month, account_id, category_id, kind, q, pending, tag_id)
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


@router.put("/move-lines/{line_id}/maturity", status_code=status.HTTP_204_NO_CONTENT,
            summary="Poner o quitar la fecha de vencimiento de una deuda")
def set_maturity(line_id: int, body: MaturityIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        moves.set_maturity(session.user_id, line_id, body.date)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)





class CancelPlanIn(BaseModel):
    kind: Literal["returned", "prepaid"]   # lo devolví | pagué lo que faltaba
    date: dt.date | None = None            # None = hoy
    charged: Positive | None = None        # pagada por adelantado: lo que cobró el banco
    account_id: int | None = None          # y de qué cuenta se pagó; None = todavía no se paga


@router.post("/plans/{plan_id}/cancel", summary="Cancelar las cuotas que faltan: lo devolví o pagué lo que faltaba")
def cancel_plan(plan_id: int, body: CancelPlanIn, session: CurrentSession = Depends(current_session)) -> MoveDetailOut:
    try:
        purchase = moves.cancel_plan(session.user_id, plan_id, body.kind, body.date, body.charged, body.account_id)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, purchase)


class CancelDeferralIn(BaseModel):
    date: dt.date | None = None          # None = hoy
    refund: Amount = Decimal("0.00")     # lo que te devolvieron (o devolviste), en la moneda de la cuenta
    account_id: int | None = None        # a qué cuenta entró (o de cuál salió); solo si hay algo
    rate: Rate | None = None             # si esa cuenta no es en moneda base; None = el del día


@router.post("/moves/{move_id}/deferral/cancel", summary="Cancelar lo que falta de un movimiento repartido en el tiempo")
def cancel_deferral(move_id: int, body: CancelDeferralIn,
                    session: CurrentSession = Depends(current_session)) -> MoveDetailOut:
    try:
        moves.cancel_deferral(session.user_id, move_id, body.date, body.refund, body.account_id, body.rate)
    except AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, move_id)


@router.delete("/moves/{move_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Borrar un movimiento")
def delete(move_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        moves.delete(session.user_id, move_id)
    except AccountError as e:
        raise _http(e) from None
    statements.collect(session.user_id)   # sus adjuntos ya no tienen ficha: sus archivos se van si nadie más los usa
    return Response(status_code=status.HTTP_204_NO_CONTENT)

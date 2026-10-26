"""Cuentas (C1, C2, C5) y personas, lo mínimo para «Plata que guardo de otros».

Los montos viajan como texto decimal exacto ("1284.90"): ni la API ni la web pierden un céntimo."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, BeforeValidator, Field

from app import accounts
from app import partners as partners_logic
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["cuentas"])


def _http(e: accounts.AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


def _digits(v: object) -> object:
    """El CCI y el número se pegan con espacios o guiones; el CCI se guarda solo con dígitos."""
    return "".join(ch for ch in v if ch.isdigit()) if isinstance(v, str) else v


Amount = Annotated[Decimal, Field(max_digits=14, decimal_places=2, ge=Decimal("-999999999999.99"))]
Rate = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=6)]
Name = Annotated[str, Field(min_length=1, max_length=80)]
Currency = Annotated[str, Field(min_length=3, max_length=3)]
Cci = Annotated[str, BeforeValidator(_digits), Field(pattern=r"^[0-9]{20}$")]
AccNumber = Annotated[str, Field(min_length=6, max_length=30, pattern=r"^[0-9 -]+$")]


# --- Salida -----------------------------------------------------------------------------------

class MoneyOut(BaseModel):
    currency: str
    amount: Decimal
    base: Decimal        # su valor hoy en moneda base
    book: Decimal        # su valor en libros


class TodayRateOut(BaseModel):
    currency: str
    date: dt.date
    buy: Decimal
    sell: Decimal
    stale: bool


class AccountRowOut(BaseModel):
    id: int
    name: str
    kind: Literal["cash", "bank", "receivable", "payable", "suspense", "other"]
    currency: str | None
    icon: str | None
    subtitle: str | None
    balances: list[MoneyOut]
    base_total: Decimal
    partners: int | None = None      # Por cobrar y Por pagar: cuántas personas


class CustodyRowOut(BaseModel):
    partner_id: int
    partner_name: str
    balances: list[MoneyOut]
    base_total: Decimal


class OverviewOut(BaseModel):
    currency: str
    real_total: Decimal
    have_total: Decimal
    custody_total: Decimal
    owe_total: Decimal
    have: list[AccountRowOut]
    custody: list[CustodyRowOut]
    owe: list[AccountRowOut]
    rates: list[TodayRateOut]


class BankOut(BaseModel):
    bank_id: int
    bank_name: str
    acc_kind: Literal["savings", "checking"]
    acc_number: str | None
    cci: str | None


class OpeningOut(BaseModel):
    date: dt.date
    amount: Decimal
    rate: Decimal | None


class LineOut(BaseModel):
    id: int
    move_id: int
    date: dt.date
    ref: str
    posted: bool
    currency: str
    amount: Decimal
    running: Decimal | None
    counterpart: str | None
    counterpart_icon: str | None
    counterpart_color: int | None
    counterpart_role: str | None


class AccountDetailOut(BaseModel):
    account: AccountRowOut
    system_role: str | None
    bank: BankOut | None
    opening: OpeningOut | None
    lines: list[LineOut]


class PartnerOut(BaseModel):
    id: int
    name: str


# --- Entrada ----------------------------------------------------------------------------------

class OpeningIn(BaseModel):
    amount: Amount = Decimal("0.00")        # en la moneda de la cuenta
    date: dt.date | None = None                # None = hoy, en tu zona horaria
    rate: Rate | None = None                # obligatorio si la moneda no es la base


class CashIn(BaseModel):
    name: Name
    currency: Currency
    opening: OpeningIn = OpeningIn()


class BankIn(CashIn):
    bank_id: int
    acc_kind: Literal["savings", "checking"] = "savings"
    acc_number: AccNumber | None = None
    cci: Cci | None = None


class AccountPatch(BaseModel):
    name: Name | None = None
    bank_id: int | None = None
    acc_kind: Literal["savings", "checking"] | None = None
    acc_number: AccNumber | None = None
    cci: Cci | None = None
    clear: list[Literal["acc_number", "cci"]] = []   # borrar esos datos opcionales


class CustodyIn(BaseModel):
    partner_id: int
    currency: Currency
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
    date: dt.date | None = None
    rate: Rate | None = None


class PartnerIn(BaseModel):
    name: Name
    phone: Annotated[str, Field(max_length=30)] | None = None
    email: Annotated[str, Field(max_length=120)] | None = None


# --- Rutas ------------------------------------------------------------------------------------

@router.get("/accounts", summary="Mis cuentas con sus totales")
def overview(session: CurrentSession = Depends(current_session)) -> OverviewOut:
    return OverviewOut.model_validate(asdict(accounts.overview(session.user_id)))


def _detail(user_id: int, account_id: int) -> AccountDetailOut:
    try:
        return AccountDetailOut.model_validate(asdict(accounts.detail(user_id, account_id)))
    except accounts.AccountError as e:
        raise _http(e) from None


@router.get("/accounts/{account_id}", summary="Detalle de una cuenta con sus movimientos")
def detail(account_id: int, session: CurrentSession = Depends(current_session)) -> AccountDetailOut:
    return _detail(session.user_id, account_id)


@router.post("/accounts/cash", status_code=status.HTTP_201_CREATED, summary="Nueva cuenta de efectivo")
def create_cash(body: CashIn, session: CurrentSession = Depends(current_session)) -> AccountDetailOut:
    try:
        acc = accounts.create_cash(session.user_id, body.name, body.currency, body.opening.amount,
                                   body.opening.date, body.opening.rate)
    except accounts.AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, acc)


@router.post("/accounts/bank", status_code=status.HTTP_201_CREATED, summary="Nueva cuenta de banco")
def create_bank(body: BankIn, session: CurrentSession = Depends(current_session)) -> AccountDetailOut:
    try:
        acc = accounts.create_bank(session.user_id, body.name, body.currency, body.bank_id, body.acc_kind,
                                   body.acc_number, body.cci, body.opening.amount, body.opening.date,
                                   body.opening.rate)
    except accounts.AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, acc)


@router.put("/accounts/{account_id}/opening", summary="Poner o corregir el saldo inicial")
def set_opening(account_id: int, body: OpeningIn,
                session: CurrentSession = Depends(current_session)) -> AccountDetailOut:
    try:
        accounts.set_opening(session.user_id, account_id, body.amount, body.date, body.rate)
    except accounts.AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, account_id)


@router.patch("/accounts/{account_id}", summary="Renombrar o editar los datos del banco")
def update(account_id: int, body: AccountPatch,
           session: CurrentSession = Depends(current_session)) -> AccountDetailOut:
    try:
        accounts.update(session.user_id, account_id, body.name, body.bank_id, body.acc_kind, body.acc_number,
                        body.cci, set(body.clear))
    except accounts.AccountError as e:
        raise _http(e) from None
    return _detail(session.user_id, account_id)


@router.post("/accounts/{account_id}/archive", status_code=status.HTTP_204_NO_CONTENT,
             summary="Archivar una cuenta (solo con saldo cero)")
def archive(account_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        accounts.archive(session.user_id, account_id)
    except accounts.AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/custody", status_code=status.HTTP_204_NO_CONTENT,
             summary="Plata que guardo de otros: lo que alguien te dio para guardar")
def add_custody(body: CustodyIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        accounts.add_custody(session.user_id, body.partner_id, body.currency, body.amount, body.date, body.rate)
    except accounts.AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/partners", summary="Personas")
def partners(session: CurrentSession = Depends(current_session)) -> list[PartnerOut]:
    return [PartnerOut.model_validate(asdict(p)) for p in accounts.partners(session.user_id)]


@router.post("/partners", status_code=status.HTTP_201_CREATED, summary="Nueva persona")
def create_partner(body: PartnerIn, session: CurrentSession = Depends(current_session)) -> PartnerOut:
    try:
        pid = partners_logic.create(session.user_id, body.name, body.phone, body.email)
        return PartnerOut(id=pid, name=" ".join(body.name.split()))
    except accounts.AccountError as e:
        raise _http(e) from None

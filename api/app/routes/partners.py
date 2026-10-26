"""Personas (C6): quién me debe, a quién debo y de quién guardo plata; el detalle de cada una con sus
deudas abiertas, editarla, compensar y dar por perdido. La lista simple para elegir y el alta están
en las rutas de cuentas (/partners)."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from app import partners
from app.accounts import AccountError
from app.routes.accounts import MoneyOut
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["personas"])


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


class PartnerRowOut(BaseModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    owes_me: list[MoneyOut]          # lo que te debe, en positivo
    i_owe: list[MoneyOut]            # lo que le debes, en positivo
    keep: list[MoneyOut]             # lo que guardas suyo, en positivo
    net: Decimal                     # te debe − le debes, en moneda base
    last_date: dt.date | None


class PartnersOverviewOut(BaseModel):
    currency: str
    owes_me_total: Decimal
    i_owe_total: Decimal
    keep_total: Decimal
    people: list[PartnerRowOut]


class OpenItemOut(BaseModel):
    line_id: int
    move_id: int
    date: dt.date
    ref: str
    currency: str
    amount: Decimal                  # lo que era
    open: Decimal                    # lo que falta
    days: int


class PartnerDetailOut(BaseModel):
    partner: PartnerRowOut
    owes_me: list[OpenItemOut]
    i_owe: list[OpenItemOut]
    keep_since: dt.date | None


class PartnerPatch(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    phone: Annotated[str, Field(max_length=30)] | None = None
    email: Annotated[str, Field(max_length=120)] | None = None


class PartnerOpeningIn(BaseModel):
    side: Literal["owes_me", "i_owe"]    # ya me debía / ya le debía
    currency: Annotated[str, Field(min_length=3, max_length=3)]
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
    date: dt.date | None = None          # desde cuándo; None = hoy
    rate: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=6)] | None = None
    ref: Annotated[str, Field(max_length=120)] | None = None   # la nota: «Lo del celular»


class MovedOut(BaseModel):
    move_id: int


@router.get("/partners/overview", summary="Personas con lo que te deben, les debes y guardas")
def overview(session: CurrentSession = Depends(current_session)) -> PartnersOverviewOut:
    return PartnersOverviewOut.model_validate(asdict(partners.overview(session.user_id)))


@router.get("/partners/{partner_id}", summary="Una persona y sus deudas abiertas")
def detail(partner_id: int, session: CurrentSession = Depends(current_session)) -> PartnerDetailOut:
    try:
        return PartnerDetailOut.model_validate(asdict(partners.detail(session.user_id, partner_id)))
    except AccountError as e:
        raise _http(e) from None


@router.patch("/partners/{partner_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Editar una persona")
def update(partner_id: int, body: PartnerPatch, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        partners.update(session.user_id, partner_id, body.name, body.phone, body.email)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/partners/{partner_id}/offset", status_code=status.HTTP_201_CREATED,
             summary="Compensar lo que se deben")
def offset(partner_id: int, session: CurrentSession = Depends(current_session)) -> MovedOut:
    try:
        return MovedOut(move_id=partners.offset(session.user_id, partner_id))
    except AccountError as e:
        raise _http(e) from None


@router.post("/partners/{partner_id}/write-off", status_code=status.HTTP_201_CREATED,
             summary="Dar por perdido lo que te debe")
def write_off(partner_id: int, session: CurrentSession = Depends(current_session)) -> MovedOut:
    try:
        return MovedOut(move_id=partners.write_off(session.user_id, partner_id))
    except AccountError as e:
        raise _http(e) from None


@router.post("/partners/{partner_id}/opening", status_code=status.HTTP_201_CREATED,
             summary="Saldo inicial: lo que ya te debía o ya le debías")
def add_opening(partner_id: int, body: PartnerOpeningIn, session: CurrentSession = Depends(current_session)) -> MovedOut:
    try:
        return MovedOut(move_id=partners.add_opening(session.user_id, partner_id, body.side, body.currency,
                                                     body.amount, body.date, body.rate, body.ref))
    except AccountError as e:
        raise _http(e) from None

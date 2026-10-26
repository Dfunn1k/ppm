"""Tipo de cambio: el del día para los formularios y Z1 (solo el administrador)."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import rates
from app.routes.deps import CurrentSession, current_admin, current_session

router = APIRouter(tags=["tipo de cambio"])

RateValue = Annotated[Decimal, Field(gt=0, max_digits=10, decimal_places=4)]


def _http(e: rates.RateError) -> HTTPException:
    return HTTPException(e.status, str(e))


class UserRateOut(BaseModel):
    currency: str
    date: dt.date
    buy: Decimal
    sell: Decimal
    stale: bool


class RateDayOut(BaseModel):
    currency: str
    date: dt.date
    buy: Decimal
    sell: Decimal
    source: Literal["SUNAT", "manual"]


class CurrencyStatusOut(BaseModel):
    currency: str
    users: int
    last: RateDayOut | None
    loaded_at: dt.datetime | None
    days: int | None
    stale: bool


class AdminRatesOut(BaseModel):
    currencies: list[CurrencyStatusOut]
    history: list[RateDayOut]


class RateIn(BaseModel):
    currency: Annotated[str, Field(min_length=3, max_length=3)]
    date: dt.date
    buy: RateValue
    sell: RateValue


@router.get("/rates", summary="El tipo de cambio de tus monedas para un día (el de ese día o el último anterior)")
def user_rates(date: dt.date | None = None, session: CurrentSession = Depends(current_session)) -> list[UserRateOut]:
    return [UserRateOut.model_validate(asdict(r)) for r in rates.user_rates(session.user_id, date)]


@router.get("/admin/rates", summary="Z1: cómo está el tipo de cambio de cada moneda")
def admin_rates(_: CurrentSession = Depends(current_admin)) -> AdminRatesOut:
    return AdminRatesOut.model_validate(asdict(rates.admin_overview()))


@router.post("/admin/rates", summary="Z1: cargar o corregir a mano el tipo de un día")
def set_rate(body: RateIn, _: CurrentSession = Depends(current_admin)) -> RateDayOut:
    try:
        return RateDayOut.model_validate(asdict(rates.set_manual(body.currency, body.date, body.buy, body.sell)))
    except rates.RateError as e:
        raise _http(e) from None


@router.post("/admin/rates/sunat", summary="Z1: traer de SUNAT ahora")
def import_now(_: CurrentSession = Depends(current_admin)) -> RateDayOut:
    try:
        return RateDayOut.model_validate(asdict(rates.import_sunat()))
    except rates.RateError as e:
        raise _http(e) from None

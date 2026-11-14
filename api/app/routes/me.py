"""La persona conectada (A2 configuración inicial) y los catálogos que necesitan sus pantallas."""

import datetime as dt
from dataclasses import asdict
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app import recurring, users
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["persona"])


class CurrencyFormatOut(BaseModel):
    code: str
    symbol: str
    decimals: int


class MeOut(BaseModel):
    id: int
    name: str
    email: str
    configured: bool
    country: str | None
    currency: str | None
    lang: str | None
    tz: str
    ui_theme: str
    ui_accent: str
    currencies: list[str]
    is_admin: bool
    notice_days: int
    ui_private: bool
    home_account_id: int | None
    lock_date: dt.date | None = None     # cierre de periodo
    icons: list[str] = []                # los íconos de sus categorías y cuentas
    formats: list[CurrencyFormatOut] = []   # cómo se escribe cada moneda que usa, en su formato

    @classmethod
    def of(cls, me: users.Me) -> "MeOut":
        return cls(**asdict(me))


class SetupIn(BaseModel):
    country: Annotated[str, Field(min_length=2, max_length=2)]                 # 'PE'
    other_currencies: list[Annotated[str, Field(min_length=3, max_length=3)]] = []  # ['USD']
    lang: str | None = None                                                    # None = la del país
    tz: str | None = None                                                      # 'America/Lima'


class MePatch(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    ui_theme: Literal["system", "light", "dark"] | None = None
    ui_accent: Literal["tinta", "trigo", "morado", "azul"] | None = None
    notice_days: Annotated[int, Field(ge=0, le=60)] | None = None   # Pendientes: avisarme N días antes
    ui_private: bool | None = None       # modo privado: los montos del Inicio escondidos
    lang: str | None = None              # formato de números y fechas: 'es-PE' o 'es-ES'


class OptionOut(BaseModel):
    code: str
    name: str


class BankOut(BaseModel):
    id: int
    name: str
    cci_code: str | None


class CurrencyOptionOut(BaseModel):
    code: str
    name: str
    decimals: int


class CatalogOut(BaseModel):
    countries: list[OptionOut]
    currencies: list[CurrencyOptionOut]
    langs: list[OptionOut]
    banks: list[BankOut]


@router.get("/me", summary="Quién está conectado")
def me(session: CurrentSession = Depends(current_session)) -> MeOut:
    found = users.get_me(session.user_id)
    if found.configured:
        recurring.run(session.user_id)   # al abrir la app se registran las recurrentes que ya tocan
    return MeOut.of(found)


@router.patch("/me", summary="Cambiar tu nombre, el tema, el acento o con cuánto aviso")
def update(body: MePatch, session: CurrentSession = Depends(current_session)) -> MeOut:
    if body.lang is not None:
        try:
            users.set_lang(session.user_id, body.lang)
        except users.CurrencyError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    return MeOut.of(users.update(session.user_id, body.name, body.ui_theme, body.ui_accent, body.notice_days,
                                  body.ui_private))


@router.post("/me/setup", summary="Configuración inicial (los 3 pasos)")
def setup(body: SetupIn, session: CurrentSession = Depends(current_session)) -> MeOut:
    try:
        me = users.setup(session.user_id, body.country, body.other_currencies, body.lang, body.tz)
    except users.SetupError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    return MeOut.of(me)


@router.get("/catalog", summary="Países, monedas, idiomas y bancos")
def catalog(session: CurrentSession = Depends(current_session)) -> CatalogOut:
    return CatalogOut.model_validate(asdict(users.get_catalog(session.user_id)))


class MyCurrencyOut(BaseModel):
    code: str
    name: str
    symbol: str
    decimals: int
    base: bool
    accounts: list[str]
    rate: Literal["SUNAT", "manual"] | None


class CurrencyIn(BaseModel):
    currency: Annotated[str, Field(min_length=3, max_length=3)]


@router.get("/me/currencies", summary="Más › Monedas y formato: tus monedas, sus cuentas y su tipo de cambio")
def my_currencies(session: CurrentSession = Depends(current_session)) -> list[MyCurrencyOut]:
    return [MyCurrencyOut.model_validate(asdict(c)) for c in users.my_currencies(session.user_id)]


@router.post("/me/currencies", summary="Agregar una moneda a las que usas")
def add_currency(body: CurrencyIn, session: CurrentSession = Depends(current_session)) -> list[MyCurrencyOut]:
    try:
        users.add_currency(session.user_id, body.currency)
    except users.CurrencyError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    return my_currencies(session)


@router.delete("/me/currencies/{currency}", summary="Quitar una moneda que no usa ninguna cuenta ni movimiento")
def remove_currency(currency: str, session: CurrentSession = Depends(current_session)) -> list[MyCurrencyOut]:
    try:
        users.remove_currency(session.user_id, currency)
    except users.CurrencyError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
    return my_currencies(session)

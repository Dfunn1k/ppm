"""Reportes (X2): el índice, Gastos, Ingresos, Flujo, Patrimonio y Personas."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app import reports
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["reportes"])

PeriodQ = Annotated[str, Query(pattern=r"^\d{4}(-\d{2})?$", description="Un mes (2026-10) o un año (2026)")]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


class CategoryLineOut(BaseModel):
    id: int
    name: str
    icon: str | None
    color: int | None
    amount: Decimal
    previous: Decimal
    refunded: Decimal


class GroupLineOut(BaseModel):
    id: int
    name: str
    icon: str | None
    color: int | None
    amount: Decimal
    previous: Decimal
    children: list[CategoryLineOut]


class MonthAmountsOut(BaseModel):
    month: str
    total: Decimal
    groups: list[Decimal]


class ReportUnclassifiedOut(BaseModel):
    count: int
    amount: Decimal


class CategoryReportOut(BaseModel):
    kind: Literal["expense", "income"]
    period: str
    start: dt.date
    end: dt.date
    total: Decimal
    previous: Decimal
    groups: list[GroupLineOut]
    months: list[MonthAmountsOut]
    unclassified: ReportUnclassifiedOut


class FlowNodeOut(BaseModel):
    id: int | None
    name: str
    icon: str | None
    color: int | None
    amount: Decimal


class SavingMonthOut(BaseModel):
    month: str
    income: Decimal
    expense: Decimal
    percent: int | None


class FlowReportOut(BaseModel):
    period: str
    income: Decimal
    expense: Decimal
    saved: Decimal
    sources: list[FlowNodeOut]
    uses: list[FlowNodeOut]
    savings: list[SavingMonthOut]


class NetPointOut(BaseModel):
    date: dt.date
    amount: Decimal


class NetWorthPartOut(BaseModel):
    key: Literal["bank", "foreign", "receivable", "cash", "other"]
    amount: Decimal


class ForeignGainOut(BaseModel):
    currency: str
    amount: Decimal
    book: Decimal
    today: Decimal
    rate: Decimal


class NetWorthReportOut(BaseModel):
    currency: str
    today: Decimal
    months: list[NetPointOut]
    have: list[NetWorthPartOut]
    owe: Decimal
    foreign: list[ForeignGainOut]
    realized: Decimal


class DebtorOut(BaseModel):
    partner_id: int
    name: str
    amount: Decimal
    oldest_days: int
    overdue: bool
    next_due: dt.date | None


class CreditorOut(BaseModel):
    partner_id: int
    name: str
    amount: Decimal
    oldest_days: int


class PeopleReportOut(BaseModel):
    currency: str
    owes_me: Decimal
    i_owe: Decimal
    keep: Decimal
    ages: list[Decimal]
    debtors: list[DebtorOut]
    creditors: list[CreditorOut]


class SummaryOut(BaseModel):
    month: str
    currency: str
    expense: Decimal
    expense_previous: Decimal
    expense_groups: list[FlowNodeOut]
    income: Decimal
    income_previous: Decimal
    saved: Decimal
    saved_percent: int | None
    net_worth: Decimal
    net_worth_year_ago: Decimal
    net_worth_months: list[Decimal]
    owes_me: Decimal
    owed_over_90: Decimal
    tagged: Decimal                  # lo gastado con alguna etiqueta en el mes
    top_tag: str | None
    top_tag_color: int | None


@router.get("/reports/summary", summary="El índice de Reportes: la cifra de cada reporte en un mes")
def summary(month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
            session: CurrentSession = Depends(current_session)) -> SummaryOut:
    try:
        return SummaryOut.model_validate(asdict(reports.summary(session.user_id, month)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/reports/expenses", summary="Gastos por grupo y categoría, contra el periodo anterior")
def expenses(period: PeriodQ, session: CurrentSession = Depends(current_session)) -> CategoryReportOut:
    try:
        return CategoryReportOut.model_validate(asdict(reports.categories(session.user_id, "expense", period)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/reports/income", summary="Ingresos por categoría, contra el periodo anterior")
def income(period: PeriodQ, session: CurrentSession = Depends(current_session)) -> CategoryReportOut:
    try:
        return CategoryReportOut.model_validate(asdict(reports.categories(session.user_id, "income", period)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/reports/flow", summary="De dónde entró la plata, a dónde fue y cuánto guardaste")
def flow(period: PeriodQ, session: CurrentSession = Depends(current_session)) -> FlowReportOut:
    try:
        return FlowReportOut.model_validate(asdict(reports.flow(session.user_id, period)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/reports/net-worth", summary="Lo que realmente tengo: 12 cierres, cómo está repartido y la diferencia de cambio")
def net_worth(session: CurrentSession = Depends(current_session)) -> NetWorthReportOut:
    return NetWorthReportOut.model_validate(asdict(reports.net_worth(session.user_id)))


@router.get("/reports/people", summary="Quién te debe, a quién debes y desde cuándo")
def people(session: CurrentSession = Depends(current_session)) -> PeopleReportOut:
    return PeopleReportOut.model_validate(asdict(reports.people(session.user_id)))

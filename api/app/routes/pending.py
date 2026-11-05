"""Pendientes: la bandeja con los avisos que calcula PPM y tus recordatorios; posponer un aviso y
escribir, cambiar, hacer o borrar un recordatorio."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, StringConstraints

from app import pending
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["pendientes"])

Summary = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


class AmountOut(BaseModel):
    currency: str
    amount: Decimal


class NoticeOut(BaseModel):
    key: str
    kind: Literal["maturity", "card_due", "draft", "suspense", "recurring"]
    date: dt.date
    late: bool
    amounts: list[AmountOut]
    count: int
    partner_id: int | None
    partner: str | None
    account_id: int | None
    account: str | None
    recurring_id: int | None
    occurrence: dt.date | None
    name: str | None
    move_id: int | None
    bank_charges: int
    snooze_until: dt.date | None


class ActivityOut(BaseModel):
    id: int
    date: dt.date
    summary: str
    late: bool
    done_date: dt.date | None
    move_id: int | None
    move: str | None
    partner_id: int | None
    partner: str | None
    account_id: int | None
    account: str | None


class InboxOut(BaseModel):
    today: dt.date
    notice_days: int
    notices: list[NoticeOut]
    activities: list[ActivityOut]
    snoozed: list[NoticeOut]
    late: int


class SnoozeIn(BaseModel):
    key: Annotated[str, Field(min_length=1, max_length=100)]
    until: dt.date


class ActivityIn(BaseModel):
    date: dt.date
    summary: Summary
    move_id: int | None = None           # de qué cuelga: uno o ninguno
    partner_id: int | None = None
    account_id: int | None = None


class ActivityPatch(BaseModel):
    date: dt.date
    summary: Summary


class DoneIn(BaseModel):
    done: bool = True


class CreatedOut(BaseModel):
    id: int


@router.get("/pending", summary="La bandeja: avisos, recordatorios y lo pospuesto")
def inbox(session: CurrentSession = Depends(current_session)) -> InboxOut:
    return InboxOut.model_validate(asdict(pending.inbox(session.user_id)))


@router.post("/pending/snooze", summary="Posponer un aviso hasta una fecha")
def snooze(body: SnoozeIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        pending.snooze(session.user_id, body.key, body.until)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/pending/snooze", summary="Que un aviso pospuesto vuelva ya")
def unsnooze(key: str, session: CurrentSession = Depends(current_session)) -> Response:
    pending.unsnooze(session.user_id, key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/activities", summary="Los recordatorios de un movimiento, una persona o una cuenta (o los sueltos)")
def activities(move_id: int | None = None, partner_id: int | None = None, account_id: int | None = None,
               session: CurrentSession = Depends(current_session)) -> list[ActivityOut]:
    return [ActivityOut.model_validate(asdict(a))
            for a in pending.activities_of(session.user_id, move_id, partner_id, account_id)]


@router.post("/activities", status_code=status.HTTP_201_CREATED, summary="Escribir un recordatorio")
def create_activity(body: ActivityIn, session: CurrentSession = Depends(current_session)) -> CreatedOut:
    try:
        return CreatedOut(id=pending.create_activity(session.user_id, body.date, body.summary, body.move_id,
                                                     body.partner_id, body.account_id))
    except AccountError as e:
        raise _http(e) from None


@router.put("/activities/{activity_id}", summary="Cambiar el texto o la fecha (posponerlo)")
def update_activity(activity_id: int, body: ActivityPatch, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        pending.update_activity(session.user_id, activity_id, body.date, body.summary)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/activities/{activity_id}/done", summary="Marcarlo hecho (o deshacerlo)")
def set_done(activity_id: int, body: DoneIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        pending.set_done(session.user_id, activity_id, body.done)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/activities/{activity_id}", summary="Borrar un recordatorio")
def delete_activity(activity_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        pending.delete_activity(session.user_id, activity_id)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)

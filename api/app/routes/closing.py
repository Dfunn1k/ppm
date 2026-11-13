"""X4 · Cierre de periodo."""

import datetime as dt
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import closing
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["cierre"])


class ClosingOut(BaseModel):
    lock_date: dt.date | None    # cerrado hasta ese día; None = nada cerrado
    date: dt.date                # la fecha que se revisa
    suggested: dt.date           # el fin del mes pasado
    drafts: int                  # por confirmar hasta esa fecha
    unclassified: int            # por clasificar hasta esa fecha
    can_close: bool


class LockIn(BaseModel):
    lock_date: dt.date | None    # None = reabrir todo


@router.get("/closing", summary="El cierre de periodo y qué impide cerrar hasta una fecha")
def get_closing(date: dt.date | None = None, session: CurrentSession = Depends(current_session)) -> ClosingOut:
    return ClosingOut.model_validate(asdict(closing.status(session.user_id, date)))


@router.put("/closing", summary="Cerrar hasta una fecha, moverla (atrás reabre) o reabrir todo")
def set_lock(body: LockIn, session: CurrentSession = Depends(current_session)) -> ClosingOut:
    try:
        return ClosingOut.model_validate(asdict(closing.set_lock(session.user_id, body.lock_date)))
    except AccountError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from None

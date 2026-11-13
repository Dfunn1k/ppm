"""X4 · Cierre de periodo: hasta qué fecha está cerrado, qué impide cerrar hasta otra y cerrar o
reabrir. Las reglas viven en la base (0028): el candado de los asientos y lo que exige cerrar."""

import datetime as dt
from dataclasses import dataclass

import psycopg

from app.accounts import _translate
from app.db import user_transaction


@dataclass(frozen=True)
class Closing:
    lock_date: dt.date | None    # cerrado hasta ese día; None = nada cerrado
    date: dt.date                # la fecha que se revisa para cerrar
    suggested: dt.date           # el fin del mes pasado
    drafts: int                  # por confirmar hasta esa fecha
    unclassified: int            # por clasificar hasta esa fecha
    can_close: bool              # sin pendientes, ya pasó y va después del cierre actual


def status(user_id: int, on: dt.date | None = None) -> Closing:
    with user_transaction(user_id) as conn:
        today, lock = conn.execute("SELECT user_today(), lock_date FROM res_users").fetchone()
        suggested = today.replace(day=1) - dt.timedelta(days=1)
        when = on or suggested
        drafts, unclassified = conn.execute("SELECT * FROM lock_blockers(%s)", (when,)).fetchone()
    return Closing(lock, when, suggested, drafts, unclassified,
                   when < today and (lock is None or when > lock) and drafts == 0 and unclassified == 0)


def set_lock(user_id: int, on: dt.date | None) -> Closing:
    """Cerrar hasta una fecha, mover el cierre (atrás reabre) o quitarlo (None, reabrir todo)."""
    with user_transaction(user_id) as conn:
        try:
            with conn.transaction():
                conn.execute("UPDATE res_users SET lock_date = %s", (on,))
        except psycopg.Error as e:
            raise _translate(e) from None
    return status(user_id, on)

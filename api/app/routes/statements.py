"""Importar extracto (C7) y Por clasificar (M3). El archivo sube como multipart; la vista previa
lo lee y dice qué pasaría sin guardar nada, e importar hace lo mismo y lo guarda."""

from dataclasses import asdict
import datetime as dt
from decimal import Decimal
import json
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field, ValidationError

from app import statements
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session
from app.statement_file import FIELDS, Mapping

router = APIRouter(tags=["extractos"])

Field_ = Literal["date", "payment_ref", "amount", "debit", "credit", "operation_number", "currency", "balance"]
DateFormat = Literal["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


# --- Salida -----------------------------------------------------------------------------------

class MappingOut(BaseModel):
    header_row: int
    date_format: DateFormat
    decimal_separator: Literal[".", ","]
    columns: dict[Field_, str]       # campo → encabezado del archivo


class PreviewRowOut(BaseModel):
    date: dt.date
    payment_ref: str
    amount: Decimal


class ProblemOut(BaseModel):
    row: int                         # la fila, como se ve en Excel
    reason: str


class CountsOut(BaseModel):
    new: int                         # entran a Por clasificar
    matched: int                     # ya estaban en PPM: se enlazan
    duplicate: int                   # ya se importaron: se saltan
    zero: int                        # sin monto: se omiten
    problems: int                    # no entran


class CheckOut(BaseModel):
    source: Literal["file", "typed"] | None
    bank: Decimal | None             # el saldo según el banco
    book: Decimal                    # el de PPM a la fecha del último movimiento, con lo importado
    difference: Decimal | None       # banco − PPM


class ImportOut(BaseModel):
    file_name: str
    currency: str
    headers: list[str]
    mapping: MappingOut
    remembered: bool                 # el mapeo es el de la última vez con esta cuenta
    total_rows: int
    date_from: dt.date | None
    date_to: dt.date | None
    counts: CountsOut
    check: CheckOut
    sample: list[PreviewRowOut]
    problems: list[ProblemOut]
    statement_id: int | None         # al importar


class StatementRowOut(BaseModel):
    id: int
    name: str
    date_from: dt.date | None
    date_to: dt.date | None
    create_date: dt.datetime
    lines: int
    balance_end: Decimal | None
    difference: Decimal | None


class StatementDetailOut(BaseModel):
    statement: StatementRowOut
    account_id: int
    account: str
    currency: str
    book: Decimal | None
    pending: int                     # siguen por clasificar
    classified: int                  # ya tienen su lugar
    matched: int                     # ya estaban en PPM
    has_file: bool


class UndoOut(BaseModel):
    deleted: int                     # movimientos que se borraron


class UnclassifiedOut(BaseModel):
    move_id: int
    date: dt.date
    ref: str
    payment_ref: str | None
    operation_number: str | None
    account_id: int
    account: str
    currency: str
    amount: Decimal                  # con signo: lo que sale, en negativo
    posted: bool


# --- Entrada ----------------------------------------------------------------------------------

class ClassifyIn(BaseModel):
    move_ids: Annotated[list[int], Field(min_length=1, max_length=200)]
    account_id: int | None = None    # una categoría u otra cuenta tuya…
    role: Literal["receivable", "payable", "custody"] | None = None   # …o una persona: qué fue
    partner_id: int | None = None    # con quién (obligatorio con role; opcional en una categoría)


class _Columns(BaseModel):
    columns: dict[Field_, Annotated[str, Field(min_length=1, max_length=120)]]


def _mapping(header_row: int | None, date_format: str | None, decimal_separator: str | None,
             columns: str | None) -> Mapping | None:
    """El mapeo que eligió la persona; None para usar el recordado o el adivinado."""
    if columns is None:
        return None
    try:
        cols = _Columns(columns=json.loads(columns)).columns
    except (json.JSONDecodeError, ValidationError):
        raise HTTPException(422, f"columns va como JSON: {{campo: encabezado}}, con campos de {', '.join(FIELDS)}") from None
    return Mapping(header_row or 1, date_format or "DD/MM/YYYY", decimal_separator or ".", dict(cols))


def _run(account_id: int, file: UploadFile, header_row: int | None, date_format: str | None,
         decimal_separator: str | None, columns: str | None, balance_end: Decimal | None,
         session: CurrentSession, save: bool) -> ImportOut:
    mapping = _mapping(header_row, date_format, decimal_separator, columns)
    content = file.file.read(statements.MAX_BYTES + 1)
    try:
        r = statements.run(session.user_id, account_id, file.filename or "extracto", content, mapping,
                           balance_end, save)
    except AccountError as e:
        raise _http(e) from None
    return ImportOut.model_validate(asdict(r))


HeaderRow = Annotated[int | None, Form(ge=1, le=1000)]
DateFormatForm = Annotated[DateFormat | None, Form()]
Separator = Annotated[Literal[".", ","] | None, Form()]
Columns = Annotated[str | None, Form(description="JSON {campo: encabezado}; sin él, el recordado o el adivinado")]
BalanceEnd = Annotated[Decimal | None, Form(max_digits=14, decimal_places=2,
                                            description="El saldo según el banco, si el archivo no lo trae")]


# --- Rutas ------------------------------------------------------------------------------------

@router.post("/accounts/{account_id}/statements/preview", summary="Leer un extracto sin guardar nada")
def preview(account_id: int, file: Annotated[UploadFile, File()], header_row: HeaderRow = None,
            date_format: DateFormatForm = None, decimal_separator: Separator = None, columns: Columns = None,
            balance_end: BalanceEnd = None, session: CurrentSession = Depends(current_session)) -> ImportOut:
    return _run(account_id, file, header_row, date_format, decimal_separator, columns, balance_end, session, False)


@router.post("/accounts/{account_id}/statements", status_code=status.HTTP_201_CREATED,
             summary="Importar un extracto")
def create(account_id: int, file: Annotated[UploadFile, File()], header_row: HeaderRow = None,
           date_format: DateFormatForm = None, decimal_separator: Separator = None, columns: Columns = None,
           balance_end: BalanceEnd = None, session: CurrentSession = Depends(current_session)) -> ImportOut:
    return _run(account_id, file, header_row, date_format, decimal_separator, columns, balance_end, session, True)


@router.get("/accounts/{account_id}/statements", summary="Extractos importados a una cuenta")
def list_(account_id: int, session: CurrentSession = Depends(current_session)) -> list[StatementRowOut]:
    try:
        return [StatementRowOut.model_validate(asdict(s)) for s in statements.statements(session.user_id, account_id)]
    except AccountError as e:
        raise _http(e) from None


@router.get("/statements/{statement_id}", summary="Un extracto: su control de saldo y lo que trajo")
def detail(statement_id: int, session: CurrentSession = Depends(current_session)) -> StatementDetailOut:
    try:
        return StatementDetailOut.model_validate(asdict(statements.statement(session.user_id, statement_id)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/statements/{statement_id}/file", summary="Descargar el archivo original de un extracto",
            response_class=Response, responses={200: {"content": {"application/octet-stream": {}}}})
def file_(statement_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        name, mimetype, content = statements.statement_file(session.user_id, statement_id)
    except AccountError as e:
        raise _http(e) from None
    return Response(content, media_type=mimetype,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.delete("/statements/{statement_id}", summary="Deshacer una importación")
def undo(statement_id: int, session: CurrentSession = Depends(current_session)) -> UndoOut:
    try:
        return UndoOut(deleted=statements.undo(session.user_id, statement_id))
    except AccountError as e:
        raise _http(e) from None


@router.get("/unclassified", summary="Por clasificar: lo que trajiste del banco y falta decir en qué fue")
def unclassified(account_id: int | None = None,
                 session: CurrentSession = Depends(current_session)) -> list[UnclassifiedOut]:
    return [UnclassifiedOut.model_validate(asdict(u)) for u in statements.unclassified(session.user_id, account_id)]


@router.post("/unclassified/classify", status_code=status.HTTP_204_NO_CONTENT,
             summary="Clasificar uno o varios movimientos")
def classify(body: ClassifyIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        statements.classify(session.user_id, body.move_ids, body.account_id, body.role, body.partner_id)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)

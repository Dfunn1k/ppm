"""Adjuntos de un movimiento: subir una foto o un PDF, verlos, descargarlos y borrarlos."""

from dataclasses import asdict
import datetime as dt
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel

from app import attachments
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["adjuntos"])


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


class AttachmentOut(BaseModel):
    id: int
    name: str
    mimetype: str
    file_size: int
    create_date: dt.datetime
    page_count: int | None = None        # un PDF: cuántas páginas muestra el visor


@router.get("/moves/{move_id}/attachments", summary="Los adjuntos de un movimiento")
def of_move(move_id: int, session: CurrentSession = Depends(current_session)) -> list[AttachmentOut]:
    try:
        return [AttachmentOut.model_validate(asdict(a)) for a in attachments.of_move(session.user_id, move_id)]
    except AccountError as e:
        raise _http(e) from None


@router.post("/moves/{move_id}/attachments", status_code=status.HTTP_201_CREATED,
             summary="Adjuntar una foto (hasta 20 MB, se guarda achicada) o un PDF (hasta 5 MB)")
def add(move_id: int, file: Annotated[UploadFile, File()],
        session: CurrentSession = Depends(current_session)) -> AttachmentOut:
    content = file.file.read(attachments.MAX_PHOTO_BYTES + 1)
    try:
        return AttachmentOut.model_validate(asdict(attachments.add(session.user_id, move_id, content, file.filename)))
    except AccountError as e:
        raise _http(e) from None


@router.get("/attachments/{attachment_id}/file", summary="Ver o descargar un adjunto",
            response_class=Response, responses={200: {"content": {"application/octet-stream": {}}}})
def file_(attachment_id: int, download: bool = False, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        name, mimetype, content = attachments.content(session.user_id, attachment_id)
    except AccountError as e:
        raise _http(e) from None
    how = "attachment" if download else "inline"
    return Response(content, media_type=mimetype, headers={
        "Content-Disposition": f"{how}; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
    })


# Un adjunto no cambia nunca (otro archivo es otro adjunto): lo que sale de él se guarda en el navegador
_FOREVER = {"Cache-Control": "private, max-age=31536000, immutable"}


@router.get("/attachments/{attachment_id}/thumb", summary="La miniatura de un adjunto (WebP)",
            response_class=Response, responses={200: {"content": {"image/webp": {}}}})
def thumb(attachment_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        return Response(attachments.thumbnail(session.user_id, attachment_id), media_type="image/webp", headers=_FOREVER)
    except AccountError as e:
        raise _http(e) from None


@router.get("/attachments/{attachment_id}/view", summary="Lo que muestra el visor: la foto o una página del PDF",
            response_class=Response, responses={200: {"content": {"image/webp": {}}}})
def view(attachment_id: int, page: int = 1, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        content, mimetype = attachments.view(session.user_id, attachment_id, page)
    except AccountError as e:
        raise _http(e) from None
    return Response(content, media_type=mimetype, headers=_FOREVER)


@router.delete("/attachments/{attachment_id}", summary="Borrar un adjunto (el movimiento queda igual)")
def delete(attachment_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        attachments.delete(session.user_id, attachment_id)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)

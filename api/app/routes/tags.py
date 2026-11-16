"""Etiquetas: Más › Etiquetas, ponerlas en un movimiento y el reporte por etiqueta."""

from dataclasses import asdict
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app import tags
from app.accounts import AccountError
from app.routes.deps import CurrentSession, current_session

router = APIRouter(tags=["etiquetas"])

Color = Annotated[int, Field(ge=0, le=11)]          # la paleta de las categorías
Name = Annotated[str, Field(min_length=1, max_length=40)]


def _http(e: AccountError) -> HTTPException:
    return HTTPException(e.status, str(e))


class TagOut(BaseModel):
    id: int
    name: str
    color: int
    active: bool
    moves: int                       # cuántos movimientos la llevan


class TagIn(BaseModel):
    name: Name
    color: Color | None = None       # None = el siguiente de la paleta


class TagPatch(BaseModel):
    name: Name | None = None
    color: Color | None = None
    active: bool | None = None       # False = archivada: ya no se ofrece al elegir


class MoveTagsIn(BaseModel):
    tag_ids: list[int]


class TagCategoryOut(BaseModel):
    id: int
    name: str
    amount: Decimal


class TagLineOut(BaseModel):
    id: int
    name: str
    color: int
    amount: Decimal
    moves: int
    categories: list[TagCategoryOut]


class TagReportOut(BaseModel):
    period: str
    total: Decimal                   # lo gastado con alguna etiqueta (sin contar dos veces)
    tags: list[TagLineOut]


@router.get("/tags", summary="Tus etiquetas, las archivadas al final")
def list_(session: CurrentSession = Depends(current_session)) -> list[TagOut]:
    return [TagOut.model_validate(asdict(t)) for t in tags.list_tags(session.user_id)]


@router.post("/tags", status_code=status.HTTP_201_CREATED, summary="Crear una etiqueta")
def create(body: TagIn, session: CurrentSession = Depends(current_session)) -> TagOut:
    try:
        return TagOut.model_validate(asdict(tags.create_tag(session.user_id, body.name, body.color)))
    except AccountError as e:
        raise _http(e) from None


@router.patch("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT,
              summary="Renombrar, cambiar el color, archivar o desarchivar")
def update(tag_id: int, body: TagPatch, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        tags.update_tag(session.user_id, tag_id, body.name, body.color, body.active)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Eliminar una etiqueta: sale de sus movimientos, que no se tocan")
def delete(tag_id: int, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        tags.delete_tag(session.user_id, tag_id)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/moves/{move_id}/tags", status_code=status.HTTP_204_NO_CONTENT,
            summary="Las etiquetas de un movimiento (las de antes se reemplazan)")
def set_move_tags(move_id: int, body: MoveTagsIn, session: CurrentSession = Depends(current_session)) -> Response:
    try:
        tags.set_move_tags(session.user_id, move_id, body.tag_ids)
    except AccountError as e:
        raise _http(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/reports/tags", summary="Lo gastado con cada etiqueta, por categoría")
def report(period: Annotated[str, Query(pattern=r"^\d{4}(-\d{2})?$", description="Un mes (2026-10) o un año (2026)")],
           session: CurrentSession = Depends(current_session)) -> TagReportOut:
    try:
        return TagReportOut.model_validate(asdict(tags.report(session.user_id, period)))
    except AccountError as e:
        raise _http(e) from None

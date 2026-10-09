from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlmodel import Session

from app.deps import get_db, require_auth
from app.schemas import BlockCreate, BlockItems, BlockList, BlockRead, BlockUpdate, SmartListConfig
from app.services import blocks as blocks_service

router = APIRouter(prefix="/api/blocks", tags=["blocks"], dependencies=[Depends(require_auth)])


def _unprocessable(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))


def _not_found(block_id: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No block '{block_id}'")


@router.get("", response_model=BlockList)
def list_blocks(session: Session = Depends(get_db)):
    return BlockList(blocks=blocks_service.list_blocks(session))


@router.post("", response_model=BlockRead, status_code=status.HTTP_201_CREATED)
def create_block(payload: BlockCreate, session: Session = Depends(get_db)):
    try:
        return blocks_service.create_block(session, payload)
    except ValueError as exc:
        raise _unprocessable(exc)


@router.post("/preview", response_model=BlockItems)
def preview_smart_list(config: SmartListConfig, session: Session = Depends(get_db)):
    """What a smart list with these filters would show, before saving it."""
    return blocks_service.evaluate(session, config.model_dump(mode="json"))


@router.get("/{block_id}", response_model=BlockRead)
def get_block(block_id: str, session: Session = Depends(get_db)):
    block = blocks_service.get_block(session, block_id)
    if block is None:
        raise _not_found(block_id)
    return block


@router.patch("/{block_id}", response_model=BlockRead)
def update_block(block_id: str, payload: BlockUpdate, session: Session = Depends(get_db)):
    try:
        block = blocks_service.update_block(session, block_id, payload)
    except ValueError as exc:
        raise _unprocessable(exc)
    if block is None:
        raise _not_found(block_id)
    return block


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_block(block_id: str, session: Session = Depends(get_db)):
    """Delete a block and take it off every view. Tasks and events are untouched."""
    if not blocks_service.delete_block(session, block_id):
        raise _not_found(block_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{block_id}/items", response_model=BlockItems)
def block_items(block_id: str, session: Session = Depends(get_db)):
    try:
        items = blocks_service.block_items(session, block_id)
    except ValueError as exc:
        raise _unprocessable(exc)
    if items is None:
        raise _not_found(block_id)
    return items

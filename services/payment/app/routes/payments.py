"""Optional debug endpoint per CONTRACTS.md: GET /payments/{orderId}.

Not called by any other service -- Payment is Kafka-only otherwise.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app import db

router = APIRouter()


@router.get("/payments/{order_id}")
async def get_payment(order_id: str):
    payment = await db.get_payment_by_order_id(order_id)
    if payment is None:
        raise HTTPException(status_code=404, detail="payment not found")
    return {
        "status": payment["status"],
        "amount": float(payment["amount"]),
        "reason": payment["reason"],
    }

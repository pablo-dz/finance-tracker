import re

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from .financial_store import FinancialStore
from .movement_store import MovementStore
from .movements import authenticated_user, get_movement_store, member_for, valid_date, valid_id, valid_month, valid_option_id, valid_text
from .request_helpers import json_response, read_json_body
from .store import AuthStore, get_store


router = APIRouter()


def get_financial_store():
    return FinancialStore()


def positive_integer(value):
    return isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,11}", value) is not None


def balance_amount(value):
    return isinstance(value, str) and re.fullmatch(r"-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?", value) is not None


@router.api_route("/api/metas", methods=["GET", "POST"])
@router.api_route("/api/metas/aportes", methods=["POST", "DELETE"])
@router.api_route("/api/reportes", methods=["GET"])
@router.api_route("/api/cuentas/saldo-inicial", methods=["PUT"])
async def financial(request: Request, store: AuthStore = Depends(get_store),
                    movements: MovementStore = Depends(get_movement_store),
                    financial_store: FinancialStore = Depends(get_financial_store)):
    user = await authenticated_user(request, store)
    if not user:
        return json_response({"error": "Inicia sesión para continuar."}, 401)
    path, method = request.url.path, request.method
    if path == "/api/reportes":
        months = request.query_params.getlist("meses")
        month = request.query_params.getlist("mes")
        if len(month) != 1 or not valid_month(month[0]) or len(months) != 1 or months[0] not in ("3", "6", "12"):
            return json_response({"error": "Selecciona un mes y un período válido para el reporte."}, 400)
    if method != "GET":
        body, error = await read_json_body(request)
        if error:
            return error
        if path == "/api/metas":
            valid = (isinstance(body, dict) and valid_text(body.get("name"), True)
                     and positive_integer(body.get("targetAmount"))
                     and (body.get("dueDate") is None or valid_date(body.get("dueDate"))))
            message = "Ingresa un nombre, un objetivo positivo en pesos enteros y una fecha válida."
        elif path == "/api/metas/aportes" and method == "POST":
            valid = (isinstance(body, dict) and valid_option_id(body.get("goalId"))
                     and positive_integer(body.get("amount")) and valid_date(body.get("date"))
                     and ("note" not in body or valid_text(body["note"], False)))
            message = "Revisa la meta, el aporte positivo en pesos enteros, la fecha y la descripción."
        elif path == "/api/metas/aportes":
            valid = isinstance(body, dict) and valid_id(body.get("id"))
            message = "El identificador del aporte no es válido."
        else:
            valid = (isinstance(body, dict) and valid_option_id(body.get("accountId"))
                     and balance_amount(body.get("amount")) and balance_amount(body.get("expectedAmount")))
            message = "Ingresa un saldo inicial válido para la cuenta."
        if not valid:
            return json_response({"error": message}, 400)

    member_message = ("Configura un hogar personal en CLP con un único integrante activo." if method == "GET"
                      else "La configuración personal requiere CLP y una sola persona activa.")
    member, error = await member_for(user, movements, member_message)
    if error:
        return error
    if path == "/api/metas" and method == "GET":
        return json_response({"goals": await run_in_threadpool(financial_store.goals, member)})
    if path == "/api/reportes":
        report = await run_in_threadpool(financial_store.report, member, month[0], months[0])
        return json_response({"month": month[0], "months": int(months[0]), **report})
    if path == "/api/metas":
        if not await run_in_threadpool(financial_store.create_goal, member, body):
            return json_response({"error": "No se pudo crear la meta en el hogar personal. Vuelve a consultar."}, 409)
        return json_response({"message": "Meta de ahorro creada correctamente."}, 201)
    if path == "/api/metas/aportes" and method == "POST":
        if not await run_in_threadpool(financial_store.create_contribution, member, body):
            return json_response({"error": "La meta no existe o no pertenece al hogar personal."}, 404)
        return json_response({"message": "Aporte registrado correctamente."}, 201)
    if path == "/api/metas/aportes":
        if not await run_in_threadpool(financial_store.delete_contribution, member, body["id"]):
            return json_response({"error": "El aporte no existe o ya no está disponible."}, 404)
        return json_response({"message": "Aporte eliminado correctamente."})
    if not await run_in_threadpool(financial_store.update_opening_balance, member, body):
        return json_response({"error": "La cuenta o su saldo inicial cambió. Vuelve a consultar antes de editarlo."}, 409)
    return json_response({"message": "Saldo inicial actualizado correctamente."})

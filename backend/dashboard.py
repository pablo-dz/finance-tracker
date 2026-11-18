import re
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from .dashboard_store import DashboardStore
from .movement_store import MovementStore
from .movements import authenticated_user, get_movement_store, member_for, valid_id, valid_month, valid_option_id, valid_text
from .request_helpers import json_response, read_json_body
from .store import AuthStore, get_store


router = APIRouter()


def get_dashboard_store():
    return DashboardStore()


def valid_recurring(body):
    return (isinstance(body, dict) and valid_text(body.get("name"), True)
            and body.get("frequency") in ("monthly", "yearly")
            and isinstance(body.get("amount"), str)
            and re.fullmatch(r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?", body["amount"]) is not None
            and Decimal(body["amount"]) > 0)


@router.api_route("/api/dashboard", methods=["GET"])
@router.api_route("/api/dashboard/categorias", methods=["GET", "PATCH"])
@router.api_route("/api/recurrentes", methods=["GET", "POST", "PUT", "DELETE"])
async def dashboard(request: Request, store: AuthStore = Depends(get_store),
                    movements: MovementStore = Depends(get_movement_store),
                    dashboard_store: DashboardStore = Depends(get_dashboard_store)):
    user = await authenticated_user(request, store)
    if not user:
        return json_response({"error": "Inicia sesión para continuar."}, 401)

    path, method = request.url.path, request.method
    if path == "/api/dashboard":
        months = request.query_params.getlist("mes")
        if len(months) != 1 or not valid_month(months[0]):
            return json_response({"error": "Selecciona un mes válido."}, 400)
    elif method != "GET":
        body, error = await read_json_body(request)
        if error:
            return error
        if path == "/api/dashboard/categorias":
            valid = isinstance(body, dict) and valid_option_id(body.get("id")) and type(body.get("fixed")) is bool
        elif method == "DELETE":
            valid = isinstance(body, dict) and valid_id(body.get("id"))
        else:
            valid = valid_recurring(body) and (method == "POST" or valid_id(body.get("id")))
        if not valid:
            return json_response({"error": "Revisa los datos ingresados."}, 400)

    member, error = await member_for(user, movements, "La configuración personal requiere CLP y una sola persona activa.")
    if error:
        return error
    if path == "/api/dashboard":
        return json_response(await run_in_threadpool(dashboard_store.analytics, member, months[0]))
    if path == "/api/dashboard/categorias":
        if method == "GET":
            return json_response({"categories": await run_in_threadpool(dashboard_store.categories, member)})
        if not await run_in_threadpool(dashboard_store.set_category_fixed, member, body):
            return json_response({"error": "La categoría no está disponible."}, 404)
        return json_response({"message": "Clasificación actualizada."})
    if method == "GET":
        return json_response({"payments": await run_in_threadpool(dashboard_store.recurring, member)})
    if not await run_in_threadpool(dashboard_store.write_recurring, member, body, method):
        return json_response({"error": "El pago recurrente no está disponible."}, 404)
    return json_response({"message": "Pago recurrente guardado."}, 201 if method == "POST" else 200)

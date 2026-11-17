import re

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from .movement_store import MovementStore
from .movements import authenticated_user, get_movement_store, member_for, valid_month, valid_option_id, valid_text
from .planning_store import PlanningStore
from .request_helpers import json_response, read_json_body
from .store import AuthStore, get_store


router = APIRouter()


def get_planning_store():
    return PlanningStore()


def valid_amount(value, expected=False):
    pattern = r"(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?" if expected else r"(?:0|[1-9][0-9]{0,11})"
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


@router.api_route("/api/categorias", methods=["GET", "POST", "PUT", "PATCH"])
@router.api_route("/api/presupuestos", methods=["GET", "POST", "PUT"])
async def planning(request: Request, store: AuthStore = Depends(get_store),
                   movements: MovementStore = Depends(get_movement_store),
                   planning_store: PlanningStore = Depends(get_planning_store)):
    user = await authenticated_user(request, store)
    if not user:
        return json_response({"error": "Inicia sesión para continuar."}, 401)
    category = request.url.path == "/api/categorias"
    method = request.method
    if method == "GET":
        if not category:
            months = request.query_params.getlist("mes")
            if len(months) != 1 or not valid_month(months[0]):
                return json_response({"error": "Selecciona un mes válido."}, 400)
    else:
        body, error = await read_json_body(request)
        if error:
            return error
        if category:
            valid = isinstance(body, dict) and (
                (method == "POST" and valid_text(body.get("name"), True))
                or (method == "PUT" and valid_option_id(body.get("id")) and valid_text(body.get("name"), True))
                or (method == "PATCH" and valid_option_id(body.get("id")) and type(body.get("active")) is bool)
            )
            if not valid:
                return json_response({"error": "Revisa el nombre o el estado de la categoría."}, 400)
        else:
            valid = (isinstance(body, dict) and valid_month(body.get("month"))
                     and valid_option_id(body.get("categoryId")) and valid_amount(body.get("amount"))
                     and (method == "POST" or valid_amount(body.get("expectedAmount"), expected=True)))
            if not valid:
                return json_response({"error": "Selecciona un mes y una categoría válidos e ingresa un límite entero en CLP."}, 400)

    member, error = await member_for(user, movements, "La configuración personal requiere CLP y una sola persona activa.")
    if error:
        return error
    if method == "GET":
        if category:
            rows = await run_in_threadpool(planning_store.categories, member["household_id"])
            return json_response({"categories": rows})
        rows = await run_in_threadpool(planning_store.budgets, member, months[0])
        return json_response({"month": months[0], "categories": rows})
    if category:
        result = await run_in_threadpool(planning_store.write_category, member, body, method)
        if not result:
            if result is None:
                message = "Ya existe una categoría con ese nombre."
            elif method == "POST":
                message = "Ya existe una categoría con ese nombre. Revisa también las categorías archivadas."
            else:
                message = "La categoría no está disponible o el nombre ya está en uso."
            return json_response({"error": message}, 409)
        message = ("Categoría creada correctamente." if method == "POST" else
                   "Categoría renombrada correctamente." if method == "PUT" else
                   "Categoría restaurada correctamente." if body["active"] else
                   "Categoría archivada; su historial se conserva.")
    else:
        result = await run_in_threadpool(planning_store.write_budget, member, body, method)
        if not result:
            message = ("La categoría no está disponible o ya tiene un presupuesto para ese mes. Vuelve a consultar."
                       if method == "POST" else
                       "El presupuesto cambió o ya no está disponible. Vuelve a consultar antes de editarlo.")
            return json_response({"error": message}, 409)
        message = "Presupuesto guardado correctamente."
    return json_response({"message": message}, 201 if method == "POST" else 200)

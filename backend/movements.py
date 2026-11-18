import re
from datetime import date

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from .auth import request_token
from .request_helpers import json_response, read_json_body
from .movement_store import MovementStore
from .store import AuthStore, get_store


router = APIRouter()


def get_movement_store():
    return MovementStore()


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,18}", value) is not None \
        and int(value) <= 9223372036854775807


def valid_option_id(value):
    return type(value) in (int, float) and 0 < value <= 2147483647 and value % 1 == 0


def valid_date(value):
    if not isinstance(value, str) or re.fullmatch(r"(?:19[0-9]{2}|[2-9][0-9]{3})-[0-9]{2}-[0-9]{2}", value) is None:
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def valid_month(value):
    return isinstance(value, str) and re.fullmatch(r"(?:19[0-9]{2}|[2-9][0-9]{3})-(?:0[1-9]|1[0-2])", value) is not None


def valid_text(value, required):
    if not isinstance(value, str):
        return False
    try:
        length = len(value.strip().encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        return False
    return length <= 100 and (not required or length > 0)


def valid_transaction(body):
    return (
        isinstance(body, dict)
        and valid_text(body.get("merchant"), True)
        and isinstance(body.get("amount"), str)
        and re.fullmatch(r"[1-9][0-9]{0,11}", body["amount"]) is not None
        and valid_date(body.get("date"))
        and valid_option_id(body.get("accountId"))
        and valid_option_id(body.get("categoryId"))
    )


def valid_transfer(body):
    return (
        isinstance(body, dict)
        and valid_date(body.get("date"))
        and isinstance(body.get("amount"), str)
        and re.fullmatch(r"(?:[1-9][0-9]{0,11}(?:\.[0-9]{1,2})?|0\.(?:0[1-9]|[1-9][0-9]?))", body["amount"]) is not None
        and valid_option_id(body.get("sourceAccountId"))
        and valid_option_id(body.get("destinationAccountId"))
        and body["sourceAccountId"] != body["destinationAccountId"]
        and ("note" not in body or valid_text(body["note"], False))
    )


async def authenticated_user(request, store):
    token = request_token(request)
    return await run_in_threadpool(store.session_user, token) if token else None


async def member_for(user, movements, message):
    member = await run_in_threadpool(movements.personal_member, user["household_id"])
    return member, None if member else json_response({"error": message}, 409)


@router.get("/api/opciones")
@router.get("/api/movimientos")
async def read_movements(request: Request, store: AuthStore = Depends(get_store),
                         movements: MovementStore = Depends(get_movement_store)):
    user = await authenticated_user(request, store)
    if not user:
        return json_response({"error": "Inicia sesión para continuar."}, 401)
    if request.url.path == "/api/movimientos":
        months = request.query_params.getlist("mes")
        all_periods = request.query_params.getlist("todos")
        if not ((len(months) == 1 and valid_month(months[0]) and not all_periods)
                or (not months and all_periods == ["1"])):
            return json_response({"error": "Selecciona un mes válido."}, 400)
        message = "Configura un hogar personal en CLP con un único integrante activo."
    else:
        message = "Configura tu perfil personal en CLP con una sola persona activa."
    member, error = await member_for(user, movements, message)
    if error:
        return error
    result = await run_in_threadpool(
        movements.movements if request.url.path == "/api/movimientos" else movements.options,
        *([member, months[0] if months else None] if request.url.path == "/api/movimientos" else [member]),
    )
    return json_response(result)


@router.api_route("/api/gastos", methods=["GET", "POST", "PUT", "DELETE"])
@router.api_route("/api/ingresos", methods=["GET", "POST", "PUT", "DELETE"])
@router.api_route("/api/transferencias", methods=["GET", "POST", "PUT", "DELETE"])
async def edit_movement(request: Request, store: AuthStore = Depends(get_store),
                        movements: MovementStore = Depends(get_movement_store)):
    user = await authenticated_user(request, store)
    if not user:
        return json_response({"error": "Inicia sesión para continuar."}, 401)
    kind = {"/api/gastos": "expense", "/api/ingresos": "income", "/api/transferencias": "transfer"}[request.url.path]
    method = request.method
    if method == "GET":
        if kind != "expense":
            return json_response({"error": "No encontrado."}, 404)
        months = request.query_params.getlist("mes")
        if len(months) != 1 or not valid_month(months[0]):
            return json_response({"error": "Selecciona un mes válido."}, 400)
        member, error = await member_for(user, movements, "La configuración personal requiere CLP y una sola persona activa.")
        if error:
            return error
        return json_response(await run_in_threadpool(movements.expenses, member, months[0]))

    body, error = await read_json_body(request)
    if error:
        return error
    if method == "DELETE":
        if not isinstance(body, dict) or not valid_id(body.get("id")):
            message = "El identificador del gasto no es válido." if kind == "expense" else "El identificador del movimiento no es válido."
            return json_response({"error": message}, 400)
    elif not (valid_transfer(body) if kind == "transfer" else valid_transaction(body)) \
            or (method == "PUT" and not valid_id(body.get("id"))):
        messages = {
            "expense": "Revisa la descripción, el monto entero en CLP, la fecha, la categoría y la cuenta.",
            "income": "Revisa la descripción, el monto, la fecha, la categoría y la cuenta del ingreso.",
            "transfer": "Revisa el monto, la fecha y las cuentas de origen y destino de la transferencia.",
        }
        return json_response({"error": messages[kind]}, 400)
    member, error = await member_for(user, movements, "La configuración personal requiere CLP y una sola persona activa.")
    if error:
        return error
    if method == "DELETE":
        deleted = await run_in_threadpool(movements.delete, member, kind, body["id"])
        if not deleted:
            message = "El gasto personal no existe o ya no está disponible." if kind == "expense" \
                else "El ingreso o transferencia no existe o ya no está disponible."
            return json_response({"error": message}, 404)
        label = {"expense": "Gasto", "income": "Ingreso", "transfer": "Transferencia"}[kind]
        return json_response({"message": f"{label} {'eliminada' if kind == 'transfer' else 'eliminado'} correctamente."})
    write = movements.write_transfer if kind == "transfer" else movements.write_transaction
    args = (member, body, method) if kind == "transfer" else (member, kind, body, method)
    if not await run_in_threadpool(write, *args):
        messages = {
            "expense": "El gasto, la cuenta o la categoría no pertenece a tu configuración personal o ya no está disponible.",
            "income": "El ingreso, la cuenta o la categoría no pertenece a tu configuración personal o ya no está disponible.",
            "transfer": "La transferencia o sus cuentas no pertenecen a tu configuración personal o ya no están disponibles.",
        }
        return json_response({"error": messages[kind]}, 400)
    label = {"expense": "Gasto", "income": "Ingreso", "transfer": "Transferencia"}[kind]
    verb = ("registrada" if method == "POST" else "actualizada") if kind == "transfer" \
        else ("registrado" if method == "POST" else "actualizado")
    return json_response({"message": f"{label} {verb} correctamente."}, 201 if method == "POST" else 200)

import logging
from pathlib import Path

import psycopg
from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .auth import COOKIE_NAME, SESSION_SECONDS, request_token, valid_credentials, verify_password
from .request_helpers import json_response, read_json_body
from .movements import router as movements_router
from .planning import router as planning_router
from .financial import router as financial_router
from .dashboard import router as dashboard_router
from .store import AuthStore, get_store


logger = logging.getLogger(__name__)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.include_router(movements_router)
app.include_router(planning_router)
app.include_router(financial_router)
app.include_router(dashboard_router)


def set_session_cookie(response, token):
    response.set_cookie(COOKIE_NAME, token, max_age=SESSION_SECONDS, httponly=True, samesite="strict", path="/")


@app.exception_handler(psycopg.Error)
async def database_error(request, error):
    logger.exception("Error al atender la solicitud", exc_info=error)
    return json_response({"error": "No se pudo completar la solicitud. Revisa la conexión y el servidor."}, 500)


@app.get("/api/auth/session")
def session(request: Request, store: AuthStore = Depends(get_store)):
    token = request_token(request)
    user = store.session_user(token) if token else None
    return json_response({"user": {"email": user["email"]} if user else None})


@app.post("/api/auth/{action}")
async def authenticate(action: str, request: Request, store: AuthStore = Depends(get_store)):
    if action not in ("register", "login", "logout"):
        return json_response({"error": "No encontrado."}, 404)
    body, error = await read_json_body(request)
    if error:
        return error
    if action == "logout":
        token = request_token(request)
        if token:
            await run_in_threadpool(store.delete_session, token)
        response = json_response({"message": "Sesión cerrada."})
        response.delete_cookie(COOKIE_NAME, httponly=True, samesite="strict", path="/")
        return response
    if not valid_credentials(body):
        return json_response({"error": "Ingresa un correo válido y una contraseña de entre 12 y 128 caracteres."}, 400)
    email = body["email"].strip().lower()
    password = body["password"]
    if action == "register":
        try:
            token = await run_in_threadpool(store.register, email, password)
        except psycopg.errors.UniqueViolation:
            return json_response({"error": "Ya existe una cuenta con ese correo."}, 409)
        response = json_response({"user": {"email": email}}, 201)
    else:
        user = await run_in_threadpool(store.find_user, email)
        if not user or not await run_in_threadpool(verify_password, password, user["password_hash"]):
            return json_response({"error": "Correo o contraseña incorrectos."}, 401)
        token = await run_in_threadpool(store.create_session, user["user_id"])
        response = json_response({"user": {"email": user["email"]}})
    set_session_cookie(response, token)
    return response


WEB_DIR = Path(__file__).resolve().parent.parent / "frontend"
ASSET_DIR = WEB_DIR.parent / "assets"


@app.get("/", include_in_schema=False)
def dashboard():
    return FileResponse(WEB_DIR / "index.html", media_type="text/html", headers={"Cache-Control": "no-cache"})


@app.get("/assets/finance-tracker-icon.svg", include_in_schema=False)
def finance_tracker_icon():
    return FileResponse(ASSET_DIR / "finance-tracker-icon.svg", media_type="image/svg+xml",
                        headers={"Cache-Control": "no-cache"})


@app.get("/{filename}", include_in_schema=False)
def dashboard_asset(filename: str):
    assets = {"dashboard.js": "text/javascript", "chart.js": "text/javascript", "styles.css": "text/css"}
    if filename not in assets:
        return json_response({"error": "No encontrado."}, 404)
    return FileResponse(WEB_DIR / filename, media_type=assets[filename], headers={"Cache-Control": "no-cache"})


@app.get("/modules/{filename}", include_in_schema=False)
def dashboard_module(filename: str):
    modules = {"auth.js", "common.js", "expenses.js", "movements.js", "planning.js",
               "savings.js", "analytics.js", "visualizations.js"}
    if filename not in modules:
        return json_response({"error": "No encontrado."}, 404)
    return FileResponse(WEB_DIR / "modules" / filename, media_type="text/javascript",
                        headers={"Cache-Control": "no-cache"})

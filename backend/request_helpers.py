import json

from fastapi.responses import JSONResponse


def json_response(data, status_code=200):
    return JSONResponse(data, status_code=status_code, headers={"Cache-Control": "no-store"})


def reject_json_constant(value):
    raise ValueError(f"Constante JSON inválida: {value}")


async def read_json_body(request):
    server = request.scope.get("server")
    origin = f"http://127.0.0.1:{server[1]}" if server else None
    if (not origin or request.headers.get("host") != origin.removeprefix("http://")
            or request.headers.get("origin") != origin
            or request.headers.get("content-type") != "application/json"):
        return None, json_response({"error": "Solicitud no permitida."}, 403)
    length = request.headers.get("content-length", "")
    if (not length.isascii() or not length.isdigit()
            or len(length.lstrip("0")) > 4 or int(length.lstrip("0") or "0") > 8192):
        return None, json_response({"error": "El contenido de la solicitud es demasiado grande o inválido."}, 413)
    chunks = []
    received = 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > 8192:
            return None, json_response({"error": "El contenido de la solicitud es demasiado grande."}, 413)
        chunks.append(chunk)
    try:
        body = json.loads(b"".join(chunks), parse_constant=reject_json_constant)
    except (ValueError, UnicodeDecodeError):
        return None, json_response({"error": "El contenido de la solicitud no es válido."}, 400)
    if body is None:
        return None, json_response({"error": "El contenido de la solicitud no es válido."}, 400)
    return body, None

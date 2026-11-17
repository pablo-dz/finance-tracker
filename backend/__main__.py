import os
import re

import uvicorn


port = os.environ.get("PORT", "3000")
if re.fullmatch(r"[1-9][0-9]*", port) is None or int(port) > 65535:
    raise SystemExit("PORT debe ser un puerto entre 1 y 65535.")

uvicorn.run("backend.app:app", host="127.0.0.1", port=int(port), proxy_headers=False)

"""Imprime el contrato de la API (OpenAPI) sin levantarla ni tocar la base.

La web genera sus tipos con él:  uv run python -m scripts.openapi > /tmp/openapi.json
"""

import json

from app.main import app

print(json.dumps(app.openapi(), ensure_ascii=False, indent=2))

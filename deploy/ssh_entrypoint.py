#!/usr/bin/env python3
"""Comando forzado de la llave de Actions: no acepta una shell ni argumentos libres."""
import os
from pathlib import Path
import re
import subprocess
import sys


def arguments(command):
    if command == "check":
        return ["check"]
    match = re.fullmatch(r"deploy ([0-9a-f]{40})", command)
    if not match:
        raise ValueError("Solo se acepta check o deploy seguido de un SHA completo")
    return ["deploy", "--sha", match[1]]


def main():
    try:
        args = arguments(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2
    # El primer despliegue puede ser el que incorpora estos archivos al repo.
    # Después se usa la versión que ya está desplegada y aprobada en main.
    script = Path("/opt/ppm/deploy/release.py")
    if not script.is_file():
        script = Path(__file__).resolve().with_name("release.py")
    return subprocess.call([sys.executable, str(script), *args])


if __name__ == "__main__":
    sys.exit(main())

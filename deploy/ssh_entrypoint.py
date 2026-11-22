#!/usr/bin/env python3
"""Comando forzado de la llave de Actions: no acepta una shell ni argumentos libres."""
import os
from datetime import datetime, timezone
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


def execute(script, args):
    state = Path.home() / ".cache/ppm-desplegar"
    state.mkdir(parents=True, exist_ok=True)
    label = args[-1][:12] if args[0] == "deploy" else "check"
    log_path = state / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}-{label}-ssh.log"
    print(f"LOG={log_path}", flush=True)
    with log_path.open("x") as log:
        log_path.chmod(0o600)
        # Si se corta SSH, el despliegue continúa y deja su salida en la VPS.
        process = subprocess.Popen([sys.executable, "-u", str(script), *args], stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        status = process.wait()
    print(log_path.read_text(), end="", flush=True)
    return status


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
    return execute(script, args)


if __name__ == "__main__":
    sys.exit(main())

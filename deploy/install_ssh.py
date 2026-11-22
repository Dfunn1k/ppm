#!/usr/bin/env python3
"""Prepara una llave de Actions con comando forzado, sin mostrar la llave privada."""
import os
from pathlib import Path
import shutil
import subprocess


def install(home, source):
    target = home / ".local/lib/ppm-deploy"
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    for name in ("release.py", "ssh_entrypoint.py"):
        temporary = target / (name + ".tmp")
        shutil.copyfile(source / name, temporary)
        temporary.chmod(0o700)
        temporary.replace(target / name)
    ssh = home / ".ssh"
    ssh.mkdir(exist_ok=True, mode=0o700)
    ssh.chmod(0o700)
    key = ssh / "ppm_github_actions"
    if not key.exists():
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "ppm-github-actions",
                        "-f", str(key)], check=True)
    key.chmod(0o600)
    public = Path(str(key) + ".pub").read_text().strip()
    # Conserva todas las demás llaves. Solo esta identidad recibe el comando forzado.
    auth = ssh / "authorized_keys"
    existing = auth.read_text() if auth.exists() else ""
    key_data = public.split()[1]
    entry = (f'restrict,command="/usr/bin/python3 {target}/ssh_entrypoint.py" {public}')
    lines = [line for line in existing.splitlines() if key_data not in line.split()]
    lines.append(entry)
    temporary = ssh / "authorized_keys.ppm.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write("\n".join(lines) + "\n")
    temporary.chmod(0o600)
    temporary.replace(auth)
    return key


if __name__ == "__main__":
    key = install(Path.home(), Path(__file__).resolve().parent)
    print(f"Acceso restringido preparado. Llave privada para PPM_DEPLOY_SSH_KEY: {key}")
    print("No subas esa llave al repositorio ni la pegues en un chat.")

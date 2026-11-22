#!/usr/bin/env python3
"""Inspección y despliegue de PPM. Revisar y probar antes de deploy."""
import argparse
import fcntl
import hashlib
import json
import re
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path('/opt/ppm')
STATE = Path.home() / '.cache/ppm-desplegar'
DOMAIN = 'ppm.danychavezdev.com'
DOCKER = ['sudo', '-n', 'docker']
COMPOSE = DOCKER + ['compose', '-f', str(REPO / 'docker-compose.prod.yml'), '--project-directory', str(REPO)]


def run(args, *, capture=True, **kwargs):
    result = subprocess.run(args, cwd=REPO, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None, **kwargs)
    return result.stdout.strip() if capture else ''


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def git(*args):
    return run(['git', *args])


def preflight():
    require((REPO / 'AGENTS.md').is_file(), 'Falta /opt/ppm/AGENTS.md; verifica el entorno.')
    require(git('remote', 'get-url', 'origin') == 'git@github.com:Dfunn1k/ppm.git', 'Remoto inesperado.')
    require(git('branch', '--show-current') == 'main', 'Producción no está en main.')
    require(not git('status', '--porcelain'), 'Hay cambios locales; no se sobrescriben.')
    run(DOCKER + ['info', '--format', '{{.ServerVersion}}'])
    git('fetch', 'origin', 'main')
    before, target = git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main')
    git('merge-base', '--is-ancestor', before, target)
    return before, target


def curl(path):
    return run(['curl', '--fail', '--silent', '--show-error', '--connect-timeout', '10',
                '--max-time', '30', f'https://{DOMAIN}{path}'])


def check():
    for service in ('db', 'api', 'web'):
        cid = run(COMPOSE + ['ps', '-q', service])
        require(bool(cid), f'{service} no está activo.')
        state = json.loads(run(DOCKER + ['inspect', '--format', '{{json .State}}', cid]))
        require(state['Running'] and not state['Restarting'], f'{service} no está estable.')
        if service == 'db':
            require(state.get('Health', {}).get('Status') == 'healthy', 'PostgreSQL no está healthy.')
        if service in ('db', 'api'):
            bindings = json.loads(run(DOCKER + ['inspect', '--format', '{{json .HostConfig.PortBindings}}', cid]))
            require(not bindings, f'{service} tiene puertos publicados inesperados.')
    for service in ('migrate', 'usuario-api'):
        cid = run(COMPOSE + ['ps', '-a', '-q', service])
        require(bool(cid), f'Falta {service}.')
        state = json.loads(run(DOCKER + ['inspect', '--format', '{{json .State}}', cid]))
        require(state['Status'] == 'exited' and state['ExitCode'] == 0, f'{service} no terminó correctamente.')
    for attempt in range(12):
        try:
            health = json.loads(curl('/api/health'))
            require(health.get('status') == 'ok', 'Health no está ok.')
            break
        except (subprocess.CalledProcessError, ValueError, RuntimeError):
            if attempt == 11:
                raise
            time.sleep(2)
    html = curl('/')
    require('<html' in html.lower(), 'La raíz no devuelve HTML.')
    assets = sorted(set(re.findall(r'(?:src|href)="(/assets/[^"?]+)', html)))
    require(bool(assets), 'No se encontraron assets construidos.')
    for asset in assets:
        run(['curl', '--fail', '--silent', '--show-error', '--max-time', '30',
             '--output', '/dev/null', f'https://{DOMAIN}{asset}'])
    served = run(COMPOSE + ['exec', '-T', 'web', 'cat', '/srv/index.html'])
    require(served == html, 'La web pública no coincide con este contenedor.')
    migrations = [p.name.split('_', 1)[0] for p in (REPO / 'api/db/migrations').glob('*.sql')]
    applied = run(COMPOSE + ['exec', '-T', 'db', 'psql', '-U', 'ppm', '-d', 'ppm', '-Atc',
                             'SELECT version FROM schema_migrations ORDER BY version'])
    require({int(v) for v in migrations} == {int(v) for v in applied.splitlines()}, 'Las migraciones no coinciden.')
    digest_code = "import pathlib,hashlib,json; print(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('app').rglob('*.py')}))"
    actual = json.loads(run(COMPOSE + ['exec', '-T', 'api', 'python', '-c', digest_code]))
    expected = {str(p.relative_to(REPO / 'api')): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (REPO / 'api/app').rglob('*.py')}
    require(actual == expected, 'La API activa no coincide con las fuentes locales.')
    print('VERIFICADO: DB healthy, API/web activos, tareas exited 0, HTTPS/assets, migraciones y fuentes.', flush=True)
    return health


def backup():
    output = run(['sudo', '-n', str(REPO / 'deploy/respaldo.sh')])
    print(output, flush=True)
    paths = re.findall(r'(/var/backups/ppm/ppm-[^\s()]+\.(?:dump|tar\.gz))', output)
    require(len(paths) == 2, 'No se identificaron ambos respaldos; revisa la salida.')
    dump = next(p for p in paths if p.endswith('.dump'))
    archive = next(p for p in paths if p.endswith('.tar.gz'))
    with subprocess.Popen(['sudo', '-n', 'cat', dump], stdout=subprocess.PIPE) as source:
        subprocess.run(COMPOSE + ['exec', '-T', 'db', 'pg_restore', '--list'], cwd=REPO,
                       stdin=source.stdout, stdout=subprocess.DEVNULL, check=True)
        source.stdout.close()
        require(source.wait() == 0, 'No se pudo leer el dump.')
    with subprocess.Popen(['sudo', '-n', 'cat', archive], stdout=subprocess.PIPE) as source:
        with tarfile.open(fileobj=source.stdout, mode='r|gz') as tar:
            for item in tar:
                if item.isfile():
                    data = tar.extractfile(item)
                    while data.read(1024 * 1024):
                        pass
        source.stdout.close()
        require(source.wait() == 0, 'No se pudo validar el archivo de adjuntos.')
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('inspect')
    sub.add_parser('check')
    deploy = sub.add_parser('deploy')
    deploy.add_argument('--sha', required=True, help='SHA completo revisado y probado')
    args = parser.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / 'deploy.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'check':
            check()
            return
        before, target = preflight()
        print(f'ACTUAL={before}\nCANDIDATO={target}', flush=True)
        if args.action == 'inspect':
            print(git('log', '--oneline', f'{before}..{target}'))
            print(git('diff', '--stat', before, target))
            return
        require(re.fullmatch('[0-9a-f]{40}', args.sha) and args.sha == target,
                'El candidato cambió o el SHA no es completo: vuelve a revisar.')
        if before == target:
            print('Sin novedades en main.', flush=True)
            check()
            return
        env_lines = (REPO / '.env').read_text().splitlines()
        domains = [line.split('=', 1)[1].strip().strip('\"\'') for line in env_lines if line.startswith('PPM_DOMAIN=')]
        require(domains == [DOMAIN], 'Dominio distinto: revisa la guía antes de adaptar la skill.')
        record = {'before': before, 'target': target, 'started_utc': datetime.now(timezone.utc).isoformat()}
        record_path = STATE / f'{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{target[:12]}.json'
        def save(stage):
            record['stage'] = stage
            record_path.write_text(json.dumps(record, indent=2) + '\n')
        save('preflight')
        record['backups'] = backup()
        save('backed_up')
        for service in ('api', 'web'):
            cid = run(COMPOSE + ['ps', '-q', service])
            require(bool(cid), f'Falta el contenedor previo {service}.')
            image = run(DOCKER + ['inspect', '--format', '{{.Image}}', cid])
            run(DOCKER + ['tag', image, f'ppm-rollback-{service}:{before[:12]}'])
        # Actualiza al SHA aprobado, aunque el remoto avance después del preflight.
        git('merge', '--ff-only', target)
        require(git('rev-parse', 'HEAD') == target, 'Main cambió: vuelve a revisar antes de construir.')
        save('building')
        run(COMPOSE + ['up', '-d', '--build'], capture=False)
        save('verifying')
        record['health'] = check()
        save('complete')
        print(f'DESPLEGADO={target}\nREGISTRO={record_path}', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as error:
        print(f'DETENIDO: {error}', file=sys.stderr)
        sys.exit(1)

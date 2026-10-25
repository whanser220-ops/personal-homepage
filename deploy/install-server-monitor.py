#!/usr/bin/env python3
"""Root-only, transactional installation. Never print credential contents."""
from pathlib import Path
import grp
import json
import os
import pwd
import secrets
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent.parent
BACKUP = Path('/var/lib/personal-homepage-monitor-deployment')
STATE = Path('/var/lib/personal-homepage-monitor')
WEB_ENV = Path('/etc/personal-homepage-monitor/web.env')
COLLECTOR_ENV = Path('/etc/personal-homepage-monitor.env')
UNITS = ['personal-homepage-monitor.service', 'personal-homepage-monitor-proxy.socket', 'personal-homepage-monitor-proxy.service']
TARGETS = [WEB_ENV, COLLECTOR_ENV, Path('/opt/personal-homepage-monitor/collector.py'), *[Path('/etc/systemd/system') / name for name in UNITS]]


def run(*args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=30)


def write(path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Create with private permissions before writing any secret. Atomic replace
    # also leaves the previous complete file intact on a failed write.
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(value.encode() if isinstance(value, str) else value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def read_env(path):
    if not path.exists():
        return {}
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if line and not line.startswith('#') and '=' in line)


def prepare():
    if BACKUP.exists():
        raise RuntimeError('Unfinished monitor deployment: roll back before retrying')
    BACKUP.mkdir(mode=0o700)
    metadata = {'files': [], 'units': {}}
    try:
        for index, target in enumerate(TARGETS):
            exists = target.exists()
            metadata['files'].append({'path': str(target), 'exists': exists, 'mode': target.stat().st_mode & 0o777 if exists else None})
            if exists:
                shutil.copy2(target, BACKUP / str(index))
                (BACKUP / str(index)).chmod(0o600)
        for unit in UNITS:
            enabled = run('systemctl', 'is-enabled', unit, check=False).stdout.strip()
            metadata['units'][unit] = {'active': run('systemctl', 'is-active', unit, check=False).returncode == 0,
                                       # Static proxy.service is started by its
                                       # socket and must never be enabled itself.
                                       'enabled': enabled in ('enabled', 'enabled-runtime')}
        write(BACKUP / 'metadata.json', json.dumps(metadata))
    except Exception:
        # No target has changed yet; do not leave an incomplete transaction
        # directory that blocks every subsequent deployment.
        shutil.rmtree(BACKUP)
        raise
    try:
        install_runtime()
    except Exception:
        rollback()
        raise


def install_runtime():
    try:
        user = pwd.getpwnam('server-monitor')
    except KeyError:
        run('useradd', '--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', 'server-monitor')
        user = pwd.getpwnam('server-monitor')
    grp.getgrnam('docker')
    STATE.mkdir(mode=0o700, exist_ok=True)
    STATE.chmod(0o700)
    os.chown(STATE, user.pw_uid, user.pw_gid)
    (WEB_ENV.parent).mkdir(mode=0o700, exist_ok=True)
    WEB_ENV.parent.chmod(0o700)
    google = json.loads(Path('/etc/study-agent/auth/google-oauth.json').read_text())
    if not google.get('clientId') or not google.get('clientSecret'):
        raise RuntimeError('Existing Google OAuth application is not configured')
    network = json.loads(run('docker', 'network', 'inspect', 'personal-homepage-net').stdout)[0]
    gateway = next(item['Gateway'] for item in network['IPAM']['Config'] if '.' in item.get('Gateway', ''))
    previous_values = read_env(WEB_ENV)
    token = previous_values.get('MONITOR_INGEST_TOKEN') or secrets.token_urlsafe(48)
    # Preserve the independent metrics backend across normal website releases.
    # The Prometheus installer changes these only after shadow verification.
    values = {key: value for key, value in previous_values.items() if key in (
        'MONITOR_DATA_BACKEND', 'MONITOR_PROMETHEUS_URL', 'MONITOR_PROMETHEUS_CUTOVER_AT')}
    values.update({'MONITOR_INGEST_TOKEN': token, 'MONITOR_GOOGLE_CLIENT_ID': google['clientId'],
              'MONITOR_GOOGLE_CLIENT_SECRET': google['clientSecret'], 'MONITOR_OWNER_EMAIL': 'whanser220@gmail.com',
              'MONITOR_PUBLIC_URL': 'https://warmhanser.com', 'MONITOR_OAUTH_PROXY_URL': f'http://{gateway}:17891'})
    if any('\n' in value or '\r' in value for value in values.values()):
        raise RuntimeError('Invalid multiline credential')
    write(WEB_ENV, ''.join(f'{key}={value}\n' for key, value in values.items()))
    write(COLLECTOR_ENV, f'MONITOR_INGEST_TOKEN={token}\nMONITOR_INGEST_URL=http://127.0.0.1:3000/api/monitor/ingest\nMONITOR_HOST_ID=cloud-primary\nMONITOR_STATE_DIR={STATE}\n')
    if values.get('MONITOR_DATA_BACKEND') != 'prometheus':
        write(Path('/opt/personal-homepage-monitor/collector.py'), (REPO / 'services/server-monitor/collector.py').read_text(), 0o644)
        write(Path('/etc/systemd/system/personal-homepage-monitor.service'), (REPO / 'services/server-monitor/personal-homepage-monitor.service').read_text(), 0o644)
    write(Path('/etc/systemd/system/personal-homepage-monitor-proxy.socket'), f'[Unit]\nDescription=Private OAuth proxy relay for the website\nRequires=docker.service\nAfter=docker.service\n\n[Socket]\nListenStream={gateway}:17891\nAccept=no\n\n[Install]\nWantedBy=sockets.target\n', 0o644)
    write(Path('/etc/systemd/system/personal-homepage-monitor-proxy.service'), '[Unit]\nDescription=Forward website OAuth traffic to the existing loopback proxy\nRequires=personal-homepage-monitor-proxy.socket\nAfter=personal-homepage-monitor-proxy.socket\n\n[Service]\nExecStart=/usr/lib/systemd/systemd-socket-proxyd --connections-max=32 127.0.0.1:17890\nDynamicUser=yes\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\n', 0o644)
    run('systemctl', 'daemon-reload')


def activate():
    if not (BACKUP / 'metadata.json').exists():
        raise RuntimeError('Monitor activation requires a prepared deployment')
    # An already-active socket retains its old listener after daemon-reload.
    run('systemctl', 'stop', 'personal-homepage-monitor-proxy.service', 'personal-homepage-monitor-proxy.socket')
    run('systemctl', 'enable', '--now', 'personal-homepage-monitor-proxy.socket')
    if read_env(WEB_ENV).get('MONITOR_DATA_BACKEND') != 'prometheus':
        run('systemctl', 'enable', 'personal-homepage-monitor.service')
        run('systemctl', 'restart', 'personal-homepage-monitor.service')


def rollback():
    if not (BACKUP / 'metadata.json').exists():
        return
    metadata = json.loads((BACKUP / 'metadata.json').read_text())
    for unit in UNITS:
        run('systemctl', 'stop', unit, check=False)
        if not metadata['units'][unit]['enabled']:
            run('systemctl', 'disable', unit, check=False)
    for index, item in enumerate(metadata['files']):
        target = Path(item['path'])
        if item['exists']:
            target.parent.mkdir(parents=True, exist_ok=True)
            write(target, (BACKUP / str(index)).read_bytes(), item['mode'])
        elif target == WEB_ENV:
            # The previous website ignores these variables; Compose still
            # needs the env file when restoring its previous image.
            write(target, '# Monitor installation rolled back\n')
        else:
            target.unlink(missing_ok=True)
    run('systemctl', 'daemon-reload')
    for unit in UNITS:
        if metadata['units'][unit]['enabled']:
            run('systemctl', 'enable', unit)
        if metadata['units'][unit]['active']:
            run('systemctl', 'start', unit)
    shutil.rmtree(BACKUP)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action == 'prepare':
        prepare()
    elif action == 'activate':
        activate()
    elif action == 'rollback':
        rollback()
    elif action == 'commit':
        if BACKUP.exists():
            shutil.rmtree(BACKUP)
    else:
        raise RuntimeError('Expected prepare, activate, rollback or commit')


if __name__ == '__main__':
    try:
        main()
        print('Monitor installation step completed')
    except Exception as error:
        # CalledProcessError may include secrets in command output: never print it.
        print(f'Monitor installation failed ({type(error).__name__})', file=sys.stderr)
        sys.exit(1)

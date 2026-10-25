#!/usr/bin/env python3
"""Install a pinned, independent Prometheus with shadow validation and rollback.

The only web.env change happens in cutover. shadow never switches website
readers or stops the legacy collector. No credential is printed.
"""
from datetime import datetime, timezone
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parent.parent
VERSION = '3.13.5'
SHA256 = '0388822ace519c5a3a8ef556a541ce1b536e21d872f82deded465bd27a5a0699'
ROOT = Path('/opt/personal-homepage-prometheus')
ARCHIVE = ROOT / f'downloads/prometheus-{VERSION}.linux-amd64.tar.gz'
RELEASE = ROOT / f'releases/{VERSION}'
CONFIG = Path('/etc/personal-homepage-prometheus/prometheus.yml')
RULES = Path('/etc/personal-homepage-prometheus/node-host.rules.yml')
HTTP_RULES = Path('/etc/personal-homepage-prometheus/http-sre.rules.yml')
STATE = Path('/var/lib/personal-homepage-prometheus')
BACKUP = Path('/var/lib/personal-homepage-prometheus-deployment')
WEB_ENV = Path('/etc/personal-homepage-monitor/web.env')
LEGACY = 'personal-homepage-monitor.service'
EXPORTER = 'personal-homepage-monitor-exporter.service'
PROMETHEUS = 'personal-homepage-prometheus.service'
SOCKET = 'personal-homepage-prometheus-proxy.socket'
PROXY = 'personal-homepage-prometheus-proxy.service'
UNITS = [PROMETHEUS, SOCKET, PROXY]
TARGETS = [WEB_ENV, CONFIG, RULES, HTTP_RULES,
           *[Path('/etc/systemd/system') / name for name in UNITS]]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def run(*args, check=True, timeout=30):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=timeout)


def write(path, value, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
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
    return dict(line.split('=', 1) for line in path.read_text().splitlines()
                if line and not line.startswith('#') and '=' in line) if path.exists() else {}


def standard_exporters():
    spec = importlib.util.spec_from_file_location('monitor_standard_exporters_install',
                                                  Path(__file__).with_name('install-monitor-exporters.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unit_state(unit):
    return {'active': run('systemctl', 'is-active', unit, check=False).returncode == 0,
            'enabled': run('systemctl', 'is-enabled', unit, check=False).stdout.strip() in ('enabled', 'enabled-runtime')}


def network_gateway():
    network = json.loads(run('docker', 'network', 'inspect', 'personal-homepage-net').stdout)[0]
    gateway = next(item['Gateway'] for item in network['IPAM']['Config'] if '.' in item.get('Gateway', ''))
    address = ipaddress.ip_address(gateway)
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified:
        raise RuntimeError('Expected a private Docker IPv4 gateway')
    return gateway


def snapshot():
    if BACKUP.exists():
        raise RuntimeError('Unfinished Prometheus transaction: inspect and rollback before retrying')
    BACKUP.mkdir(mode=0o700)
    try:
        metadata = {'files': [], 'units': {unit: unit_state(unit) for unit in [*UNITS, LEGACY]}}
        for index, target in enumerate(TARGETS):
            exists = target.exists()
            metadata['files'].append({'path': str(target), 'exists': exists,
                                      'mode': target.stat().st_mode & 0o777 if exists else None})
            if exists:
                shutil.copy2(target, BACKUP / str(index))
                (BACKUP / str(index)).chmod(0o600)
        write(BACKUP / 'metadata.json', json.dumps(metadata), 0o600)
    except Exception:
        shutil.rmtree(BACKUP)
        raise


def install_binaries():
    if platform.machine() not in ('x86_64', 'AMD64'):
        raise RuntimeError('Pinned archive requires Linux amd64')
    if not ARCHIVE.exists():
        raise RuntimeError(f'Stage the SHA-verified official release archive at {ARCHIVE}')
    digest = hashlib.sha256()
    with ARCHIVE.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != SHA256:
        raise RuntimeError('Prometheus archive checksum mismatch')
    # Extract exactly two known regular files; do not unpack archive paths,
    # links, credentials, or any packaged example into the host filesystem.
    with tarfile.open(ARCHIVE, 'r:gz') as archive:
        for name in ('prometheus', 'promtool'):
            member = archive.getmember(f'prometheus-{VERSION}.linux-amd64/{name}')
            if not member.isfile() or not 0 < member.size <= 256 * 1024 * 1024:
                raise RuntimeError('Unexpected Prometheus archive member')
            target = RELEASE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=f'.{name}.', dir=target.parent)
            try:
                with os.fdopen(fd, 'wb') as output, archive.extractfile(member) as source:
                    os.fchmod(output.fileno(), 0o755)
                    shutil.copyfileobj(source, output, 1024 * 1024)
                    output.flush()
                    os.fsync(output.fileno())
                def digest_file(path):
                    digest = hashlib.sha256()
                    with path.open('rb') as source:
                        for chunk in iter(lambda: source.read(1024 * 1024), b''):
                            digest.update(chunk)
                    return digest.digest()
                if not target.exists() or digest_file(target) != digest_file(Path(temporary)):
                    os.replace(temporary, target)
            finally:
                Path(temporary).unlink(missing_ok=True)
    run(str(RELEASE / 'prometheus'), '--version')


def install_runtime():
    install_binaries()
    try:
        user = pwd.getpwnam('prometheus-monitor')
    except KeyError:
        run('useradd', '--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', 'prometheus-monitor')
        user = pwd.getpwnam('prometheus-monitor')
    STATE.mkdir(mode=0o700, exist_ok=True)
    STATE.chmod(0o700)
    os.chown(STATE, user.pw_uid, user.pw_gid)
    standard = standard_exporters()
    sources = {
        CONFIG: standard.render_prometheus().encode(),
        RULES: standard.render_rules().encode(),
        HTTP_RULES: (REPO / 'services/server-monitor/http-sre.rules.yml').read_bytes(),
        Path('/etc/systemd/system') / PROMETHEUS: (REPO / 'services/server-monitor' / PROMETHEUS).read_bytes(),
    }
    gateway = network_gateway()
    sources[Path('/etc/systemd/system') / SOCKET] = (
        '[Unit]\nDescription=Private website Prometheus query relay\nRequires=docker.service\nAfter=docker.service\n\n'
        f'[Socket]\nListenStream={gateway}:19091\nAccept=no\n\n[Install]\nWantedBy=sockets.target\n').encode()
    sources[Path('/etc/systemd/system') / PROXY] = (
        '[Unit]\nDescription=Forward private website queries to loopback Prometheus\n'
        f'Requires={SOCKET}\nAfter={SOCKET}\n\n[Service]\n'
        'ExecStart=/usr/lib/systemd/systemd-socket-proxyd --connections-max=32 127.0.0.1:19090\n'
        'DynamicUser=yes\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\n').encode()
    changed = {path for path, value in sources.items() if not path.exists() or path.read_bytes() != value}
    for path in changed:
        write(path, sources[path])
    run(str(RELEASE / 'promtool'), 'check', 'config', str(CONFIG))
    run(str(RELEASE / 'promtool'), 'check', 'rules', str(RULES))
    run(str(RELEASE / 'promtool'), 'check', 'rules', str(HTTP_RULES))
    run('systemctl', 'daemon-reload')
    unit_dir = Path('/etc/systemd/system')
    if any(path in changed for path in (unit_dir / SOCKET, unit_dir / PROXY)):
        run('systemctl', 'stop', PROXY, SOCKET, check=False)
    for unit in (PROMETHEUS, SOCKET):
        run('systemctl', 'enable', unit)
        content_changed = unit_dir / unit in changed
        if unit == PROMETHEUS:
            content_changed |= CONFIG in changed or RULES in changed
        # A website-only deployment must not interrupt ongoing collection.
        run('systemctl', 'restart' if content_changed else 'start', unit)


def query(expression, base='http://127.0.0.1:19090'):
    with OPENER.open(base + '/api/v1/query?' + urllib.parse.urlencode({'query': expression}), timeout=5) as response:
        value = json.load(response)
    if value.get('status') != 'success':
        raise RuntimeError('Prometheus query failed')
    return value['data']['result']


def verify():
    standard_exporters().verify('http://127.0.0.1:19090', relay=False)
    base = f'http://{network_gateway()}:19091'
    if not query('up{job="server-monitor-node"}', base):
        raise RuntimeError('Private website relay has no fresh metrics')


def prepare():
    # A manual prepare must satisfy the same isolated readiness prerequisite
    # as Jenkins, before a production file or service state is changed.
    standard_exporters().verify()
    snapshot()
    try:
        install_runtime()
        verify()
    except Exception:
        rollback()
        raise


def cutover():
    if not (BACKUP / 'metadata.json').exists():
        raise RuntimeError('Prometheus cutover requires a prepared transaction')
    verify()
    values = read_env(WEB_ENV)
    if not values.get('MONITOR_GOOGLE_CLIENT_ID'):
        raise RuntimeError('Preserve and configure existing Google login before cutover')
    previous_backend = values.get('MONITOR_DATA_BACKEND', 'postgres')
    values.update({'MONITOR_DATA_BACKEND': 'prometheus', 'MONITOR_EXPORTER_MODE': 'standard',
                   'MONITOR_PROMETHEUS_URL': f'http://{network_gateway()}:19091'})
    if previous_backend != 'prometheus' or not values.get('MONITOR_PROMETHEUS_CUTOVER_AT'):
        values['MONITOR_PROMETHEUS_CUTOVER_AT'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    write(WEB_ENV, ''.join(f'{key}={value}\n' for key, value in values.items()), 0o600)


def finalize():
    if read_env(WEB_ENV).get('MONITOR_DATA_BACKEND') != 'prometheus':
        raise RuntimeError('Website must switch to Prometheus before retiring legacy collector')
    verify()
    run('systemctl', 'disable', '--now', LEGACY)


def commit():
    if BACKUP.exists():
        shutil.rmtree(BACKUP)


def rollback():
    if not (BACKUP / 'metadata.json').exists():
        return
    metadata = json.loads((BACKUP / 'metadata.json').read_text())
    for unit in UNITS:
        run('systemctl', 'stop', unit, check=False)
        if not metadata['units'][unit]['enabled']:
            run('systemctl', 'disable', unit, check=False)
    for index, item in enumerate(metadata['files']):
        path = Path(item['path'])
        if item['exists']:
            write(path, (BACKUP / str(index)).read_bytes(), item['mode'])
        else:
            path.unlink(missing_ok=True)
    run('systemctl', 'daemon-reload')
    # Data directories, release binaries, queues, and PostgreSQL history are
    # intentionally retained. Restore the exact pre-transaction service state.
    for unit, state in metadata['units'].items():
        run('systemctl', 'enable' if state['enabled'] else 'disable', unit, check=False)
        run('systemctl', 'start' if state['active'] else 'stop', unit, check=False)
    shutil.rmtree(BACKUP)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action == 'shadow':
        # Backward-compatible entry point: validate through a separate
        # Prometheus instead of changing the running production configuration.
        standard = standard_exporters()
        standard.prepare()
        standard.commit()
    elif action == 'prepare':
        prepare()
    elif action == 'verify':
        verify()
    elif action == 'cutover':
        cutover()
    elif action == 'finalize':
        finalize()
    elif action == 'rollback':
        rollback()
    elif action == 'commit':
        commit()
    else:
        raise RuntimeError('Expected shadow, prepare, verify, cutover, finalize, rollback or commit')


if __name__ == '__main__':
    try:
        main()
        print('Prometheus installation step completed')
    except Exception as error:
        print(f'Prometheus installation failed ({type(error).__name__})', file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Transactional native log exporter; does not alter Nginx or website access.

The Nginx/Grafana transaction owns the four-field privacy log and its rotation.
This transaction never truncates, replays, removes, or changes that log.
Stage the immutable upstream archive before invoking prepare.
"""
import hashlib
import os
from pathlib import Path
import platform
import pwd
import re
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import json

REPO = Path(__file__).resolve().parent.parent
VERSION = '1.11.0'
SHA256 = 'ab640b73b7e22d1f46197a98c3a06c548d66f9e3fb36b9437011997643569aa6'
ROOT = Path('/opt/personal-homepage-prometheus')
ARCHIVE = ROOT / f'downloads/prometheus-nginxlog-exporter_{VERSION}_linux_amd64.tar.gz'
BINARY = ROOT / f'exporters/nginxlog_exporter-{VERSION}/prometheus-nginxlog-exporter'
CONFIG = Path('/etc/personal-homepage-prometheus/http-log-exporter.yml')
LOG = Path('/var/log/personal-homepage-monitor/traffic.jsonl')
UNIT = 'personal-homepage-http-metrics.service'
UNIT_FILE = Path('/etc/systemd/system') / UNIT
BACKUP = Path('/var/lib/personal-homepage-http-metrics-deployment')
TARGETS = [CONFIG, UNIT_FILE]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def run(*args, check=True, timeout=20):
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


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def unit_state():
    return {'active': run('systemctl', 'is-active', UNIT, check=False).returncode == 0,
            'enabled': run('systemctl', 'is-enabled', UNIT, check=False).stdout.strip() in ('enabled', 'enabled-runtime')}


def check_privacy_log():
    group = pwd.getpwnam('www-data').pw_gid
    if LOG.is_symlink() or LOG.parent.is_symlink() or not LOG.is_file():
        raise RuntimeError('Create the regular privacy log in the Nginx transaction first')
    for path, expected in [(LOG.parent, 0o750), (LOG, 0o640)]:
        item = path.stat()
        if item.st_uid != 0 or item.st_gid != group or stat.S_IMODE(item.st_mode) != expected:
            raise RuntimeError('Privacy log must be root:www-data with directory 0750 and file 0640')


def check_port():
    if unit_state()['active']:
        return
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        try:
            listener.bind(('127.0.0.1', 19111))
        except OSError as error:
            raise RuntimeError('Private HTTP metrics port 19111 is already occupied') from error


def install_binary():
    if platform.machine() not in ('x86_64', 'AMD64'):
        raise RuntimeError('Pinned HTTP exporter requires Linux amd64')
    if not ARCHIVE.is_file() or digest(ARCHIVE) != SHA256:
        raise RuntimeError('Missing or invalid pinned HTTP exporter archive')
    with tarfile.open(ARCHIVE, 'r:gz') as archive:
        member = archive.getmember('prometheus-nginxlog-exporter')
        if not member.isfile() or not 0 < member.size <= 64 * 1024 * 1024:
            raise RuntimeError('Invalid HTTP exporter archive member')
        with archive.extractfile(member) as stream:
            content = stream.read(64 * 1024 * 1024 + 1)
        if not content.startswith(b'\x7fELF') or len(content) != member.size:
            raise RuntimeError('Invalid HTTP exporter ELF binary')
    changed = not BINARY.exists() or hashlib.sha256(content).hexdigest() != digest(BINARY)
    if changed:
        write(BINARY, content, 0o755)
    run(str(BINARY), '-version')
    return changed


def snapshot():
    if BACKUP.exists():
        raise RuntimeError('Unfinished HTTP metrics transaction requires rollback')
    BACKUP.mkdir(mode=0o700)
    try:
        metadata = {'files': [], 'unit': unit_state()}
        for index, path in enumerate(TARGETS):
            exists = path.exists()
            metadata['files'].append({'path': str(path), 'exists': exists,
                                      'mode': stat.S_IMODE(path.stat().st_mode) if exists else None})
            if exists:
                shutil.copy2(path, BACKUP / str(index))
                (BACKUP / str(index)).chmod(0o600)
        write(BACKUP / 'metadata.json', json.dumps(metadata), 0o600)
    except Exception:
        shutil.rmtree(BACKUP)
        raise


def install_runtime():
    changed = install_binary()
    try:
        pwd.getpwnam('monitor-http')
    except KeyError:
        run('useradd', '--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', 'monitor-http')
    sources = {CONFIG: (REPO / 'services/server-monitor/http-log-exporter.yml').read_bytes(),
               UNIT_FILE: (REPO / 'services/server-monitor' / UNIT).read_bytes()}
    for path, value in sources.items():
        if not path.exists() or path.read_bytes() != value:
            write(path, value)
            changed = True
    run(str(BINARY), '-config-file', str(CONFIG), '-verify-config')
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', UNIT)
    run('systemctl', 'restart' if changed else 'start', UNIT)


def validate_metrics(payload):
    # Only parse health is required before real traffic. Never seed a fake HTTP
    # request or turn no requests into proof of a healthy application.
    if len(payload) > 1024 * 1024:
        raise RuntimeError('HTTP exporter response exceeds its bound')
    text = payload.decode('utf-8')
    rows = re.findall(r'^server_monitor_ingress_parse_errors_total\s+([^\s]+)$', text, re.M)
    if len(rows) != 1 or float(rows[0]) != 0:
        raise RuntimeError('HTTP exporter privacy log parser is missing or has errors')
    return text


def verify():
    failure = None
    for attempt in range(10):
        try:
            if not unit_state()['active']:
                raise RuntimeError('HTTP exporter service is inactive')
            with OPENER.open('http://127.0.0.1:19111/metrics', timeout=3) as response:
                validate_metrics(response.read(1024 * 1024 + 1))
            return
        except (OSError, ValueError, RuntimeError) as error:
            failure = error
            if attempt != 9:
                time.sleep(1)
    raise RuntimeError('Private HTTP exporter readiness failed') from failure


def prepare():
    check_privacy_log()
    check_port()
    snapshot()
    try:
        install_runtime()
        verify()
    except Exception:
        rollback()
        raise


def commit():
    if BACKUP.exists():
        shutil.rmtree(BACKUP)


def rollback():
    if not (BACKUP / 'metadata.json').exists():
        return
    metadata = json.loads((BACKUP / 'metadata.json').read_text())
    run('systemctl', 'stop', UNIT, check=False)
    for index, item in enumerate(metadata['files']):
        path = Path(item['path'])
        if item['exists']:
            write(path, (BACKUP / str(index)).read_bytes(), item['mode'])
        else:
            path.unlink(missing_ok=True)
    run('systemctl', 'daemon-reload')
    previous = metadata['unit']
    run('systemctl', 'enable' if previous['enabled'] else 'disable', UNIT, check=False)
    if previous['active']:
        run('systemctl', 'start', UNIT)
    shutil.rmtree(BACKUP)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    actions = {'prepare': prepare, 'verify': verify, 'rollback': rollback, 'commit': commit}
    if action not in actions:
        raise RuntimeError('Expected prepare, verify, rollback or commit')
    actions[action]()


if __name__ == '__main__':
    try:
        main()
        print('Private HTTP metrics step completed')
    except Exception as error:
        # Never print subprocess output, log lines, environment or exceptions
        # from untrusted sources; the safe fixed operation/type is sufficient.
        detail = str(error)[:160] if isinstance(error, RuntimeError) else type(error).__name__
        print('Private HTTP metrics step failed: ' + detail, file=sys.stderr)
        sys.exit(1)

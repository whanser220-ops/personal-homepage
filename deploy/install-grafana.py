#!/usr/bin/env python3
"""Private, pinned Grafana and privacy-log preparation with bounded rollback.

prepare/shadow do not install or reload public Nginx routes. The website's
deployment transaction enables those routes only after its compiled auth gate.
"""
import configparser
from contextlib import closing
import hashlib
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import platform
import pwd
import grp
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

REPO = Path(__file__).resolve().parent.parent
ROOT = Path('/opt/personal-homepage-grafana')
VERSION = '13.2.4'
ARCHIVE = 'grafana_13.2.4_38252365904_linux_amd64.tar.gz'
SHA256 = 'c48765988fd88572607e4ea670251af8a8e64ab3e360d0f3cf67a6f3587b92ab'
SOURCE_URL = 'https://dl.grafana.com/grafana/release/13.2.4/' + ARCHIVE
RELEASE = ROOT / 'releases' / VERSION
CONFIG = Path('/etc/personal-homepage-grafana')
HISTORY_ENV = CONFIG / 'history.env'
STATE = Path('/var/lib/personal-homepage-grafana')
BACKUP = Path('/var/lib/personal-homepage-grafana-deployment')
LOG_DIR = Path('/var/log/personal-homepage-monitor')
LOG_FILE = LOG_DIR / 'traffic.jsonl'
LOGROTATE = CONFIG / 'traffic.logrotate'
UNIT = 'personal-homepage-grafana.service'
ROTATE = 'personal-homepage-monitor-logrotate.service'
TIMER = 'personal-homepage-monitor-logrotate.timer'
UNITS = [UNIT, ROTATE, TIMER]
DASHBOARDS = ('overview', 'trends', 'infrastructure')
OWNER = 'whanser220@gmail.com'
FILES = [CONFIG / 'grafana.ini', CONFIG / 'secrets.env',
         CONFIG / 'provisioning/datasources/prometheus.yml', CONFIG / 'provisioning/dashboards/monitor.yml',
         CONFIG / 'provisioning/datasources/history.yml',
         *[CONFIG / 'dashboards' / (name + '.json') for name in DASHBOARDS], LOGROTATE,
         *[Path('/etc/systemd/system') / name for name in UNITS]]


def run(*args, check=True, timeout=30):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=timeout)


def write(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data.encode() if isinstance(data, str) else data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def unit_state(unit):
    return {'active': run('systemctl', 'is-active', unit, check=False).returncode == 0,
            'enabled': run('systemctl', 'is-enabled', unit, check=False).stdout.strip() in ('enabled', 'enabled-runtime')}


def snapshot():
    if BACKUP.exists():
        raise RuntimeError('Grafana deployment transaction already exists')
    BACKUP.mkdir(mode=0o700, parents=True)
    try:
        snapshot_contents()
    except Exception:
        # No live files or units have changed before the complete manifest.
        shutil.rmtree(BACKUP)
        raise


def snapshot_contents():
    manifest = {'files': [], 'units': {name: unit_state(name) for name in UNITS}, 'database': False}
    for index, target in enumerate(FILES):
        entry = {'path': str(target), 'exists': target.exists()}
        if target.exists():
            if target.is_symlink() or not target.is_file():
                raise RuntimeError('Unexpected Grafana configuration file type')
            metadata = target.stat()
            entry.update(mode=metadata.st_mode & 0o777, uid=metadata.st_uid, gid=metadata.st_gid)
            shutil.copyfile(target, BACKUP / str(index))
        manifest['files'].append(entry)
    database = STATE / 'grafana.db'
    if database.exists():
        # SQLite's online backup includes committed WAL pages without a stop.
        deadline = time.monotonic() + 15
        def progress(_status, _remaining, _total):
            if time.monotonic() > deadline:
                raise RuntimeError('Grafana online database backup timed out')
        with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=5)) as source:
            with closing(sqlite3.connect(BACKUP / 'grafana.db', timeout=5)) as target:
                source.backup(target, pages=1000, sleep=.05, progress=progress)
        manifest['database'] = True
    write(BACKUP / 'manifest.json', json.dumps(manifest), 0o600)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def install_artifact():
    if platform.machine() not in ('x86_64', 'AMD64'):
        raise RuntimeError('Pinned Grafana requires amd64')
    archive = ROOT / 'downloads' / ARCHIVE
    if not archive.is_file() or digest(archive) != SHA256:
        raise RuntimeError('Missing or invalid pinned Grafana archive')
    marker = RELEASE / '.archive-sha256'
    if marker.is_file() and marker.read_text().strip() == SHA256 and (RELEASE / 'bin/grafana').is_file():
        return False
    if RELEASE.exists():
        raise RuntimeError('Unrecognized Grafana release directory')
    RELEASE.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.grafana-', dir=RELEASE.parent) as directory:
        temporary = Path(directory)
        with tarfile.open(archive, 'r:gz') as source:
            members = source.getmembers()
            if not members or len(members) > 100000 or sum(item.size for item in members) > 2 * 1024 ** 3:
                raise RuntimeError('Unexpected Grafana archive size')
            top = PurePosixPath(members[0].name).parts[0]
            for member in members:
                path = PurePosixPath(member.name)
                if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != top:
                    raise RuntimeError('Invalid Grafana archive path')
                if not (member.isfile() or member.isdir()):
                    raise RuntimeError('Grafana archive links and special files are not accepted')
                member.uid = member.gid = 0
                member.uname = member.gname = ''
                member.mode = 0o755 if member.isdir() or member.mode & 0o111 else 0o644
            source.extractall(temporary, members=members, filter='data')
        extracted = temporary / top
        if not (extracted / 'bin/grafana').is_file() or not (extracted / 'conf/defaults.ini').is_file() or not (extracted / 'public/build').is_dir():
            raise RuntimeError('Grafana archive is missing its runtime')
        write(extracted / '.archive-sha256', SHA256 + '\n')
        os.replace(extracted, RELEASE)
    return True


def prepare_privacy_log():
    web_group = grp.getgrnam('www-data').gr_gid
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if LOG_DIR.is_symlink() or LOG_FILE.is_symlink():
        raise RuntimeError('Privacy metric log must not be a symlink')
    os.chown(LOG_DIR, 0, web_group)
    LOG_DIR.chmod(0o750)
    descriptor = os.open(LOG_FILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o640)
    try:
        os.fchown(descriptor, 0, web_group)
        os.fchmod(descriptor, 0o640)
    finally:
        os.close(descriptor)
    write(LOGROTATE, (REPO / 'services/server-monitor/grafana/traffic.logrotate').read_bytes())
    run('/usr/sbin/logrotate', '--debug', str(LOGROTATE))


def history_address():
    if not HISTORY_ENV.exists():
        return None
    values = dict(line.split('=', 1) for line in HISTORY_ENV.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
    address = ipaddress.ip_address(values.get('MONITOR_HISTORY_HOST', ''))
    network = json.loads(run('docker', 'inspect', '--format', '{{json .NetworkSettings.Networks}}', 'personal-homepage-postgres').stdout)
    expected = network.get('personal-homepage-net', {}).get('IPAddress')
    if address.version != 4 or not address.is_private or address.is_loopback or str(address) != expected or values.get('MONITOR_HISTORY_PORT') != '5432':
        raise RuntimeError('Grafana history endpoint must match the private database container')
    return str(address)


def ensure_account():
    try:
        account = pwd.getpwnam('sre-grafana')
    except KeyError:
        # The history credential preparer may have created this group already.
        try:
            grp.getgrnam('sre-grafana')
        except KeyError:
            run('groupadd', '--system', 'sre-grafana')
        run('useradd', '--system', '--gid', 'sre-grafana', '--no-create-home', '--home-dir', str(STATE), '--shell', '/usr/sbin/nologin', 'sre-grafana')
        account = pwd.getpwnam('sre-grafana')
    return account


def install_runtime():
    account = ensure_account()
    changed = install_artifact()
    legacy_address = history_address()
    sources = {CONFIG / 'grafana.ini': REPO / 'services/server-monitor/grafana/grafana.ini',
               CONFIG / 'provisioning/datasources/prometheus.yml': REPO / 'services/server-monitor/grafana/provisioning/datasources/prometheus.yml',
               CONFIG / 'provisioning/dashboards/monitor.yml': REPO / 'services/server-monitor/grafana/provisioning/dashboards/monitor.yml',
               **{CONFIG / 'dashboards' / (name + '.json'): REPO / 'services/server-monitor/grafana/dashboards' / (name + '.json') for name in DASHBOARDS},
               **{Path('/etc/systemd/system') / unit: REPO / 'services/server-monitor' / unit for unit in UNITS}}
    for target, source in sources.items():
        data = source.read_bytes()
        if target.name == UNIT:
            data = data.replace(b'__HISTORY_ADDRESS_ALLOW__', ('IPAddressAllow=' + legacy_address if legacy_address else '').encode())
        if not target.exists() or target.read_bytes() != data:
            write(target, data)
            changed = True
    if legacy_address:
        history_source = REPO / 'services/server-monitor/grafana/provisioning/datasources/history.yml'
        history_target = CONFIG / 'provisioning/datasources/history.yml'
        data = history_source.read_bytes()
        if not history_target.exists() or history_target.read_bytes() != data:
            write(history_target, data)
            changed = True
        os.chown(HISTORY_ENV, 0, account.pw_gid)
        HISTORY_ENV.chmod(0o640)
    ini = configparser.ConfigParser(interpolation=None)
    ini.read(CONFIG / 'grafana.ini')
    if ini['server']['http_addr'] != '127.0.0.1' or ini['server']['http_port'] != '19110' or ini['auth.proxy']['whitelist'] != '127.0.0.1':
        raise RuntimeError('Grafana private binding and trust boundary are required')
    secret = CONFIG / 'secrets.env'
    if not secret.exists():
        write(secret, 'GF_SECURITY_SECRET_KEY=' + secrets.token_urlsafe(48) + '\n', 0o640)
    os.chown(secret, 0, account.pw_gid)
    secret.chmod(0o640)
    STATE.mkdir(parents=True, exist_ok=True)
    os.chown(STATE, account.pw_uid, account.pw_gid)
    STATE.chmod(0o750)
    prepare_privacy_log()
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', UNIT, TIMER)
    run('systemctl', 'restart' if changed or not unit_state(UNIT)['active'] else 'start', UNIT)
    run('systemctl', 'start', TIMER)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, location):
        return None


def request(path, authenticated=False, method='GET', data=None):
    headers = {'X-WEBAUTH-USER': OWNER, 'X-WEBAUTH-EMAIL': OWNER, 'X-WEBAUTH-ROLE': 'Viewer'} if authenticated else {}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request('http://127.0.0.1:19110/server-monitor/grafana' + path, headers=headers, method=method,
                                 data=json.dumps(data).encode() if data is not None else None)
    try:
        with opener.open(req, timeout=12) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, None


def verify():
    for attempt in range(60):
        try:
            status, health = request('/api/health')
            if status == 200 and health.get('database') == 'ok' and health.get('version') == VERSION:
                break
        except (OSError, ValueError):
            pass
        if attempt == 59:
            raise RuntimeError('Grafana did not become healthy')
        time.sleep(2)
    if request('/api/search')[0] != 401:
        raise RuntimeError('Anonymous Grafana APIs must be unavailable')
    status, owner = request('/api/user', True)
    if status != 200 or owner.get('email') != OWNER or owner.get('isGrafanaAdmin'):
        raise RuntimeError('Grafana proxy identity is not an unprivileged owner')
    status, organizations = request('/api/user/orgs', True)
    if status != 200 or not organizations or any(item.get('role') != 'Viewer' for item in organizations):
        raise RuntimeError('Grafana owner must remain Viewer')
    for name in DASHBOARDS:
        status, payload = request('/api/dashboards/uid/monitor-sre-' + name, True)
        if status != 200 or payload['dashboard']['uid'] != 'monitor-sre-' + name or payload['meta'].get('canSave'):
            raise RuntimeError('A provisioned read-only Grafana dashboard is missing')
    status, datasource = request('/api/datasources/uid/monitor-prometheus', True)
    if status != 200 or datasource.get('url') != 'http://127.0.0.1:19090' or datasource.get('readOnly') is not True:
        raise RuntimeError('Grafana datasource must be the private provisioned Prometheus')
    if HISTORY_ENV.exists():
        status, legacy = request('/api/datasources/uid/monitor-legacy-history', True)
        if status != 200 or legacy.get('readOnly') is not True or legacy.get('user') != 'monitor_grafana_history':
            raise RuntimeError('Grafana legacy history must use its dedicated read-only datasource')
        status, payload = request('/api/ds/query', True, 'POST', {'from':str(int((time.time()-7*86400)*1000)), 'to':str(int(time.time()*1000)),
            'queries':[{'refId':'L','datasource':{'type':'grafana-postgresql-datasource','uid':'monitor-legacy-history'},
                        'rawSql':'SELECT collected_at AS time, cpu_percent FROM public.monitor_grafana_resource_history ORDER BY collected_at DESC LIMIT 1',
                        'format':'time_series','intervalMs':3000,'maxDataPoints':1}]})
        if status != 200 or payload.get('results', {}).get('L', {}).get('error') or 'L' not in payload.get('results', {}):
            raise RuntimeError('Grafana cannot read its restricted legacy history view')
    status, payload = request('/api/ds/query', True, 'POST', {'from':str(int((time.time()-60)*1000)), 'to':str(int(time.time()*1000)),
        'queries':[{'refId':'A','datasource':{'type':'prometheus','uid':'monitor-prometheus'},'expr':'up{job="server-monitor-node"}',
                    'instant':True,'range':False,'format':'time_series','intervalMs':3000,'maxDataPoints':20}]})
    if status != 200 or payload.get('results', {}).get('A', {}).get('error') or not payload.get('results', {}).get('A', {}).get('frames'):
        raise RuntimeError('Grafana cannot query the private Prometheus')
    bindings = run('ss', '-lntH').stdout.splitlines()
    found = [line.split()[3] for line in bindings if line.split()[3].rpartition(':')[2] == '19110']
    if found != ['127.0.0.1:19110']:
        raise RuntimeError('Grafana must listen only on IPv4 loopback')
    print('Grafana private verification passed: pinned version, anonymous 401, owner Viewer, three dashboards, Prometheus query')


def rollback():
    manifest_path = BACKUP / 'manifest.json'
    if not manifest_path.exists():
        raise RuntimeError('Grafana rollback manifest is unavailable')
    manifest = json.loads(manifest_path.read_text())
    run('systemctl', 'stop', TIMER, UNIT, check=False)
    for index, entry in enumerate(manifest['files']):
        target = Path(entry['path'])
        if entry['exists']:
            write(target, (BACKUP / str(index)).read_bytes(), entry['mode'])
            os.chown(target, entry['uid'], entry['gid'])
        else:
            target.unlink(missing_ok=True)
    if manifest['database']:
        account = pwd.getpwnam('sre-grafana')
        for name in ('grafana.db-wal', 'grafana.db-shm'):
            (STATE / name).unlink(missing_ok=True)
        write(STATE / 'grafana.db', (BACKUP / 'grafana.db').read_bytes(), 0o640)
        os.chown(STATE / 'grafana.db', account.pw_uid, account.pw_gid)
    else:
        # Only remove the database initialized by this first failed install.
        # A pre-existing database always has an online backup above.
        for name in ('grafana.db', 'grafana.db-wal', 'grafana.db-shm'):
            (STATE / name).unlink(missing_ok=True)
    run('systemctl', 'daemon-reload')
    for unit, status in manifest['units'].items():
        run('systemctl', 'enable' if status['enabled'] else 'disable', unit, check=False)
        if status['active']:
            run('systemctl', 'start', unit)
    shutil.rmtree(BACKUP)


def prepare():
    # Reject invalid dashboard queries before snapshotting or restarting an
    # already-serving Grafana. The fixture reads the exact versioned JSON.
    validate_dashboards()
    snapshot()
    try:
        install_runtime()
        verify()
    except Exception:
        rollback()
        raise


def validate_dashboards():
    run(sys.executable, str(REPO / 'tests/verify_grafana_queries.py'), '--promtool',
        '/opt/personal-homepage-prometheus/releases/3.13.5/promtool', timeout=60)


def commit():
    if BACKUP.exists():
        shutil.rmtree(BACKUP)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root is required for Grafana installation')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action in ('prepare', 'shadow'):
        prepare()
        if action == 'shadow':
            commit()
    elif action == 'verify':
        verify()
    elif action == 'rollback':
        rollback()
    elif action == 'commit':
        commit()
    else:
        raise RuntimeError('Usage: install-grafana.py prepare|shadow|verify|rollback|commit')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Subprocess output and configuration may include private identities.
        print(f'Grafana installation failed ({type(error).__name__})', file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Transactional official exporters plus an isolated, private shadow Prometheus.

shadow/prepare never modify the production Prometheus, website environment,
or legacy Python service. Production switches through install-prometheus.py.
"""
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import platform
import pwd
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parent.parent
ROOT = Path('/opt/personal-homepage-prometheus')
CONFIG_ROOT = Path('/etc/personal-homepage-prometheus')
SHADOW_CONFIG = CONFIG_ROOT / 'shadow/prometheus.yml'
SHADOW_RULES = CONFIG_ROOT / 'shadow/node-host.rules.yml'
SHADOW_HTTP_RULES = CONFIG_ROOT / 'shadow/http-sre.rules.yml'
BLACKBOX_CONFIG = CONFIG_ROOT / 'blackbox.yml'
CUSTOM_PROGRAM = Path('/opt/personal-homepage-monitor/custom/exporter.py')
STATE = Path('/var/lib/personal-homepage-prometheus-shadow')
BACKUP = Path('/var/lib/personal-homepage-exporters-deployment')
WEB_ENV = Path('/etc/personal-homepage-monitor/web.env')
PROMTOOL = ROOT / 'releases/3.13.5/promtool'
OLD_EXPORTER = 'personal-homepage-monitor-exporter.service'
NODE = 'personal-homepage-node-exporter.service'
CADVISOR = 'personal-homepage-cadvisor.service'
BLACKBOX = 'personal-homepage-blackbox-exporter.service'
CUSTOM = 'personal-homepage-monitor-custom.service'
SHADOW = 'personal-homepage-prometheus-shadow.service'
SOCKET = 'personal-homepage-prometheus-shadow-proxy.socket'
PROXY = 'personal-homepage-prometheus-shadow-proxy.service'
UNITS = [NODE, CADVISOR, BLACKBOX, CUSTOM, SHADOW, SOCKET, PROXY]
TARGETS = [SHADOW_CONFIG, SHADOW_RULES, SHADOW_HTTP_RULES, BLACKBOX_CONFIG, CUSTOM_PROGRAM,
           *[Path('/etc/systemd/system') / unit for unit in UNITS]]
ARTIFACTS = {
    'node_exporter': {'version': '1.12.1', 'filename': 'node_exporter-1.12.1.linux-amd64.tar.gz',
                      'sha256': 'b51d8a76aa2a9156a55d501aca6276fae09e262259a5e4e831d2c2222f084e63',
                      'member': 'node_exporter-1.12.1.linux-amd64/node_exporter'},
    'blackbox_exporter': {'version': '0.29.1', 'filename': 'blackbox_exporter-0.29.1.linux-amd64.tar.gz',
                          'sha256': 'b82b81839e6317e84fdd367f46d7ddd3b773fa09cbe2e3d5633a59171d741e76',
                          'member': 'blackbox_exporter-0.29.1.linux-amd64/blackbox_exporter'},
    'cadvisor': {'version': '0.60.6', 'filename': 'cadvisor-v0.60.6-linux-amd64',
                 'sha256': 'c381c2c911bc43d465d1e0eaff60f96d58c031c409bddf06da0316fdde8a9296'},
}
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


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def unit_state(unit):
    return {'active': run('systemctl', 'is-active', unit, check=False).returncode == 0,
            'enabled': run('systemctl', 'is-enabled', unit, check=False).stdout.strip() in ('enabled', 'enabled-runtime')}


def gateway():
    network = json.loads(run('docker', 'network', 'inspect', 'personal-homepage-net').stdout)[0]
    value = next(item['Gateway'] for item in network['IPAM']['Config'] if '.' in item.get('Gateway', ''))
    address = ipaddress.ip_address(value)
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified:
        raise RuntimeError('Invalid private Docker gateway')
    return value


def host_devices():
    major_minor = run('findmnt', '-n', '-o', 'MAJ:MIN', '/').stdout.strip()
    if not re.fullmatch(r'\d+:\d+', major_minor):
        raise RuntimeError('Cannot identify the root block device')
    device = (Path('/sys/dev/block') / major_minor).resolve(strict=True).name
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', device) or not any(
            len(parts) >= 3 and parts[2] == device for parts in (line.split() for line in Path('/proc/diskstats').read_text().splitlines())):
        raise RuntimeError('Root diskstats device is not valid')
    routes = []
    for line in Path('/proc/net/route').read_text().splitlines()[1:]:
        fields = line.split()
        if len(fields) < 8 or fields[1] != '00000000' or not int(fields[3], 16) & 1:
            continue
        interface = fields[0]
        if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,64}', interface) or interface.startswith(('lo', 'docker', 'br-', 'veth', 'tun', 'tap', 'virbr')):
            continue
        if (Path('/sys/class/net') / interface).exists():
            routes.append((int(fields[6]), interface))
    if not routes:
        raise RuntimeError('Cannot identify the host default network interface')
    return device, min(routes)[1]


def render_rules():
    device, interface = host_devices()
    value = (REPO / 'services/server-monitor/node-host.rules.yml').read_text()
    value = value.replace('__ROOT_DEVICE__', device).replace('__NETWORK_INTERFACE__', interface)
    if re.search(r'__[A-Z_]+__', value):
        raise RuntimeError('Unresolved monitoring rule placeholder')
    return value


def render_prometheus(shadow=False):
    value = (REPO / 'services/server-monitor/prometheus.yml').read_text()
    if shadow:
        value = value.replace((CONFIG_ROOT / 'node-host.rules.yml').as_posix(), SHADOW_RULES.as_posix())
        value = value.replace((CONFIG_ROOT / 'http-sre.rules.yml').as_posix(), SHADOW_HTTP_RULES.as_posix())
    return value


def render_unit(unit):
    value = (REPO / 'services/server-monitor' / unit).read_text()
    if '__ROOT_DEVICE__' in value:
        value = value.replace('__ROOT_DEVICE__', host_devices()[0])
    if re.search(r'__[A-Z_]+__', value):
        raise RuntimeError('Unresolved exporter unit placeholder')
    return value


def validate_rule_fixture():
    # Numeric regression inputs deliberately use fixed synthetic device names.
    # Test the template separately from this host's discovered device selection.
    with tempfile.TemporaryDirectory(prefix='monitor-node-rules-') as temporary:
        root = Path(temporary)
        rules = (REPO / 'services/server-monitor/node-host.rules.yml').read_text()
        (root / 'node-host.rules.yml').write_text(rules.replace('__ROOT_DEVICE__', 'vda1').replace('__NETWORK_INTERFACE__', 'eth0'))
        shutil.copyfile(REPO / 'tests/monitor-node-rules.test.yml', root / 'monitor-node-rules.test.yml')
        subprocess.run([str(PROMTOOL), 'test', 'rules', 'monitor-node-rules.test.yml'], cwd=root,
                       check=True, capture_output=True, text=True, timeout=30)
        shutil.copyfile(REPO / 'services/server-monitor/http-sre.rules.yml', root / 'http-sre.rules.yml')
        shutil.copyfile(REPO / 'tests/monitor-http-sre-rules.test.yml', root / 'monitor-http-sre-rules.test.yml')
        subprocess.run([str(PROMTOOL), 'test', 'rules', 'monitor-http-sre-rules.test.yml'], cwd=root,
                       check=True, capture_output=True, text=True, timeout=30)
        # Generated by the exact candidate source inside the target Node image.
        # Empty/stale recorded frames and weighted service aggregation are tested
        # before any production configuration or website reader changes.
        shutil.copyfile(REPO / '.ci/monitor-signals-queries.json', root / 'monitor-signals-queries.json')
        subprocess.run([str(PROMTOOL), 'test', 'rules', 'monitor-signals-queries.json'], cwd=root,
                       check=True, capture_output=True, text=True, timeout=60)


def install_artifacts():
    if platform.machine() not in ('x86_64', 'AMD64'):
        raise RuntimeError('Pinned official exporters require amd64')
    changed = set()
    for name, artifact in ARTIFACTS.items():
        source = ROOT / 'downloads' / artifact['filename']
        if not source.exists() or digest(source) != artifact['sha256']:
            raise RuntimeError('Missing or invalid pinned exporter artifact: ' + name)
        target = ROOT / 'exporters' / f"{name}-{artifact['version']}" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.' + name, dir=target.parent)
        try:
            with os.fdopen(fd, 'wb') as output:
                os.fchmod(output.fileno(), 0o755)
                if 'member' in artifact:
                    with tarfile.open(source, 'r:gz') as archive:
                        member = archive.getmember(artifact['member'])
                        if not member.isfile() or not 0 < member.size <= 128 * 1024 * 1024:
                            raise RuntimeError('Invalid exporter archive member')
                        with archive.extractfile(member) as stream:
                            shutil.copyfileobj(stream, output, 1024 * 1024)
                else:
                    with source.open('rb') as stream:
                        if stream.read(4) != b'\x7fELF':
                            raise RuntimeError('Invalid cAdvisor ELF binary')
                        stream.seek(0)
                        shutil.copyfileobj(stream, output, 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
            if not target.exists() or digest(target) != digest(Path(temporary)):
                os.replace(temporary, target)
                changed.add(name)
        finally:
            Path(temporary).unlink(missing_ok=True)
        run(str(target), '--version')
    return changed


def snapshot():
    if BACKUP.exists():
        raise RuntimeError('Unfinished exporter transaction requires inspection and rollback')
    BACKUP.mkdir(mode=0o700)
    try:
        metadata = {'files': [], 'units': {unit: unit_state(unit) for unit in [*UNITS, OLD_EXPORTER]}}
        for index, path in enumerate(TARGETS):
            exists = path.exists()
            metadata['files'].append({'path': str(path), 'exists': exists, 'mode': path.stat().st_mode & 0o777 if exists else None})
            if exists:
                shutil.copy2(path, BACKUP / str(index))
                (BACKUP / str(index)).chmod(0o600)
        write(BACKUP / 'metadata.json', json.dumps(metadata), 0o600)
    except Exception:
        shutil.rmtree(BACKUP)
        raise


def install_runtime():
    binaries = install_artifacts()
    user = pwd.getpwnam('prometheus-monitor')
    for name in ('monitor-node', 'monitor-blackbox'):
        try:
            pwd.getpwnam(name)
        except KeyError:
            run('useradd', '--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', name)
    STATE.mkdir(mode=0o700, exist_ok=True)
    STATE.chmod(0o700)
    os.chown(STATE, user.pw_uid, user.pw_gid)
    http_codes = ', '.join(str(code) for code in [*range(200, 400), 401, 403])
    sources = {
        SHADOW_CONFIG: render_prometheus(shadow=True), SHADOW_RULES: render_rules(),
        SHADOW_HTTP_RULES: (REPO / 'services/server-monitor/http-sre.rules.yml').read_text(),
        BLACKBOX_CONFIG: (REPO / 'services/server-monitor/blackbox.yml').read_text().replace('__VALID_HTTP_STATUS_CODES__', http_codes),
        CUSTOM_PROGRAM: (REPO / 'services/server-monitor/exporter.py').read_text(),
    }
    unit_dir = Path('/etc/systemd/system')
    for unit in (NODE, CADVISOR, BLACKBOX, CUSTOM, SHADOW):
        sources[unit_dir / unit] = render_unit(unit)
    sources[unit_dir / SOCKET] = ('[Unit]\nDescription=Private candidate Prometheus relay\nRequires=docker.service\nAfter=docker.service\n\n'
        f'[Socket]\nListenStream={gateway()}:19095\nAccept=no\n\n[Install]\nWantedBy=sockets.target\n')
    sources[unit_dir / PROXY] = ('[Unit]\nDescription=Forward candidate queries to shadow Prometheus\n'
        f'Requires={SOCKET}\nAfter={SOCKET}\n\n[Service]\n'
        'ExecStart=/usr/lib/systemd/systemd-socket-proxyd --connections-max=24 127.0.0.1:19094\n'
        'DynamicUser=yes\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\n')
    changed = {path for path, value in sources.items() if not path.exists() or path.read_text() != value}
    for path in changed:
        write(path, sources[path])
    run(str(PROMTOOL), 'check', 'config', str(SHADOW_CONFIG))
    run(str(PROMTOOL), 'check', 'rules', str(SHADOW_RULES))
    run(str(PROMTOOL), 'check', 'rules', str(SHADOW_HTTP_RULES))
    validate_rule_fixture()
    run('systemctl', 'daemon-reload')
    if any(unit_dir / unit in changed for unit in (SOCKET, PROXY)):
        run('systemctl', 'stop', PROXY, SOCKET, check=False)
    binary_units = {NODE: 'node_exporter', CADVISOR: 'cadvisor', BLACKBOX: 'blackbox_exporter'}
    for unit in (NODE, CADVISOR, BLACKBOX, CUSTOM, SHADOW, SOCKET):
        run('systemctl', 'enable', unit)
        modified = unit_dir / unit in changed or binary_units.get(unit) in binaries
        modified |= unit == BLACKBOX and BLACKBOX_CONFIG in changed
        modified |= unit == CUSTOM and CUSTOM_PROGRAM in changed
        modified |= unit == SHADOW and bool({SHADOW_CONFIG, SHADOW_RULES, SHADOW_HTTP_RULES} & changed)
        run('systemctl', 'restart' if modified else 'start', unit)


def query(expression, base='http://127.0.0.1:19094'):
    with OPENER.open(base + '/api/v1/query?' + urllib.parse.urlencode({'query': expression}), timeout=8) as response:
        value = json.load(response)
    if value.get('status') != 'success':
        raise RuntimeError('Exporter Prometheus query failed')
    return value['data']['result']


def frame_expression(metric, job, *, source=None, dimensions='host_id'):
    selector = metric + '{job="' + job + '",host_id="cloud-primary"}'
    reference = (source or 'up') + '{job="' + job + '",host_id="cloud-primary"}'
    # A restarted Prometheus can replay older labels from the WAL. Only the
    # exact current scrape frame is eligible; lookback is not fresh evidence.
    frame = f'max by ({dimensions}) (timestamp({reference}))'
    return f'{selector} and (timestamp({selector}) == on ({dimensions}) group_left {frame})'


def verify(base='http://127.0.0.1:19094', *, relay=True):
    last_error = None
    last_message = None
    for attempt in range(25):
        try:
            for job, count in [('node', 1), ('cadvisor', 1), ('blackbox', 6), ('custom', 1), ('http', 1)]:
                rows = query('up{job="server-monitor-' + job + '"}', base)
                if len(rows) != count or any(float(row['value'][1]) != 1 for row in rows):
                    raise RuntimeError('Exporter scrape is not healthy: ' + job)
            parsing = query(frame_expression('server_monitor_http_parse_errors_total', 'server-monitor-http'), base)
            if len(parsing) != 1 or float(parsing[0]['value'][1]) != 0:
                raise RuntimeError('HTTP privacy log parser is missing or has errors')
            for metric, maximum_age in [('server_monitor_host_collected_at_seconds', 12), ('server_monitor_custom_collected_at_seconds', 45)]:
                rows = query(metric + '{host_id="cloud-primary"}', base)
                if len(rows) != 1 or not -5 <= time.time() - float(rows[0]['value'][1]) <= maximum_age:
                    age = round(time.time() - float(rows[0]['value'][1]), 1) if len(rows) == 1 else None
                    raise RuntimeError(f'Exporter data stale: {metric}, series={len(rows)}, age={age}')
            collectors = query(frame_expression('node_scrape_collector_success', 'server-monitor-node'), base)
            required = {'cpu', 'diskstats', 'filesystem', 'loadavg', 'meminfo', 'netdev', 'stat', 'time', 'uname'}
            healthy = {row['metric'].get('collector') for row in collectors if float(row['value'][1]) == 1}
            if not required <= healthy:
                raise RuntimeError('Node collectors are incomplete: ' + ','.join(sorted(required - healthy)))
            for suffix in ('cpu_percent', 'disk_read_bytes_per_second', 'disk_write_bytes_per_second', 'network_rx_bytes_per_second', 'network_tx_bytes_per_second'):
                metric = 'server_monitor_host_' + suffix
                rows = query(frame_expression(metric, 'server-monitor-host', source='server_monitor_host_collected_at_seconds'), base)
                if len(rows) != 1 or not math.isfinite(float(rows[0]['value'][1])) or float(rows[0]['value'][1]) < 0:
                    raise RuntimeError('Normalized host rate is missing from the current frame: ' + suffix)
            containers = query(frame_expression('server_monitor_custom_container_info', 'server-monitor-custom',
                                                source='server_monitor_custom_collected_at_seconds'), base)
            identifiers = {row['metric'].get('container_id') for row in containers}
            if len(identifiers) != 3 or any(not re.fullmatch(r'[0-9a-f]{64}', value or '') for value in identifiers):
                raise RuntimeError('Custom Docker inventory is incomplete')
            resources = query(frame_expression('container_memory_working_set_bytes', 'server-monitor-cadvisor'), base)
            resource_ids = set()
            for row in resources:
                identity = re.findall(r'(?<![0-9a-f])([0-9a-f]{64})(?![0-9a-f])', row['metric'].get('id', ''))
                if len(identity) == 1:
                    resource_ids.add(identity[0])
            if resource_ids != identifiers:
                raise RuntimeError('cAdvisor does not match the real Docker containers')
            captures = query(frame_expression('container_last_seen', 'server-monitor-cadvisor'), base)
            if len(captures) != 3 or any(not -5 <= time.time() - float(row['value'][1]) <= 45 for row in captures):
                raise RuntimeError('cAdvisor container last-seen timestamps are stale or missing')
            probes = query(frame_expression('probe_success', 'server-monitor-blackbox', dimensions='host_id,id'), base)
            if len(probes) != 6 or any(float(row['value'][1]) != 1 for row in probes):
                raise RuntimeError('A fixed local HTTP/TCP probe failed')
            if relay and not query('up{job="server-monitor-node"}', f'http://{gateway()}:19095'):
                raise RuntimeError('Candidate private relay is not ready')
            return
        except (OSError, ValueError, RuntimeError) as error:
            last_error = error
            message = str(error) if isinstance(error, RuntimeError) else type(error).__name__
            if message != last_message:
                print('Standard exporter readiness: ' + message[:180], flush=True)
                last_message = message
            if attempt != 24:
                time.sleep(3)
    raise RuntimeError('Standard exporter validation failed') from last_error


def prepare():
    snapshot()
    try:
        install_runtime()
        verify()
    except Exception:
        rollback()
        raise


def finalize():
    values = dict(line.split('=', 1) for line in WEB_ENV.read_text().splitlines() if line and not line.startswith('#') and '=' in line)
    if values.get('MONITOR_EXPORTER_MODE') != 'standard':
        raise RuntimeError('Website has not switched to standard exporters')
    verify('http://127.0.0.1:19090', relay=False)
    run('systemctl', 'disable', '--now', OLD_EXPORTER)
    run('systemctl', 'stop', PROXY, SOCKET, SHADOW)
    run('systemctl', 'disable', SOCKET, SHADOW)


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
    for unit, state in metadata['units'].items():
        run('systemctl', 'enable' if state['enabled'] else 'disable', unit, check=False)
        run('systemctl', 'start' if state['active'] else 'stop', unit, check=False)
    shutil.rmtree(BACKUP)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    if action == 'shadow':
        prepare()
        commit()
    elif action == 'prepare':
        prepare()
    elif action == 'verify':
        verify()
    elif action == 'finalize':
        finalize()
    elif action == 'rollback':
        rollback()
    elif action == 'commit':
        commit()
    else:
        raise RuntimeError('Expected shadow, prepare, verify, finalize, rollback or commit')


if __name__ == '__main__':
    try:
        main()
        print('Standard exporter installation step completed')
    except Exception as error:
        # Only our own fixed diagnostic messages are safe to display. Never
        # print subprocess output, container metadata or environment values.
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        if isinstance(error.__cause__, RuntimeError):
            detail += ': ' + str(error.__cause__)
        print(f'Standard exporter installation failed ({type(error).__name__}): {detail[:300]}', file=sys.stderr)
        sys.exit(1)

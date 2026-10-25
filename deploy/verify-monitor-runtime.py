#!/usr/bin/env python3
"""Gate the actual compiled candidate image before switching production readers.

The fixture has no real DB or Google credentials, listens only on loopback
inside its own container, and is never mounted into the production website.
"""
import argparse
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
LABEL = 'personal-homepage-monitor-runtime-probe'
FIXTURES = ('monitor-runtime-fixture.mjs', 'monitor-runtime-probe.mjs')


def docker(*args, timeout=30, check=True):
    return subprocess.run(['docker', *args], capture_output=True, text=True, timeout=timeout, check=check)


def gateway_for(network):
    value = json.loads(docker('network', 'inspect', network).stdout)[0]
    gateway = next(item['Gateway'] for item in value['IPAM']['Config'] if '.' in item.get('Gateway', ''))
    address = ipaddress.ip_address(gateway)
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified:
        raise RuntimeError('runtime_probe_invalid_docker_gateway')
    return gateway


def cleanup(name, identity):
    inspected = docker('inspect', '--format', '{{json .Config.Labels}}', name, check=False, timeout=10)
    if inspected.returncode:
        if 'No such object' in inspected.stderr or 'No such container' in inspected.stderr:
            return
        raise RuntimeError('runtime_probe_cleanup_unavailable')
    labels = json.loads(inspected.stdout)
    if labels.get(LABEL) != identity:
        raise RuntimeError('runtime_probe_cleanup_identity_mismatch')
    docker('rm', '--force', name, timeout=15)


def verify_runtime(image, network='personal-homepage-net', *, exporter_mode='legacy', prometheus_port=19091):
    if exporter_mode not in ('legacy', 'standard') or prometheus_port not in (19091, 19095):
        raise RuntimeError('runtime_probe_invalid_source')
    identity = uuid.uuid4().hex
    name = 'monitor-runtime-probe-' + identity[:12]
    gateway = gateway_for(network)
    cutoff = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    environment = {
        'NODE_ENV': 'production', 'NEXT_TELEMETRY_DISABLED': '1', 'HOSTNAME': '127.0.0.1', 'PORT': '3000',
        'DATABASE_URL': 'postgresql://fixture.invalid/noop', 'MONITOR_OWNER_EMAIL': 'whanser220@gmail.com',
        'MONITOR_PUBLIC_URL': 'https://warmhanser.com', 'MONITOR_DATA_BACKEND': 'prometheus',
        'MONITOR_PROMETHEUS_URL': f'http://{gateway}:{prometheus_port}', 'MONITOR_PROMETHEUS_CUTOVER_AT': cutoff,
        'MONITOR_EXPORTER_MODE': exporter_mode,
        'MONITOR_RUNTIME_PROBE': '1',
    }
    with tempfile.TemporaryDirectory(prefix='monitor-runtime-probe-') as temporary:
        directory = Path(temporary)
        directory.chmod(0o755)  # The candidate keeps its existing UID 1001.
        for filename in FIXTURES:
            shutil.copyfile(HERE / filename, directory / filename)
            (directory / filename).chmod(0o644)
        arguments = ['run', '--detach', '--rm', '--name', name, '--label', f'{LABEL}={identity}',
                     '--network', network, '--memory', '384m', '--cpus', '0.5', '--pids-limit', '128',
                     '--mount', f'type=bind,source={directory},target=/probe,readonly', '--entrypoint', 'node']
        for key, value in environment.items():
            arguments.extend(['--env', f'{key}={value}'])
        arguments.extend([image, '--import', '/probe/monitor-runtime-fixture.mjs', '/app/server.js'])
        try:
            docker(*arguments, timeout=30)
            result = docker('exec', name, 'node', '/probe/monitor-runtime-probe.mjs', timeout=120, check=False)
            if result.returncode:
                code = next((line for line in result.stderr.splitlines() if re.fullmatch(r'runtime_[A-Za-z0-9_]+', line)), 'runtime_candidate_probe_failed')
                raise RuntimeError(code)
            summary = json.loads(result.stdout)
            if summary.get('test') != 'compiled-next-runtime' or summary.get('current') != 200:
                raise RuntimeError('runtime_probe_invalid_summary')
            print('Monitor candidate compiled runtime passed: ' + json.dumps(summary, separators=(',', ':')))
        finally:
            cleanup(name, identity)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--network', default='personal-homepage-net')
    parser.add_argument('--exporter-mode', choices=('legacy', 'standard'), default='legacy')
    parser.add_argument('--prometheus-port', type=int, choices=(19091, 19095), default=19091)
    args = parser.parse_args()
    verify_runtime(args.image, args.network, exporter_mode=args.exporter_mode, prometheus_port=args.prometheus_port)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'runtime_[A-Za-z0-9_]+', str(error)) else type(error).__name__
        print(f'Monitor candidate runtime failed ({code})', file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Exercise the actual pinned upstream Linux binary, with private temp logs.

Usage: python3 tests/verify_http_exporter_native.py /path/to/pinned/binary
No Nginx, systemd, Docker, production log, credentials, or external ports used.
"""
import json
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = Path(__file__).resolve().parents[1]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def sample(text, name, **labels):
    found = []
    for line in text.splitlines():
        match = re.fullmatch(re.escape(name) + r'(?:\{(.*)\})? ([^ ]+)', line)
        if not match:
            continue
        actual = dict(re.findall(r'(\w+)="([^"]*)"', match[1] or ''))
        if all(actual.get(key) == str(value) for key, value in labels.items()):
            found.append(float(match[2]))
    return found


def main(binary):
    with tempfile.TemporaryDirectory(prefix='monitor-http-native-') as directory:
        root = Path(directory)
        log = root / 'traffic.jsonl'
        # Existing contents must not become newly observed traffic after start.
        log.write_text(json.dumps({'service': 'website', 'status': 200, 'request_time': 9, 'body_bytes_sent': 1}) + '\n')
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            port = reservation.getsockname()[1]
        config = root / 'config.yml'
        config.write_text((REPO / 'services/server-monitor/http-log-exporter.yml').read_text()
                          .replace('/var/log/personal-homepage-monitor/traffic.jsonl', str(log))
                          .replace('port: 19111', 'port: ' + str(port)))
        subprocess.run([binary, '-config-file', str(config), '-verify-config'], check=True, capture_output=True, timeout=10)
        output = (root / 'exporter.log').open('w')
        process = None

        def fetch():
            with OPENER.open(f'http://127.0.0.1:{port}/metrics', timeout=2) as response:
                return response.read(1024 * 1024).decode()

        def wait(check):
            for _ in range(70):
                if process.poll() is not None:
                    raise AssertionError('Pinned exporter exited unexpectedly')
                try:
                    text = fetch()
                    if check(text):
                        return text
                except OSError:
                    pass
                time.sleep(0.1)
            raise AssertionError('Pinned exporter did not observe fixture events')

        def start():
            nonlocal process
            process = subprocess.Popen([binary, '-config-file', str(config), '-log-level', 'warn'], stdout=output, stderr=output)
            return wait(lambda text: sample(text, 'server_monitor_ingress_parse_errors_total') == [0])

        def append(service, status, duration, size):
            with log.open('a') as stream:
                stream.write(json.dumps({'service': service, 'status': status, 'request_time': duration, 'body_bytes_sent': size}) + '\n')

        try:
            text = start()
            assert sample(text, 'server_monitor_ingress_http_response_count_total') == [], 'Existing log was replayed'
            for event in [('website', 200, .2, 1024), ('website', 303, .05, 32), ('website', 404, .03, 16),
                          ('website', 500, 1.2, 64), ('whiteboard', 200, .005, 512), ('study-agent', 200, .1, 256),
                          ('study-agent', 403, .15, 128)]:
                append(*event)
            text = wait(lambda value: len(sample(value, 'server_monitor_ingress_http_response_count_total')) == 7)
            assert sample(text, 'server_monitor_ingress_http_response_count_total', service='website', status='200') == [1]
            assert sample(text, 'server_monitor_ingress_http_response_size_bytes', service='website', status='200') == [1024]
            assert sample(text, 'server_monitor_ingress_http_response_time_seconds_hist_sum', service='website', status='200') == [.2]
            assert sample(text, 'server_monitor_ingress_http_response_time_seconds_hist_bucket', service='website', status='200', le='.25') == []
            assert sample(text, 'server_monitor_ingress_http_response_time_seconds_hist_bucket', service='website', status='200', le='0.25') == [1]
            assert sample(text, 'server_monitor_ingress_http_response_time_seconds_hist_bucket', service='website', status='500', le='1') == [0]
            assert sample(text, 'server_monitor_ingress_http_response_time_seconds_hist_bucket', service='website', status='500', le='2.5') == [1]
            assert len(sample(text, 'server_monitor_ingress_http_response_time_seconds_hist_bucket', service='website', status='200')) == 12
            for line in text.splitlines():
                if line.startswith('server_monitor_ingress_') and '{' in line:
                    keys = set(re.findall(r'(\w+)=', line.split('}', 1)[0]))
                    assert keys <= {'method', 'status', 'service', 'le', 'quantile'}, 'Unexpected request labels'
            # Copytruncate log rotation, while keeping the same file identity.
            log.write_text('')
            time.sleep(.4)
            append('website', 200, .25, 99)
            text = wait(lambda value: sample(value, 'server_monitor_ingress_http_response_count_total', service='website', status='200') == [2])
            assert sample(text, 'server_monitor_ingress_http_response_size_bytes', service='website', status='200') == [1123]
            process.terminate()
            process.wait(timeout=5)
            text = start()
            assert sample(text, 'server_monitor_ingress_http_response_count_total') == [], 'Restart replayed traffic as new requests'
            append('website', 200, .005, 7)
            text = wait(lambda value: sample(value, 'server_monitor_ingress_http_response_count_total', service='website', status='200') == [1])
            assert sample(text, 'server_monitor_ingress_http_response_size_bytes', service='website', status='200') == [7]
            with log.open('a') as stream:
                stream.write('{invalid-json\n')
            wait(lambda value: sample(value, 'server_monitor_ingress_parse_errors_total') == [1])
            print(json.dumps({'result': 'passed', 'realBinary': 'v1.11.0', 'events': 9,
                              'checks': ['counts', 'bytes', 'status classes', 'histogram buckets', 'bounded labels',
                                         'copytruncate', 'restart EOF/no replay', 'parse error visibility']}))
        finally:
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
            output.close()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Pass the pinned Linux exporter binary path')
    main(sys.argv[1])

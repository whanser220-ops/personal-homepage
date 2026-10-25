#!/usr/bin/env python3
"""Isolated real Nginx/Grafana auth contract; no production cookies or reload.

Loopback-only synthetic authorization replaces Next for this component test.
The compiled candidate gate independently exercises the actual Next auth route.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parent.parent
OWNER = 'whanser220@gmail.com'
COOKIE = '__Host-server-monitor-session=isolated-nginx-contract-fixture'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, location):
        return None


class AuthStub(BaseHTTPRequestHandler):
    valid = True
    calls = 0
    forwarded_identity = False

    def do_GET(self):
        type(self).calls += 1
        type(self).forwarded_identity |= any(self.headers.get(name) for name in (
            'X-WEBAUTH-USER', 'X-WEBAUTH-EMAIL', 'X-WEBAUTH-ROLE', 'X-WEBAUTH-NAME', 'X-WEBAUTH-GROUPS', 'X-Monitor-User', 'Authorization'))
        allowed = self.path == '/api/monitor/auth/grafana' and self.valid and COOKIE in self.headers.get('Cookie', '').split('; ')
        self.send_response(204 if allowed else 401)
        self.send_header('Cache-Control', 'private, no-store')
        if allowed:
            self.send_header('X-Monitor-User', OWNER)
        self.end_headers()

    def log_message(self, _format, *args):
        pass


def request(path, headers=None, data=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    values = {'Host': 'warmhanser.com', **(headers or {})}
    if data is not None:
        values['Content-Type'] = 'application/json'
    try:
        with opener.open(urllib.request.Request('http://127.0.0.1:19112' + path, headers=values,
                                                data=json.dumps(data).encode() if data is not None else None), timeout=10) as response:
            return response.status, response.headers, response.read(256 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, error.headers, b''


def verify():
    AuthStub.valid, AuthStub.calls, AuthStub.forwarded_identity = True, 0, False
    # Fail closed rather than stop an unknown listener at either test port.
    for port in (19112, 19113):
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', port))
    server = ThreadingHTTPServer(('127.0.0.1', 19113), AuthStub)
    server.daemon_threads = True
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    nginx = None
    try:
        with tempfile.TemporaryDirectory(prefix='monitor-grafana-proxy-') as directory:
            root = Path(directory)
            source = (REPO / 'deploy/nginx-server-monitor.conf').read_text()
            # Only the public HTTP-to-TLS redirect is removed for this private
            # HTTP test transport; auth and proxy directives remain identical.
            source = source.replace('    if ($scheme = http) { return 308 https://warmhanser.com$request_uri; }\n', '')
            (root / 'monitor.conf').write_text(source)
            (root / 'http.conf').write_text((REPO / 'deploy/nginx-monitor-http.conf').read_text())
            config = f'''pid {root}/nginx.pid;
worker_processes 1;
error_log {root}/error.log warn;
events {{ worker_connections 64; }}
http {{
  access_log off;
  include {root}/http.conf;
  upstream personal_homepage_app {{ server 127.0.0.1:19113; }}
  server {{ listen 127.0.0.1:19112; server_name warmhanser.com;
    access_log {root}/traffic.jsonl monitor_http if=$monitor_http_record;
    location = /__contract_website {{ return 200 'fixture'; }}
    location = /whiteboard/__contract {{ return 200 'fixture'; }}
    location = /study/__contract {{ return 200 'fixture'; }}
    location = /api/health {{ return 204; }}
    location = /study/__contract_stream {{ default_type text/event-stream; return 200 'fixture'; }}
    location = /study/__contract_upgrade {{ return 200 'fixture'; }}
    include {root}/monitor.conf;
  }}
}}
'''
            (root / 'nginx.conf').write_text(config)
            subprocess.run(['nginx', '-t', '-c', str(root / 'nginx.conf')], check=True, capture_output=True, timeout=10)
            nginx = subprocess.Popen(['nginx', '-c', str(root / 'nginx.conf'), '-g', 'daemon off;'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            try:
                for attempt in range(30):
                    if nginx.poll() is not None:
                        raise RuntimeError('Isolated Nginx exited before readiness')
                    try:
                        if request('/server-monitor/grafana/api/user')[0] == 401:
                            break
                    except OSError:
                        pass
                    if attempt == 29:
                        raise RuntimeError('Isolated Nginx readiness timed out')
                    time.sleep(.1)
                for headers in [{}, {'X-WEBAUTH-USER': OWNER, 'X-WEBAUTH-ROLE': 'Admin', 'X-Monitor-User': OWNER},
                                {'Cookie': 'grafana_session=forged', 'Authorization': 'Bearer synthetic-only'}]:
                    status, received, _ = request('/server-monitor/grafana/api/user', headers)
                    if status != 401 or 'no-store' not in received.get('Cache-Control', ''):
                        raise RuntimeError('Anonymous identity or Grafana cookie bypassed Nginx authorization')
                owner_headers = {'Cookie': COOKIE + '; grafana_session=forged', 'X-WEBAUTH-USER': 'admin', 'X-WEBAUTH-ROLE': 'Admin'}
                status, headers, body = request('/server-monitor/grafana/api/user', owner_headers)
                owner = json.loads(body)
                if status != 200 or owner.get('email') != OWNER or owner.get('isGrafanaAdmin') or headers.get('Set-Cookie'):
                    raise RuntimeError('Nginx did not replace browser identity with the verified owner')
                status, _, body = request('/server-monitor/grafana/api/user/orgs', owner_headers)
                if status != 200 or any(item.get('role') != 'Viewer' for item in json.loads(body)):
                    raise RuntimeError('Nginx forwarded elevated Grafana organization privileges')
                if AuthStub.forwarded_identity:
                    raise RuntimeError('Browser identity was forwarded to the authorization subrequest')
                now = int(time.time() * 1000)
                status, _, body = request('/server-monitor/grafana/api/ds/query', {**owner_headers, 'Origin':'https://warmhanser.com'},
                    {'from':str(now-60000),'to':str(now),'queries':[{'refId':'A','datasource':{'type':'prometheus','uid':'monitor-prometheus'},
                     'expr':'up{job="server-monitor-node"}','instant':True,'range':False,'format':'time_series','intervalMs':3000,'maxDataPoints':10}]})
                if status != 200 or not json.loads(body).get('results', {}).get('A', {}).get('frames'):
                    raise RuntimeError('Viewer POST queries failed through the per-request auth proxy')
                status, received, _ = request('/server-monitor/grafana/d/monitor-sre-overview/overview', {'Accept': 'text/html'})
                if status != 302 or urllib.parse.urlsplit(received.get('Location', '')).path != '/server-monitor':
                    raise RuntimeError('Anonymous Grafana document did not return to the login shell')
                if request('/_monitor_grafana_auth')[0] != 404:
                    raise RuntimeError('Internal authorization subrequest is externally accessible')
                AuthStub.valid = False
                if request('/server-monitor/grafana/api/user', owner_headers)[0] != 401:
                    raise RuntimeError('Revoked website authorization remained valid through Grafana')
                for path in ['/__contract_website?query=synthetic-only', '/whiteboard/__contract', '/study/__contract']:
                    if request(path)[0] != 200:
                        raise RuntimeError('Synthetic privacy-log response failed')
                request('/api/health')
                request('/study/__contract_stream')
                request('/study/__contract_upgrade', {'Upgrade':'websocket'})
                for _ in range(30):
                    traffic = [json.loads(line) for line in (root / 'traffic.jsonl').read_text().splitlines()]
                    if len(traffic) >= 3:
                        break
                    time.sleep(.1)
                if len(traffic) != 3 or {row['service'] for row in traffic} != {'website','whiteboard','study-agent'} or any(
                        set(row) != {'service','status','request_time','body_bytes_sent'} or row['status'] != 200 or
                        not isinstance(row['request_time'], (int,float)) or not isinstance(row['body_bytes_sent'], int) for row in traffic):
                    raise RuntimeError('Nginx privacy log fields or stream/monitor exclusions failed')
                print(json.dumps({'test':'isolated-nginx-grafana-proxy','anonymous':401,'forged':401,'owner':200,
                    'role':'Viewer','queryPost':200,'document':302,'internal':404,'revoked':401,'setCookie':False,
                    'authRequests':AuthStub.calls,'privacyLogServices':3,'privacyLogFields':4,'excludedMonitoringHealthStreams':True}))
            finally:
                # nginx is our daemon-off child in its own session, never the
                # system Nginx service or another task's existing listener.
                if nginx.poll() is None:
                    nginx.send_signal(signal.SIGQUIT)
                    try:
                        nginx.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(nginx.pid, signal.SIGTERM)
                        nginx.wait(timeout=5)
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)


if __name__ == '__main__':
    def interrupted(_number, _frame):
        raise SystemExit(1)
    for event in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(event, interrupted)
    try:
        verify()
    except Exception as error:
        print(f'Isolated Grafana proxy check failed ({type(error).__name__})', file=sys.stderr)
        raise SystemExit(1)

#!/usr/bin/env python3
"""Read-only public auth boundary and private provisioned Grafana checks."""
import grp
import importlib.util
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, location):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def request(path, headers=None):
    req = urllib.request.Request('https://warmhanser.com' + path, headers=headers or {})
    try:
        with OPENER.open(req, timeout=12) as response:
            return response.status, response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.headers


def main():
    spec = importlib.util.spec_from_file_location('grafana_install', Path(__file__).with_name('install-grafana.py'))
    grafana = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(grafana)
    grafana.verify()
    status, legacy = grafana.request('/api/datasources/uid/monitor-legacy-history', True)
    if status != 200 or legacy.get('user') != 'monitor_grafana_history':
        raise RuntimeError('The legacy seven-day resource history datasource is missing')
    for path in ['/server-monitor/grafana/api/search', '/server-monitor/grafana/api/health',
                 '/server-monitor/grafana/api/dashboards/uid/monitor-sre-overview']:
        for headers in [{}, {'X-WEBAUTH-USER': grafana.OWNER, 'X-WEBAUTH-ROLE': 'Admin',
                            'X-Monitor-User': grafana.OWNER, 'Cookie': 'grafana_session=forged'}]:
            status, received = request(path, headers)
            if status != 401 or 'no-store' not in received.get('Cache-Control', ''):
                raise RuntimeError('Anonymous or forged Grafana identity passed the public boundary')
    status, headers = request('/server-monitor/grafana/d/monitor-sre-overview/overview', {'Accept': 'text/html'})
    if status != 302 or headers.get('Location') not in ('/server-monitor', 'https://warmhanser.com/server-monitor'):
        raise RuntimeError('Anonymous Grafana documents must return to the website login shell')
    if request('/_monitor_grafana_auth')[0] != 404:
        raise RuntimeError('The internal auth subrequest must not be public')
    status, headers = request('/api/monitor/auth/grafana', {'X-Monitor-User': grafana.OWNER})
    if status != 401 or headers.get('X-Monitor-User') or 'no-store' not in headers.get('Cache-Control', ''):
        raise RuntimeError('The website Grafana authorization route trusts an anonymous identity')
    metadata = grafana.LOG_FILE.stat()
    if metadata.st_uid != 0 or metadata.st_gid != grp.getgrnam('www-data').gr_gid or metadata.st_mode & 0o777 != 0o640:
        raise RuntimeError('Privacy traffic log permissions are not restricted')
    for unit in [grafana.UNIT, grafana.TIMER, 'personal-homepage-http-metrics.service']:
        subprocess.run(['systemctl', 'is-active', '--quiet', unit], check=True, timeout=10)
    print('Grafana public boundary passed: forged/anonymous APIs 401, document login redirect, internal auth 404, private log permissions')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Grafana release verification failed ({type(error).__name__})', file=sys.stderr)
        raise SystemExit(1)

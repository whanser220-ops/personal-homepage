#!/usr/bin/env python3
"""Release checks without manufacturing a browser session or logging secrets."""
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


public_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def get(url, method='GET', follow_redirects=True):
    try:
        request = urllib.request.Request(url, method=method, data=b'{}' if method == 'POST' else None,
                                         headers={'Content-Type': 'application/json'} if method == 'POST' else {})
        with (opener if follow_redirects else public_opener).open(request, timeout=10) as response:
            return response.status, response.read(16384)
    except urllib.error.HTTPError as error:
        return error.code, b''


def database_query(sql):
    env = dict(line.split('=', 1) for line in Path('/etc/personal-homepage/app.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
    address = urllib.parse.urlsplit(env['DATABASE_URL'])
    # The official PostgreSQL image uses trust for its local Unix socket;
    # select the application database role without exporting its password.
    args = ['docker', 'exec', '-u', 'postgres', 'personal-homepage-postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', urllib.parse.unquote(address.username), '-d', urllib.parse.unquote(address.path.lstrip('/')), '-At', '-c', sql]
    result = subprocess.run(args, capture_output=True, text=True, timeout=10, check=True)
    return result.stdout.strip()


def wait_for_fresh_sample():
    """Allow the first collector batch to initialize storage before release."""
    for attempt in range(12):
        try:
            age = database_query("SELECT extract(epoch from now()-collected_at)::int FROM monitor_samples WHERE host_id='cloud-primary' ORDER BY collected_at DESC LIMIT 1")
            checks_age = database_query("SELECT extract(epoch from now()-coalesce(sample->>'checksCollectedAt',sample->>'collectedAt')::timestamptz)::int FROM monitor_samples WHERE host_id='cloud-primary' AND sample ? 'containers' AND sample ? 'services' ORDER BY coalesce(sample->>'checksCollectedAt',sample->>'collectedAt') DESC LIMIT 1")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            # On a first installation the collector creates the schema with
            # its first ingest, after the bounded Docker/HTTP probe batch.
            # Treat an absent table or a reconnecting database as not ready.
            age = checks_age = ''
        if age and checks_age and -5 <= int(age) <= 45 and -5 <= int(checks_age) <= 45:
            return
        if attempt == 11:
            raise RuntimeError('No fresh host and checks snapshots after deployment')
        time.sleep(5)


def main():
    for base in ['http://127.0.0.1:3000', 'https://warmhanser.com']:
        for path in ['/api/monitor/current', '/api/monitor/history?range=1h']:
            assert get(base + path)[0] == 401, 'Anonymous monitor read must return 401'
    for base in ['http://1.117.232.198', 'http://warmhanser.com', 'https://warmhanser.com']:
        for path in ['/api/monitor/ingest', '/api/monitor/ingest/', '/api/monitor/ing%65st', '/api//monitor/ingest']:
            for method in ['GET', 'POST']:
                assert get(base + path, method=method, follow_redirects=False)[0] == 404, 'Public monitor ingestion must be closed without redirecting'
    status, body = get('https://warmhanser.com/api/monitor/auth/session')
    assert status == 200 and json.loads(body)['configured'], 'Google login configuration is missing'
    assert get('https://warmhanser.com/server-monitor')[0] == 200, 'Monitor page is unavailable'
    wait_for_fresh_sample()
    print('Monitor release checks passed: private reads, closed ingestion and fresh host sampling')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Monitor release check failed ({type(error).__name__})')
        raise SystemExit(1)

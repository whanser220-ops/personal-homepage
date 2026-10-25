#!/usr/bin/env python3
"""Release checks without manufacturing a browser session or logging secrets."""
import json
import importlib.util
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


def verify_prometheus_stack():
    spec = importlib.util.spec_from_file_location('monitor_prometheus_install',
                                                  Path(__file__).with_name('install-prometheus.py'))
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    installer.verify()
    values = dict(line.split('=', 1) for line in Path('/etc/personal-homepage-monitor/web.env').read_text().splitlines()
                  if line and not line.startswith('#') and '=' in line)
    standard = values.get('MONITOR_EXPORTER_MODE') == 'standard'
    expected = {'19090': '127.0.0.1', '19091': installer.network_gateway()}
    expected.update({port: '127.0.0.1' for port in ('19101', '19102', '19103', '19104')} if standard else {'19100': '127.0.0.1'})
    optional = {'19094': '127.0.0.1', '19095': installer.network_gateway(), '19100': '127.0.0.1'} if standard else {}
    listeners = subprocess.run(['ss', '-lntH'], capture_output=True, text=True, check=True, timeout=10).stdout
    found = set()
    for line in listeners.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        address, _, port = fields[3].rpartition(':')
        if port in expected or port in optional:
            assert address == (expected | optional)[port], 'Monitoring listener must not bind a public or wildcard address'
            if port in expected:
                found.add(port)
    assert found == set(expected), 'A private monitoring listener is missing'
    # Run from the actual unprivileged website container. This proves the
    # Docker gateway relay works without exposing a host/Docker socket.
    script = '''
      const base=process.env.MONITOR_PROMETHEUS_URL;
      if(process.env.MONITOR_DATA_BACKEND!=="prometheus" || !base) process.exit(1);
      const checks=process.env.MONITOR_EXPORTER_MODE==="standard"?"server_monitor_custom_collected_at_seconds":"server_monitor_checks_collected_at_seconds";
      for(const metric of ["server_monitor_host_collected_at_seconds",checks]){
        const u=new URL("/api/v1/query",base);u.searchParams.set("query",metric+'{host_id="cloud-primary"}');
        const r=await fetch(u,{signal:AbortSignal.timeout(5000)});const d=await r.json();
        const points=d.data?.result;const age=Date.now()/1000-Number(points?.[0]?.value?.[1]);
        if(!r.ok||d.status!=="success"||points?.length!==1||!Number.isFinite(age)||age < -5||age>45)process.exit(1);
      }
      console.log("Website private Prometheus queries passed");
    '''
    subprocess.run(['docker', 'exec', 'personal-homepage', 'node', '--input-type=module', '-e', script],
                   capture_output=True, text=True, timeout=15, check=True)


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
    values = dict(line.split('=', 1) for line in Path('/etc/personal-homepage-monitor/web.env').read_text().splitlines()
                  if line and not line.startswith('#') and '=' in line)
    if values.get('MONITOR_DATA_BACKEND') == 'prometheus':
        verify_prometheus_stack()
    else:
        wait_for_fresh_sample()
    print('Monitor release checks passed: private reads, closed ingestion and fresh host/checks sampling')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Monitor release check failed ({type(error).__name__})')
        raise SystemExit(1)

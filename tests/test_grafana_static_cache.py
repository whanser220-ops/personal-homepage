"""Response-time cache allowlist boundaries; native proxy gate tests real HTTP."""
from pathlib import Path
import re
import unittest

REPO = Path(__file__).resolve().parents[1]


class GrafanaStaticCacheTests(unittest.TestCase):
    def setUp(self):
        source = (REPO / 'deploy/nginx-monitor-http.conf').read_text()
        rules = re.findall(r'"(~\^.*)" "(private, max-age=31536000, immutable)";', source)
        self.assertEqual(len(rules), 1)
        self.allow = re.compile(rules[0][0][1:])
        self.assertIn('map "$request_method:$status:$uri" $monitor_grafana_cache_control', source)
        self.assertIn('default "no-store";', source)

    def test_only_successful_reads_of_hash_named_static_files_are_immutable(self):
        for method in ['GET', 'HEAD']:
            for status in [200, 206, 304]:
                for path in ['/server-monitor/grafana/public/build/runtime.abc1234567890defabcd.js',
                             '/server-monitor/grafana/public/build/grafana.dark.abc1234567890defabcd.css',
                             '/server-monitor/grafana/public/build/static/img/fontawesome-webfont.f691f37e.woff',
                             '/server-monitor/grafana/public/fonts/Inter-Regular.1234abcd.woff2',
                             '/server-monitor/grafana/public/img/icon.1234abcd.svg']:
                    with self.subTest(method=method, status=status, path=path):
                        self.assertIsNotNone(self.allow.fullmatch(f'{method}:{status}:{path}'))

    def test_errors_redirects_mutations_and_nonstatic_content_are_never_cached(self):
        asset = '/server-monitor/grafana/public/build/runtime.1234abcd.js'
        for status in [201, 204, 301, 302, 303, 307, 308, 400, 401, 403, 404, 405, 410, 429, 500, 502, 503, 504]:
            self.assertIsNone(self.allow.fullmatch(f'GET:{status}:{asset}'))
        for method in ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']:
            self.assertIsNone(self.allow.fullmatch(f'{method}:200:{asset}'))
        for path in ['/server-monitor/grafana/public/build/runtime.js',
                     '/server-monitor/grafana/public/build/runtime.123.js',
                     '/server-monitor/grafana/public/build/runtime.1234abcd.js.map',
                     '/server-monitor/grafana/public/build/runtime.1234abcd.json',
                     '/server-monitor/grafana/public/fonts/Inter-Regular.woff2',
                     '/server-monitor/grafana/public/img/grafana_icon.svg',
                     '/server-monitor/grafana/api/query.1234abcd.js',
                     '/server-monitor/grafana/d/overview.1234abcd.js',
                     '/server-monitor/grafana/metrics', '/api/monitor/current', '/_monitor_grafana_auth']:
            self.assertIsNone(self.allow.fullmatch(f'GET:200:{path}'), path)

    def test_one_authenticated_proxy_location_handles_assets_and_private_data(self):
        source = (REPO / 'deploy/nginx-server-monitor.conf').read_text()
        location = source.split('location ^~ /server-monitor/grafana/ {', 1)[1].split('\n}', 1)[0]
        self.assertIn('auth_request /_monitor_grafana_auth;', location)
        self.assertIn('proxy_cache off;', location)
        self.assertIn('proxy_hide_header Cache-Control;', location)
        self.assertIn('proxy_hide_header Expires;', location)
        self.assertIn('proxy_hide_header Set-Cookie;', location)
        self.assertIn('add_header Cache-Control $monitor_grafana_cache_control always;', location)
        self.assertNotIn('location ', location)
        for header in ['Authorization', 'Cookie', 'X-WEBAUTH-NAME', 'X-WEBAUTH-GROUPS', 'X-Monitor-User']:
            self.assertIn(f'proxy_set_header {header} "";', location)


if __name__ == '__main__':
    unittest.main()

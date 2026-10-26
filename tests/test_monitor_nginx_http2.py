"""Check the scoped HTTPS edit preserves other services and server blocks."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('monitor_nginx_http2', Path(__file__).parents[1] / 'deploy/install-monitor-nginx.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

TARGET = '''server {
    listen 443 ssl;
    server_name warmhanser.com;
    ssl_certificate /existing/fullchain.pem;
    location /study/ { proxy_pass http://127.0.0.1:4320; }
    location /whiteboard/ { proxy_pass http://127.0.0.1:3001; }
}
'''


class MonitorHttpsTests(unittest.TestCase):
    def test_only_the_named_https_server_changes_and_services_survive(self):
        other = 'server {\n    listen 443 ssl;\n    server_name other.example;\n}\n'
        result = installer.update_https(other + TARGET + other)
        self.assertTrue(result.startswith(other))
        self.assertTrue(result.endswith(other))
        self.assertEqual(result.count('listen 443 ssl http2;'), 1)
        for line in TARGET.splitlines()[3:]:
            self.assertIn(line, result)

    def test_ipv6_options_comments_and_repeat_install(self):
        source = TARGET.replace('    listen 443 ssl;', '    listen 443 ssl default_server; # retained\n    listen [::]:443 ssl;')
        result = installer.update_https(source)
        self.assertIn('listen 443 ssl default_server http2; # retained', result)
        self.assertIn('listen [::]:443 ssl http2;', result)
        self.assertEqual(installer.update_https(result), result)
        self.assertEqual(result.count('include /etc/nginx/snippets/server-monitor.conf;'), 1)

    def test_existing_http2_forms_are_preserved(self):
        legacy = TARGET.replace('listen 443 ssl;', 'listen 443 ssl http2;')
        self.assertEqual(installer.update_https(legacy).count('http2'), 1)
        modern = TARGET.replace('    server_name', '    http2 on;\n    server_name')
        self.assertIn('listen 443 ssl;', installer.update_https(modern))
        self.assertIn('http2 on;', installer.update_https(modern))

    def test_ambiguous_or_non_ssl_target_fails_before_writing(self):
        for invalid in [TARGET + TARGET, TARGET.replace(' ssl;', ';'), TARGET.replace('warmhanser.com', 'other.example'),
                        TARGET.replace('    server_name', '    http2 off;\n    server_name')]:
            with self.subTest(source=invalid), self.assertRaises(ValueError):
                installer.update_https(invalid)


if __name__ == '__main__':
    unittest.main()

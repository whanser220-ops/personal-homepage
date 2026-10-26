"""Pinned packaging, rollback and identity boundaries without host mutations."""
import configparser
from contextlib import closing
import importlib.util
import json
from pathlib import Path
import subprocess
import sqlite3
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

for name in ('pwd', 'grp'):
    try:
        __import__(name)
    except ImportError:
        sys.modules.setdefault(name, types.ModuleType(name))

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('grafana_install', REPO / 'deploy/install-grafana.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class GrafanaInstallationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name, value in [('BACKUP', self.root / 'backup'), ('ROOT', self.root / 'root'),
                            ('RELEASE', self.root / 'release'), ('STATE', self.root / 'state')]:
            self.enterContext(patch.object(installer, name, value))
        if not hasattr(installer.os, 'fchmod'):
            self.enterContext(patch.object(installer.os, 'fchmod', create=True))

    def test_pinned_release_is_immutable_and_separate_from_website(self):
        self.assertEqual(installer.VERSION, '13.2.4')
        self.assertRegex(installer.SHA256, '^[0-9a-f]{64}$')
        self.assertIn('13.2.4', installer.ARCHIVE)
        self.assertTrue(installer.SOURCE_URL.startswith('https://dl.grafana.com/'))
        self.assertFalse(any('web.env' in str(path) or '/nginx/' in str(path).replace('\\', '/') or
                             '/personal-homepage-prometheus/' in str(path).replace('\\', '/') for path in installer.FILES))

    def test_wrong_hash_prevents_extraction_or_service_operations(self):
        archive = installer.ROOT / 'downloads' / installer.ARCHIVE
        archive.parent.mkdir(parents=True)
        archive.write_bytes(b'invalid')
        with patch.object(installer.platform, 'machine', return_value='x86_64'), patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'invalid pinned'):
                installer.install_artifact()
            run.assert_not_called()

    def test_archive_rejects_traversal_and_symlink_before_extracting(self):
        for filename, kind in [('../escape', tarfile.REGTYPE), ('grafana/public/link', tarfile.SYMTYPE)]:
            archive = installer.ROOT / 'downloads' / installer.ARCHIVE
            archive.parent.mkdir(parents=True, exist_ok=True)
            with tarfile.open(archive, 'w:gz') as target:
                directory = tarfile.TarInfo('grafana')
                directory.type = tarfile.DIRTYPE
                target.addfile(directory)
                member = tarfile.TarInfo(filename)
                member.type = kind
                member.linkname = '../../escape'
                target.addfile(member)
            with patch.object(installer.platform, 'machine', return_value='x86_64'), patch.object(installer, 'SHA256', installer.digest(archive)):
                with self.assertRaisesRegex(RuntimeError, 'archive'):
                    installer.install_artifact()
            self.assertFalse(installer.RELEASE.exists())

    def test_failed_private_gate_rolls_back_without_nginx_activation(self):
        with patch.object(installer, 'validate_dashboards'), patch.object(installer, 'validate_rotation'), patch.object(installer, 'snapshot') as snapshot, patch.object(installer, 'install_runtime') as install, \
                patch.object(installer, 'verify', side_effect=RuntimeError('gate')), patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'gate'):
                installer.prepare()
            snapshot.assert_called_once_with()
            install.assert_called_once_with()
            rollback.assert_called_once_with()

    def test_invalid_native_dashboard_queries_never_snapshot_or_restart_grafana(self):
        with patch.object(installer, 'validate_dashboards', side_effect=RuntimeError('invalid query')), \
                patch.object(installer, 'snapshot') as snapshot, patch.object(installer, 'install_runtime') as runtime, \
                patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'invalid query'):
                installer.prepare()
            snapshot.assert_not_called()
            runtime.assert_not_called()
            rollback.assert_not_called()

    def test_invalid_rotation_fixture_never_snapshots_or_mutates_live_units(self):
        with patch.object(installer, 'validate_dashboards'), \
                patch.object(installer, 'validate_rotation', side_effect=RuntimeError('rotation failed')), \
                patch.object(installer, 'snapshot') as snapshot, patch.object(installer, 'install_runtime') as runtime:
            with self.assertRaisesRegex(RuntimeError, 'rotation failed'):
                installer.prepare()
            snapshot.assert_not_called()
            runtime.assert_not_called()

    def test_live_rotation_gate_rejects_failed_oneshot_even_when_timer_could_be_active(self):
        for stdout in ['Result=exit-code\nExecMainStatus=1\n','Result=success\nExecMainStatus=1\n']:
            with patch.object(installer,'run',return_value=subprocess.CompletedProcess([],0,stdout,'')):
                with self.assertRaisesRegex(RuntimeError,'rotation did not complete'):
                    installer.verify_rotation_result()
        with patch.object(installer,'run',return_value=subprocess.CompletedProcess([],0,'Result=success\nExecMainStatus=0\n','')):
            installer.verify_rotation_result()

    def test_shadow_commits_only_private_prepare(self):
        with patch.object(installer.os, 'geteuid', create=True, return_value=0), \
                patch.object(installer.sys, 'argv', ['install-grafana.py', 'shadow']), \
                patch.object(installer, 'prepare') as prepare, patch.object(installer, 'commit') as commit:
            installer.main()
            prepare.assert_called_once_with()
            commit.assert_called_once_with()

    def test_snapshot_rejects_a_concurrent_transaction(self):
        installer.BACKUP.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            installer.snapshot()

    def test_incomplete_read_only_snapshot_removes_only_its_own_backup(self):
        with patch.object(installer, 'snapshot_contents', side_effect=OSError('copy failed')):
            with self.assertRaises(OSError):
                installer.snapshot()
        self.assertFalse(installer.BACKUP.exists())

    def test_online_database_snapshot_and_rollback_restore_prior_rows_and_file_permissions(self):
        target = self.root / 'grafana.ini'
        target.write_text('prior config')
        installer.STATE.mkdir()
        database = installer.STATE / 'grafana.db'
        with closing(sqlite3.connect(database)) as connection, connection:
            connection.execute('create table proof(value text)')
            connection.execute("insert into proof values ('prior')")
        inactive = {'active': False, 'enabled': False}
        with patch.object(installer, 'FILES', [target]), patch.object(installer, 'unit_state', return_value=inactive):
            installer.snapshot()
        target.write_text('candidate config')
        with closing(sqlite3.connect(database)) as connection, connection:
            connection.execute("update proof set value='candidate'")
        account = types.SimpleNamespace(pw_uid=100, pw_gid=100)
        with patch.object(installer.os, 'chown', create=True), patch.object(installer.pwd, 'getpwnam', create=True, return_value=account), \
                patch.object(installer, 'run') as run:
            installer.rollback()
        self.assertEqual(target.read_text(), 'prior config')
        with closing(sqlite3.connect(database)) as connection:
            self.assertEqual(connection.execute('select value from proof').fetchone()[0], 'prior')
        self.assertFalse(installer.BACKUP.exists())
        self.assertTrue(any(call.args[:3] == ('systemctl', 'stop', installer.TIMER) for call in run.call_args_list))

    def test_proxy_config_requires_per_request_unprivileged_private_auth(self):
        ini = configparser.ConfigParser(interpolation=None)
        ini.read(REPO / 'services/server-monitor/grafana/grafana.ini')
        self.assertEqual(ini['server']['http_addr'], '127.0.0.1')
        self.assertEqual(ini['server']['http_port'], '19110')
        self.assertEqual(ini['auth.proxy']['whitelist'], '127.0.0.1')
        self.assertEqual(ini['auth.proxy']['enable_login_token'], 'false')
        self.assertEqual(ini['auth.proxy']['sync_ttl'], '0')
        self.assertEqual(ini['users']['auto_assign_org_role'], 'Viewer')
        for section, key in [('auth.basic', 'enabled'), ('auth.anonymous', 'enabled'), ('users', 'allow_sign_up'),
                             ('users', 'allow_org_create'), ('unified_alerting', 'enabled'), ('analytics', 'reporting_enabled')]:
            self.assertEqual(ini[section][key], 'false')
        self.assertEqual(ini['security']['disable_initial_admin_creation'], 'true')
        self.assertEqual(ini['dashboards']['min_refresh_interval'], '3s')

    def test_history_firewall_allowance_must_equal_only_current_private_database(self):
        history = self.root / 'history.env'
        result = subprocess.CompletedProcess([], 0, '{"personal-homepage-net":{"IPAddress":"172.18.0.3"}}', '')
        with patch.object(installer, 'HISTORY_ENV', history), patch.object(installer, 'run', return_value=result):
            self.assertIsNone(installer.history_address())
            for host in ['127.0.0.1', '1.1.1.1', '172.18.0.5']:
                history.write_text(f'MONITOR_HISTORY_HOST={host}\nMONITOR_HISTORY_PORT=5432\n')
                with self.assertRaisesRegex(RuntimeError, 'private database'):
                    installer.history_address()
            history.write_text('MONITOR_HISTORY_HOST=172.18.0.3\nMONITOR_HISTORY_PORT=5432\n')
            self.assertEqual(installer.history_address(), '172.18.0.3')

    def test_first_install_reuses_group_created_by_history_credential_preparer(self):
        account = types.SimpleNamespace(pw_uid=100, pw_gid=101)
        with patch.object(installer.pwd, 'getpwnam', create=True, side_effect=[KeyError('missing user'), account]), \
                patch.object(installer.grp, 'getgrnam', create=True, return_value=types.SimpleNamespace(gr_gid=101)), \
                patch.object(installer, 'run') as run:
            self.assertIs(installer.ensure_account(), account)
        arguments = run.call_args.args
        self.assertEqual(arguments[0], 'useradd')
        self.assertIn('--gid', arguments)
        self.assertNotIn('--user-group', arguments)
        self.assertEqual(run.call_count, 1)

    def test_nginx_never_forwards_browser_identity_or_grafana_login_cookie(self):
        source = (REPO / 'deploy/nginx-server-monitor.conf').read_text()
        self.assertIn('auth_request /_monitor_grafana_auth;', source)
        self.assertIn('auth_request_set $monitor_grafana_user $upstream_http_x_monitor_user;', source)
        self.assertIn('proxy_set_header X-WEBAUTH-USER $monitor_grafana_user;', source)
        self.assertIn('proxy_set_header X-WEBAUTH-ROLE Viewer;', source)
        self.assertIn('proxy_set_header Cookie "";', source)
        self.assertIn('proxy_hide_header Set-Cookie;', source)
        self.assertNotIn('$http_x_webauth_user', source)
        self.assertNotIn('$http_x_monitor_user', source)
        self.assertIn('location = /_monitor_grafana_auth {\n    internal;', source)

    def test_privacy_log_has_only_four_bounded_fields_and_excludes_streams(self):
        source = (REPO / 'deploy/nginx-monitor-http.conf').read_text()
        line = next(line for line in source.splitlines() if line.startswith('log_format '))
        for forbidden in ('$uri', '$request', '$remote_addr', '$http_cookie', '$args', '$http_authorization', '$host'):
            self.assertNotIn(forbidden, line.replace('$request_time', ''))
        self.assertEqual(line.count('"service"'), 1)
        self.assertIn('text/event-stream', source)
        self.assertIn('$http_upgrade', source)
        self.assertIn('server-monitor|api/monitor', source)
        rotate = (REPO / 'services/server-monitor/grafana/traffic.logrotate').read_text()
        self.assertIn('maxsize 10M', rotate)
        self.assertIn('rotate 2', rotate)

    def test_https_insertion_is_idempotent_and_preserves_other_routes(self):
        target = self.root / 'https.conf'
        target.write_text('server {\n    listen 443 ssl;\n    server_name warmhanser.com;\n    location /study/ { proxy_pass http://127.0.0.1:4320; }\n}\n')
        for _ in range(2):
            subprocess.run([sys.executable, str(REPO / 'deploy/install-monitor-nginx.py'), str(target)], check=True)
        result = target.read_text()
        self.assertEqual(result.count('include /etc/nginx/snippets/server-monitor.conf;'), 1)
        self.assertEqual(result.count('access_log /var/log/personal-homepage-monitor/traffic.jsonl'), 1)
        self.assertIn('location /study/', result)

    def test_shell_prepares_private_services_before_compiled_gate_and_reverts_nginx_first(self):
        source = (REPO / 'deploy/deploy-from-image.sh').read_text()
        self.assertLess(source.index('install-grafana.py prepare'), source.index('install-http-metrics.py prepare'))
        self.assertLess(source.index('install-http-metrics.py prepare'), source.index('install-monitor-exporters.py prepare'))
        self.assertLess(source.index('verify-monitor-runtime.py --image'), source.index('sudo systemctl reload nginx', source.index('nginx_backup="$(mktemp')))
        self.assertLess(source.index('if restore_nginx;'), source.index('install-grafana.py rollback'))
        self.assertLess(source.index('verify-grafana.py'), source.index('install-grafana.py commit'))


if __name__ == '__main__':
    unittest.main()

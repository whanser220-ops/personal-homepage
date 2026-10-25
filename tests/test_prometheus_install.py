"""Transactional deployment guarantees without systemd, Docker, or credentials."""
import importlib.util
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import call, patch

try:
    import pwd
except ImportError:
    sys.modules.setdefault('pwd', types.ModuleType('pwd'))

spec = importlib.util.spec_from_file_location(
    'prometheus_install', Path(__file__).resolve().parents[1] / 'deploy/install-prometheus.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class PrometheusInstallTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        if not hasattr(installer.os, 'fchmod'):
            self.enterContext(patch.object(installer.os, 'fchmod', create=True))
        for name, value in [('BACKUP', self.root / 'backup'), ('WEB_ENV', self.root / 'web.env'),
                            ('RELEASE', self.root / 'release'), ('ARCHIVE', self.root / 'release.tar.gz')]:
            self.enterContext(patch.object(installer, name, value))

    def prepared(self):
        installer.BACKUP.mkdir()
        (installer.BACKUP / 'metadata.json').write_text('{}')

    def test_shadow_never_changes_web_reader_or_stops_legacy_collector(self):
        standard = types.SimpleNamespace(prepare=lambda: None, commit=lambda: None)
        with patch.object(installer.sys, 'argv', ['install-prometheus.py', 'shadow']), \
                patch.object(installer.os, 'geteuid', return_value=0, create=True), \
                patch.object(installer, 'standard_exporters', return_value=standard), \
                patch.object(standard, 'prepare') as prepare, patch.object(standard, 'commit') as commit, \
                patch.object(installer, 'cutover') as cutover, patch.object(installer, 'finalize') as finalize:
            installer.main()
            prepare.assert_called_once_with()
            commit.assert_called_once_with()
            cutover.assert_not_called()
            finalize.assert_not_called()

    def test_prepare_verification_failure_restores_transaction(self):
        with patch.object(installer, 'snapshot') as snapshot, \
                patch.object(installer, 'standard_exporters', return_value=types.SimpleNamespace(verify=lambda: None)), \
                patch.object(installer, 'install_runtime') as runtime, \
                patch.object(installer, 'verify', side_effect=RuntimeError('stale')), \
                patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'stale'):
                installer.prepare()
            snapshot.assert_called_once_with()
            runtime.assert_called_once_with()
            rollback.assert_called_once_with()

    def test_unhealthy_shadow_never_snapshots_or_restarts_production(self):
        def unavailable():
            raise RuntimeError('shadow incomplete')
        with patch.object(installer, 'standard_exporters', return_value=types.SimpleNamespace(verify=unavailable)), \
                patch.object(installer, 'snapshot') as snapshot, patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'shadow incomplete'):
                installer.prepare()
            snapshot.assert_not_called()
            rollback.assert_not_called()

    def test_cutover_preserves_oauth_and_records_first_switch_once(self):
        self.prepared()
        installer.WEB_ENV.write_text('MONITOR_GOOGLE_CLIENT_ID=existing\nMONITOR_GOOGLE_CLIENT_SECRET=private\nMONITOR_INGEST_TOKEN=rollback-token\n')
        with patch.object(installer, 'verify'), patch.object(installer, 'network_gateway', return_value='172.20.0.1'):
            installer.cutover()
            first = installer.read_env(installer.WEB_ENV)
            installer.cutover()
            second = installer.read_env(installer.WEB_ENV)
        self.assertEqual(first, second)
        self.assertEqual(first['MONITOR_DATA_BACKEND'], 'prometheus')
        self.assertEqual(first['MONITOR_EXPORTER_MODE'], 'standard')
        self.assertEqual(first['MONITOR_PROMETHEUS_URL'], 'http://172.20.0.1:19091')
        self.assertEqual(first['MONITOR_GOOGLE_CLIENT_SECRET'], 'private')
        self.assertEqual(first['MONITOR_INGEST_TOKEN'], 'rollback-token')
        self.assertTrue(first['MONITOR_PROMETHEUS_CUTOVER_AT'].endswith('Z'))

    def test_production_transaction_does_not_rewrite_legacy_python_exporter(self):
        paths = {path.as_posix() for path in installer.TARGETS}
        self.assertNotIn('/opt/personal-homepage-monitor/exporter.py', paths)
        self.assertNotIn('/opt/personal-homepage-monitor/collector.py', paths)
        self.assertNotIn('/etc/systemd/system/personal-homepage-monitor-exporter.service', paths)
        self.assertNotIn(installer.EXPORTER, installer.UNITS)

    def test_cutover_requires_prepared_transaction(self):
        with self.assertRaisesRegex(RuntimeError, 'prepared'):
            installer.cutover()
        self.assertFalse(installer.WEB_ENV.exists())

    def test_finalize_rechecks_freshness_before_disabling_old_collector(self):
        installer.WEB_ENV.write_text('MONITOR_DATA_BACKEND=prometheus\n')
        with patch.object(installer, 'verify', side_effect=RuntimeError('stale')), \
                patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'stale'):
                installer.finalize()
            run.assert_not_called()
        with patch.object(installer, 'verify'), patch.object(installer, 'run') as run:
            installer.finalize()
            run.assert_called_once_with('systemctl', 'disable', '--now', installer.LEGACY)

    def test_archive_checksum_is_checked_before_any_binary_execution(self):
        installer.ARCHIVE.write_bytes(b'wrong download')
        with patch.object(installer.platform, 'machine', return_value='x86_64'), patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'checksum'):
                installer.install_binaries()
            run.assert_not_called()
            self.assertFalse(installer.RELEASE.exists())

    def test_only_regular_known_binary_members_can_be_installed(self):
        with tarfile.open(installer.ARCHIVE, 'w:gz') as archive:
            member = tarfile.TarInfo(f'prometheus-{installer.VERSION}.linux-amd64/prometheus')
            member.type = tarfile.SYMTYPE
            member.linkname = '/etc/passwd'
            archive.addfile(member)
        checksum = installer.hashlib.sha256(installer.ARCHIVE.read_bytes()).hexdigest()
        with patch.object(installer, 'SHA256', checksum), \
                patch.object(installer.platform, 'machine', return_value='x86_64'), \
                patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'archive member'):
                installer.install_binaries()
            run.assert_not_called()
            self.assertFalse(installer.RELEASE.exists())

    def test_rollback_restores_env_files_and_prior_legacy_state(self):
        installer.BACKUP.mkdir()
        target = self.root / 'exporter.py'
        target.write_text('new exporter')
        installer.WEB_ENV.write_text('MONITOR_DATA_BACKEND=prometheus\n')
        (installer.BACKUP / '0').write_text('MONITOR_DATA_BACKEND=postgres\n')
        metadata = {'files': [
            {'path': str(installer.WEB_ENV), 'exists': True, 'mode': 0o600},
            {'path': str(target), 'exists': False, 'mode': None}],
            'units': {unit: {'active': unit == installer.LEGACY, 'enabled': unit == installer.LEGACY}
                      for unit in [*installer.UNITS, installer.LEGACY]}}
        (installer.BACKUP / 'metadata.json').write_text(json.dumps(metadata))
        with patch.object(installer, 'run') as run:
            installer.rollback()
        self.assertEqual(installer.WEB_ENV.read_text(), 'MONITOR_DATA_BACKEND=postgres\n')
        self.assertFalse(target.exists())
        self.assertFalse(installer.BACKUP.exists())
        self.assertIn(call('systemctl', 'enable', installer.LEGACY, check=False), run.call_args_list)
        self.assertIn(call('systemctl', 'start', installer.LEGACY, check=False), run.call_args_list)

    def test_failed_snapshot_cleans_incomplete_transaction_without_touching_targets(self):
        installer.WEB_ENV.write_text('existing configuration')
        with patch.object(installer, 'unit_state', side_effect=RuntimeError('systemd unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'systemd unavailable'):
                installer.snapshot()
        self.assertFalse(installer.BACKUP.exists())
        self.assertEqual(installer.WEB_ENV.read_text(), 'existing configuration')


if __name__ == '__main__':
    unittest.main()

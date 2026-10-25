"""Privacy HTTP instrumentation transaction, without systemd or cloud changes."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

try:
    import pwd
except ImportError:
    sys.modules.setdefault('pwd', types.ModuleType('pwd'))

spec = importlib.util.spec_from_file_location('http_metrics_install',
    Path(__file__).resolve().parents[1] / 'deploy/install-http-metrics.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class HttpMetricsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        for name, value in [('BACKUP', self.root / 'backup'), ('CONFIG', self.root / 'config.yml'),
                            ('UNIT_FILE', self.root / 'http.service'), ('LOG', self.root / 'traffic.jsonl'),
                            ('ARCHIVE', self.root / 'archive.tar.gz'), ('BINARY', self.root / 'binary')]:
            self.enterContext(patch.object(installer, name, value))
        if not hasattr(installer.os, 'fchmod'):
            self.enterContext(patch.object(installer.os, 'fchmod', create=True))

    def test_transaction_owns_only_config_and_unit_never_privacy_logs_or_web_env(self):
        self.assertEqual(len(installer.TARGETS), 2)
        self.assertFalse(any('traffic.jsonl' in str(path) or 'web.env' in str(path) or 'nginx' in str(path)
                             for path in installer.TARGETS))

    def test_missing_or_mismatched_artifact_never_executes(self):
        installer.ARCHIVE.write_bytes(b'untrusted')
        with patch.object(installer.platform, 'machine', return_value='x86_64'), patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'invalid pinned'):
                installer.install_binary()
            run.assert_not_called()
        self.assertFalse(installer.BINARY.exists())

    def test_archive_symlink_is_rejected_before_install(self):
        with tarfile.open(installer.ARCHIVE, 'w:gz') as archive:
            item = tarfile.TarInfo('prometheus-nginxlog-exporter')
            item.type, item.linkname = tarfile.SYMTYPE, '/bin/sh'
            archive.addfile(item)
        with patch.object(installer.platform, 'machine', return_value='x86_64'), \
                patch.object(installer, 'SHA256', installer.digest(installer.ARCHIVE)), patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'archive member'):
                installer.install_binary()
            run.assert_not_called()

    def test_only_known_regular_elf_member_is_extracted(self):
        payload = b'\x7fELF' + b'fixture' * 10
        with tarfile.open(installer.ARCHIVE, 'w:gz') as archive:
            item = tarfile.TarInfo('prometheus-nginxlog-exporter')
            item.size = len(payload)
            archive.addfile(item, io.BytesIO(payload))
            other = tarfile.TarInfo('../unrelated')
            other.size = 4
            archive.addfile(other, io.BytesIO(b'nope'))
        with patch.object(installer.platform, 'machine', return_value='x86_64'), \
                patch.object(installer, 'SHA256', installer.digest(installer.ARCHIVE)), patch.object(installer, 'run') as run:
            self.assertTrue(installer.install_binary())
            self.assertEqual(installer.BINARY.read_bytes(), payload)
            self.assertFalse((self.root.parent / 'unrelated').exists())
            self.assertFalse(installer.install_binary())
            self.assertEqual(run.call_count, 2)

    def test_prepare_failure_rolls_back_after_snapshot(self):
        with patch.object(installer, 'check_privacy_log'), patch.object(installer, 'check_port'), \
                patch.object(installer, 'snapshot') as snapshot, patch.object(installer, 'install_runtime'), \
                patch.object(installer, 'verify', side_effect=RuntimeError('parser')), patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'parser'):
                installer.prepare()
            snapshot.assert_called_once_with()
            rollback.assert_called_once_with()

    def test_preflight_failure_does_not_stop_existing_service(self):
        with patch.object(installer, 'check_privacy_log', side_effect=RuntimeError('permissions')), \
                patch.object(installer, 'snapshot') as snapshot, patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'permissions'):
                installer.prepare()
            snapshot.assert_not_called()
            rollback.assert_not_called()

    def test_rollback_restores_own_files_and_state_without_touching_traffic(self):
        installer.CONFIG.write_text('old config')
        installer.LOG.write_text('existing private numeric samples\n')
        targets = [installer.CONFIG, installer.UNIT_FILE]
        with patch.object(installer, 'TARGETS', targets), patch.object(installer, 'unit_state', return_value={'active': True, 'enabled': True}):
            installer.snapshot()
        installer.CONFIG.write_text('new config')
        installer.UNIT_FILE.write_text('new unit')
        with patch.object(installer, 'run') as run:
            installer.rollback()
        self.assertEqual(installer.CONFIG.read_text(), 'old config')
        self.assertFalse(installer.UNIT_FILE.exists())
        self.assertEqual(installer.LOG.read_text(), 'existing private numeric samples\n')
        self.assertTrue(any(call.args == ('systemctl', 'start', installer.UNIT) for call in run.call_args_list))
        self.assertFalse(installer.BACKUP.exists())

    def test_readiness_requires_zero_real_parse_errors_without_synthetic_requests(self):
        self.assertIn('parse_errors', installer.validate_metrics(b'server_monitor_ingress_parse_errors_total 0\n'))
        for payload in [b'', b'server_monitor_ingress_parse_errors_total 1\n',
                        b'server_monitor_ingress_parse_errors_total NaN\n',
                        b'server_monitor_ingress_parse_errors_total 0\nserver_monitor_ingress_parse_errors_total 0\n',
                        b'x' * (1024 * 1024 + 1)]:
            with self.assertRaises((RuntimeError, ValueError)):
                installer.validate_metrics(payload)

    def test_exporter_config_has_only_fixed_service_labels_and_low_cost_histogram(self):
        config = (installer.REPO / 'services/server-monitor/http-log-exporter.yml').read_text()
        self.assertIn('whitelist: [website, whiteboard, study-agent]', config)
        self.assertIn('print_log: false', config)
        self.assertNotRegex(config, r'(?i)\$(uri|remote_addr|request_uri|cookie|http_user_agent)')
        self.assertIn('port: 19111', config)


if __name__ == '__main__':
    unittest.main()

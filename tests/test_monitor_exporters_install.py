"""Official exporter shadow isolation and rollback, without host mutations."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import call, patch

try:
    import pwd
except ImportError:
    sys.modules.setdefault('pwd', types.ModuleType('pwd'))

spec = importlib.util.spec_from_file_location('monitor_exporters_install',
    Path(__file__).resolve().parents[1] / 'deploy/install-monitor-exporters.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class OfficialExporterInstallationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        if not hasattr(installer.os, 'fchmod'):
            self.enterContext(patch.object(installer.os, 'fchmod', create=True))
        self.enterContext(patch.object(installer, 'BACKUP', self.root / 'backup'))
        self.enterContext(patch.object(installer, 'WEB_ENV', self.root / 'web.env'))

    def test_shadow_targets_exclude_existing_production_config_env_and_exporter(self):
        targets = {str(path).replace('\\', '/') for path in installer.TARGETS}
        forbidden = {'/etc/personal-homepage-prometheus/prometheus.yml',
                     '/etc/personal-homepage-prometheus/node-host.rules.yml',
                     '/etc/personal-homepage-monitor/web.env',
                     '/opt/personal-homepage-monitor/exporter.py',
                     '/etc/systemd/system/personal-homepage-monitor-exporter.service'}
        self.assertFalse(targets & forbidden)
        self.assertTrue(any('/shadow/prometheus.yml' in target for target in targets))
        self.assertTrue(any('/custom/exporter.py' in target for target in targets))

    def test_all_artifacts_are_immutable_and_have_full_checksums(self):
        for name, artifact in installer.ARTIFACTS.items():
            self.assertRegex(artifact['sha256'], r'^[0-9a-f]{64}$')
            self.assertIn(artifact['version'], artifact['filename'])
            self.assertNotIn('latest', artifact['filename'])
            self.assertIn(name, ('node_exporter', 'blackbox_exporter', 'cadvisor'))

    def test_invalid_staged_artifact_never_executes_binary(self):
        with patch.object(installer, 'ROOT', self.root), patch.object(installer.platform, 'machine', return_value='x86_64'), \
                patch.object(installer, 'run') as run:
            source = self.root / 'downloads' / installer.ARTIFACTS['node_exporter']['filename']
            source.parent.mkdir()
            source.write_bytes(b'wrong artifact')
            with self.assertRaisesRegex(RuntimeError, 'invalid pinned'):
                installer.install_artifacts()
            run.assert_not_called()

    def test_shadow_installs_and_verifies_without_finalizing_old_service(self):
        with patch.object(installer.sys, 'argv', ['install-monitor-exporters.py', 'shadow']), \
                patch.object(installer.os, 'geteuid', create=True, return_value=0), \
                patch.object(installer, 'prepare') as prepare, patch.object(installer, 'commit') as commit, \
                patch.object(installer, 'finalize') as finalize:
            installer.main()
            prepare.assert_called_once_with()
            commit.assert_called_once_with()
            finalize.assert_not_called()

    def test_failed_validation_rolls_back_new_stack(self):
        with patch.object(installer, 'snapshot'), patch.object(installer, 'install_runtime'), \
                patch.object(installer, 'verify', side_effect=RuntimeError('unhealthy')), \
                patch.object(installer, 'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError, 'unhealthy'):
                installer.prepare()
            rollback.assert_called_once_with()

    def test_finalize_rejects_website_that_has_not_switched(self):
        installer.WEB_ENV.write_text('MONITOR_DATA_BACKEND=prometheus\n')
        with patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'not switched'):
                installer.finalize()
            run.assert_not_called()

    def test_finalize_does_not_retire_old_service_when_production_data_fails(self):
        installer.WEB_ENV.write_text('MONITOR_EXPORTER_MODE=standard\n')
        with patch.object(installer, 'verify', side_effect=RuntimeError('stale')), patch.object(installer, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'stale'):
                installer.finalize()
            run.assert_not_called()

    def test_rollback_restores_original_full_python_service_state(self):
        installer.BACKUP.mkdir()
        new_config = self.root / 'shadow.yml'
        new_config.write_text('new config')
        states = {name: {'active': name == installer.OLD_EXPORTER, 'enabled': name == installer.OLD_EXPORTER}
                  for name in [*installer.UNITS, installer.OLD_EXPORTER]}
        metadata = {'files': [{'path': str(new_config), 'exists': False, 'mode': None}], 'units': states}
        (installer.BACKUP / 'metadata.json').write_text(json.dumps(metadata))
        with patch.object(installer, 'run') as run:
            installer.rollback()
        self.assertFalse(new_config.exists())
        self.assertIn(call('systemctl', 'enable', installer.OLD_EXPORTER, check=False), run.call_args_list)
        self.assertIn(call('systemctl', 'start', installer.OLD_EXPORTER, check=False), run.call_args_list)

    def test_shadow_config_references_only_shadow_rules(self):
        rendered = installer.render_prometheus(shadow=True)
        self.assertIn(installer.SHADOW_RULES.as_posix(), rendered)
        self.assertNotIn('  - /etc/personal-homepage-prometheus/node-host.rules.yml', rendered)
        self.assertNotIn('job_name: server-monitor-host', rendered)
        self.assertNotIn('job_name: server-monitor-checks', rendered)
        for name in ('node', 'cadvisor', 'blackbox', 'custom'):
            self.assertIn('job_name: server-monitor-' + name, rendered)

    def test_node_unit_allows_netlink_and_overrides_partition_exclusion(self):
        with patch.object(installer, 'host_devices', return_value=('vda2', 'eth0')):
            value = installer.render_unit(installer.NODE)
        self.assertIn('RestrictAddressFamilies=AF_UNIX AF_INET AF_NETLINK', value)
        self.assertIn('--collector.diskstats.device-include=^vda2$', value)
        self.assertIn('--collector.diskstats.device-exclude=', value)
        self.assertNotIn('__ROOT_DEVICE__', value)

    def test_up_and_fresh_capture_cannot_hide_missing_normalized_rate(self):
        def query(expression, base):
            if expression.startswith('up{'):
                return [{'value': [1000, '1']}] * (6 if 'blackbox' in expression else 1)
            if expression.startswith(('server_monitor_host_collected_at_seconds{', 'server_monitor_custom_collected_at_seconds{')):
                return [{'value': [1000, '1000']}]
            if expression.startswith('node_scrape_collector_success{'):
                return [{'metric': {'collector': name}, 'value': [1000, '1']}
                        for name in ('cpu', 'diskstats', 'filesystem', 'loadavg', 'meminfo', 'netdev', 'stat', 'time', 'uname')]
            if expression.startswith('server_monitor_host_cpu_percent{'):
                return [{'value': [1000, '12']}]
            if expression.startswith('server_monitor_host_disk_read_bytes_per_second{'):
                return []
            self.fail('Readiness accepted a missing host rate')
        with patch.object(installer, 'query', side_effect=query), patch.object(installer.time, 'time', return_value=1000), \
                patch.object(installer.time, 'sleep') as sleep, patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'validation failed') as result:
                installer.verify(relay=False)
        self.assertIn('disk_read_bytes_per_second', str(result.exception.__cause__))
        self.assertEqual(sleep.call_count, 24)


if __name__ == '__main__':
    unittest.main()

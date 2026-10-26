"""Privacy rotation fixture isolation and unchanged least-privilege sandbox."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('monitor_logrotate',REPO/'deploy/verify-monitor-logrotate.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class PrivacyRotationTests(unittest.TestCase):
    def test_corrected_config_keeps_copytruncate_and_bounded_private_archives_without_setgid(self):
        value = fixture.candidate_config(Path('/run/fixture/logs/traffic.jsonl'))
        self.assertIn('copytruncate',value)
        self.assertIn('maxsize 10M',value)
        self.assertIn('rotate 2',value)
        self.assertNotIn('su root',value)
        self.assertNotIn('/var/log/personal-homepage-monitor',value)

    def test_fixture_replaces_every_live_state_and_log_path(self):
        command = fixture.rotation_command(Path('/run/fixture/state'),Path('/run/fixture/rotation.conf'))
        self.assertEqual(command,['/usr/sbin/logrotate','--force','--state','/run/fixture/state','/run/fixture/rotation.conf'])
        self.assertFalse(any('/etc/' in item or '/var/' in item for item in command))

    def test_real_manifest_sandbox_is_preserved_without_adding_identity_capabilities(self):
        settings = fixture.unit_properties(Path('/run/fixture'))
        self.assertIn('CapabilityBoundingSet=CAP_CHOWN CAP_DAC_OVERRIDE CAP_FOWNER',settings)
        self.assertIn('ProtectSystem=strict',settings)
        self.assertIn('PrivateTmp=true',settings)
        self.assertIn('ReadWritePaths=/run/fixture',settings)
        self.assertFalse(any('CAP_SETUID' in value or 'CAP_SETGID' in value for value in settings))


if __name__ == '__main__':
    unittest.main()

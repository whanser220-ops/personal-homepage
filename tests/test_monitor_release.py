"""First-install readiness checks; no Docker, network, or real sleeps."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import call, patch


spec = importlib.util.spec_from_file_location(
    'verify_server_monitor', Path(__file__).resolve().parents[1] / 'deploy/verify-server-monitor.py')
monitor_release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor_release)


class FreshSampleReadinessTests(unittest.TestCase):
    def test_first_install_database_errors_then_first_sample_succeed(self):
        failures = [
            subprocess.CalledProcessError(1, ['psql'], stderr='relation monitor_samples does not exist'),
            subprocess.TimeoutExpired(['psql'], timeout=10),
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__), \
                    patch.object(monitor_release, 'database_query', side_effect=[failure, '', '', '12', '18']) as query, \
                    patch.object(monitor_release.time, 'sleep') as sleep:
                monitor_release.wait_for_fresh_sample()
                self.assertEqual(query.call_count, 5)
                self.assertEqual(sleep.call_args_list, [call(5), call(5)])

    def test_missing_or_stale_samples_exhaust_bounded_retries(self):
        for age in ['', '46', '-6']:
            with self.subTest(age=age), \
                    patch.object(monitor_release, 'database_query', return_value=age) as query, \
                    patch.object(monitor_release.time, 'sleep') as sleep:
                with self.assertRaisesRegex(RuntimeError, 'No fresh host and checks snapshots after deployment'):
                    monitor_release.wait_for_fresh_sample()
                self.assertEqual(query.call_count, 24)
                self.assertEqual(sleep.call_args_list, [call(5)] * 11)

    def test_freshness_boundaries_succeed_without_retrying(self):
        for age in ['-5', '0', '45']:
            with self.subTest(age=age), \
                    patch.object(monitor_release, 'database_query', return_value=age) as query, \
                    patch.object(monitor_release.time, 'sleep') as sleep:
                monitor_release.wait_for_fresh_sample()
                self.assertEqual(query.call_count, 2)
                sleep.assert_not_called()

    def test_fresh_host_waits_for_independently_fresh_checks(self):
        with patch.object(monitor_release, 'database_query', side_effect=['1', '60', '2', '4']) as query, \
                patch.object(monitor_release.time, 'sleep') as sleep:
            monitor_release.wait_for_fresh_sample()
            self.assertEqual(query.call_count, 4)
            sleep.assert_called_once_with(5)


if __name__ == '__main__':
    unittest.main()

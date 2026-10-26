"""The privacy log has a lifecycle independent of the removed dashboard."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

REPO=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('rotation_install',REPO/'deploy/install-monitor-logrotate.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)


class RotationInstallerTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);self.root=Path(temp.name)
        self.enterContext(patch.object(installer,'BACKUP',self.root/'backup'))
        if not hasattr(installer.os,'fchmod'):self.enterContext(patch.object(installer.os,'fchmod',create=True))

    def test_fixture_failure_prevents_snapshot_and_live_changes(self):
        with patch.object(installer,'run',side_effect=RuntimeError('fixture')),patch.object(installer,'snapshot') as snapshot,patch.object(installer,'install_runtime') as install:
            with self.assertRaisesRegex(RuntimeError,'fixture'):installer.prepare()
            snapshot.assert_not_called();install.assert_not_called()

    def test_failed_normal_rotation_rolls_back_unit_and_policy(self):
        with patch.object(installer,'run'),patch.object(installer,'snapshot'),patch.object(installer,'install_runtime'),patch.object(installer,'verify',side_effect=RuntimeError('normal rotation')),patch.object(installer,'rollback') as rollback:
            with self.assertRaisesRegex(RuntimeError,'normal rotation'):installer.prepare()
            rollback.assert_called_once_with()

    def test_actual_log_inode_and_rotation_state_are_never_snapshot_restore_targets(self):
        self.assertEqual(installer.CONFIG.as_posix(),'/etc/personal-homepage-monitor/traffic.logrotate')
        self.assertNotIn(installer.LOG,installer.TARGETS)
        self.assertFalse(any('grafana' in str(path) or 'status' in str(path) for path in installer.TARGETS))
        source=(REPO/'deploy/install-monitor-logrotate.py').read_text()
        self.assertNotIn('--force',source)
        self.assertNotIn('install-grafana',source)

    def test_runtime_starts_normal_oneshot_not_just_timer_or_debug_check(self):
        source=(REPO/'deploy/install-monitor-logrotate.py').read_text()
        self.assertIn("run('systemctl','start',SERVICE)",source)
        self.assertIn("result.get('Result')!='success'",source)
        unit=(REPO/'services/server-monitor/personal-homepage-monitor-logrotate.service').read_text()
        self.assertIn('/etc/personal-homepage-monitor/traffic.logrotate',unit)
        self.assertNotIn('grafana',unit)

    def test_rollback_restores_policy_permissions_without_replacing_live_log(self):
        target=self.root/'policy';target.write_text('old')
        log=self.root/'traffic.jsonl';log.write_text('preserved');inode=log.stat().st_ino
        with patch.object(installer,'TARGETS',[target]),patch.object(installer,'unit_state',return_value={'active':False,'enabled':False}):installer.snapshot()
        target.write_text('new')
        with patch.object(installer,'run'),patch.object(installer.os,'chown',create=True):installer.rollback()
        self.assertEqual(target.read_text(),'old');self.assertEqual(log.read_text(),'preserved');self.assertEqual(log.stat().st_ino,inode)


if __name__=='__main__':unittest.main()

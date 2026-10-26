"""Fixed-role retirement, late cutover and reversible lifecycle boundaries."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

REPO=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('retire_monitor',REPO/'deploy/retire-grafana.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)


def role(login=True):
    return {'login':login,'super':False,'createDb':False,'createRole':False,'inherit':False,
        'replication':False,'bypassRls':False,'connections':2,
        'comment':'personal-homepage-grafana-history:'+'a'*32}


class RetirementTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        self.enterContext(patch.object(installer,'BACKUP',self.root/'backup'))
        if not hasattr(installer.os,'fchmod'):self.enterContext(patch.object(installer.os,'fchmod',create=True))

    def snapshot(self):
        with patch.object(installer,'role_state',return_value=role()),patch.object(installer,'unit_state',return_value={'active':True,'enabled':True}):
            installer.prepare()

    def test_prepare_only_snapshots_without_service_or_database_mutation(self):
        with patch.object(installer,'role_state',return_value=role()),patch.object(installer,'unit_state',return_value={'active':True,'enabled':True}),patch.object(installer,'run') as run,patch.object(installer,'set_login') as login:
            installer.prepare();run.assert_not_called();login.assert_not_called()
        self.assertFalse(json.loads((installer.BACKUP/'state.json').read_text())['touched'])

    def test_role_profile_guard_rejects_unowned_or_privileged_role(self):
        for key,value in [('super',True),('inherit',True),('connections',-1),('comment','some-other-role')]:
            changed=role();changed[key]=value
            with self.assertRaises(RuntimeError):installer.validate_role(changed)
        installer.validate_role(None);installer.validate_role(role(False))

    def test_finalize_closes_service_connections_before_disabling_fixed_login(self):
        self.snapshot();events=[]
        with patch.object(installer,'role_state',return_value=role()),patch.object(installer,'unit_state',return_value={'active':False,'enabled':True}),patch.object(installer,'run',side_effect=lambda *a,**k:events.append(a)),patch.object(installer,'set_login',side_effect=lambda value:events.append(('login',value))),patch.object(installer,'verify'):
            installer.finalize()
        self.assertEqual(events,[('systemctl','stop',installer.SERVICE),('systemctl','disable',installer.SERVICE),('login',False)])

    def test_concurrent_role_change_fails_before_stopping_service(self):
        self.snapshot()
        with patch.object(installer,'role_state',return_value=role(False)),patch.object(installer,'run') as run:
            with self.assertRaisesRegex(RuntimeError,'changed'):installer.finalize()
            run.assert_not_called()

    def test_failed_stop_never_disables_database_login(self):
        self.snapshot()
        with patch.object(installer,'role_state',return_value=role()),patch.object(installer,'unit_state',return_value={'active':True,'enabled':True}),patch.object(installer,'run'),patch.object(installer,'set_login') as login:
            with self.assertRaisesRegex(RuntimeError,'did not stop'):installer.finalize()
            login.assert_not_called()

    def test_rollback_restores_login_before_start_and_does_not_touch_data(self):
        self.snapshot();metadata=json.loads((installer.BACKUP/'state.json').read_text());metadata['touched']=True;installer.save(metadata)
        events=[]
        with patch.object(installer,'role_state',return_value=role(False)),patch.object(installer,'set_login',side_effect=lambda value:events.append(('login',value))),patch.object(installer,'run',side_effect=lambda *a,**k:events.append(a)):
            installer.rollback()
        self.assertEqual(events,[('login',True),('systemctl','enable',installer.SERVICE),('systemctl','start',installer.SERVICE)])
        self.assertFalse(installer.BACKUP.exists())

    def test_verify_rejects_remaining_port_even_if_service_and_login_are_off(self):
        output=subprocess.CompletedProcess([],0,'LISTEN 0 128 127.0.0.1:19110 0.0.0.0:*\n','')
        with patch.object(installer,'unit_state',return_value={'active':False,'enabled':False}),patch.object(installer,'role_state',return_value=role(False)),patch.object(installer,'run',return_value=output):
            with self.assertRaisesRegex(RuntimeError,'port'):installer.verify()

    def test_retirement_occurs_after_custom_runtime_web_and_public_verification(self):
        source=(REPO/'deploy/deploy-from-image.sh').read_text()
        self.assertLess(source.index('deploy/verify-monitor-runtime.py --image'),source.index('deploy/install-prometheus.py cutover'))
        self.assertLess(source.index('sudo python3 deploy/verify-server-monitor.py'),source.index('sudo python3 deploy/retire-grafana.py finalize'))
        self.assertLess(source.index('sudo python3 deploy/retire-grafana.py finalize'),source.index('sudo python3 deploy/retire-grafana.py commit'))
        self.assertLess(source.index('if restore_nginx;'),source.index('deploy/retire-grafana.py rollback'))
        for obsolete in ('install-grafana.py','install-grafana-history.py','verify-grafana.py'):self.assertNotIn(obsolete,source)

    def test_public_retired_paths_are_no_store_404_without_proxy_or_identity(self):
        source=(REPO/'deploy/nginx-server-monitor.conf').read_text()
        for path in ('= /server-monitor/grafana','^~ /server-monitor/grafana/','= /api/monitor/auth/grafana','^~ /api/monitor/auth/grafana/','= /_monitor_grafana_auth'):
            block=source.split('location '+path+' {',1)[1].split('}',1)[0]
            self.assertIn('return 404;',block);self.assertIn('"no-store" always',block);self.assertNotIn('proxy_pass',block)
        self.assertNotIn('19110',source);self.assertNotIn('auth_request',source)
        privacy=(REPO/'deploy/nginx-monitor-http.conf').read_text()
        self.assertNotIn('monitor_grafana_cache_control',privacy)
        self.assertIn('text/event-stream',privacy);self.assertIn('$http_upgrade',privacy)


if __name__=='__main__':unittest.main()

"""Candidate gate isolation, cleanup and deployment ordering without Docker."""
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('monitor_runtime', REPO / 'deploy/verify-monitor-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class CompiledRuntimeGateTests(unittest.TestCase):
    def setUp(self):
        self.identity = 'a' * 32
        self.enterContext(patch.object(runtime.uuid, 'uuid4', return_value=SimpleNamespace(hex=self.identity)))
        self.commands = []

    def response(self, code=0, stdout='', stderr=''):
        return subprocess.CompletedProcess([], code, stdout, stderr)

    def docker(self, *args, **kwargs):
        self.commands.append(args)
        if args[:2] == ('network', 'inspect'):
            return self.response(stdout=json.dumps([{'IPAM': {'Config': [{'Gateway': '172.20.0.1'}]}}]))
        if args[0] == 'run':
            return self.response(stdout='candidate-container-id\n')
        if args[0] == 'exec':
            return self.response(stdout=json.dumps({'test': 'compiled-next-runtime', 'current': 200,
                'customPage':200,'retiredAuthorization':404,
                'signals':{key:{} for key in ('all','website','whiteboard','study-agent')}}))
        if args[0] == 'inspect':
            return self.response(stdout=json.dumps({runtime.LABEL: self.identity}))
        if args[:2] == ('rm', '--force'):
            return self.response()
        self.fail('Unexpected Docker operation')

    def test_candidate_uses_real_server_loopback_and_no_production_secrets_or_ports(self):
        with patch.object(runtime, 'docker', side_effect=self.docker), patch('builtins.print'):
            runtime.verify_runtime('registry/site:target')
        arguments = next(args for args in self.commands if args[0] == 'run')
        self.assertEqual(arguments[-4:], ('registry/site:target', '--import', '/probe/monitor-runtime-fixture.mjs', '/app/server.js'))
        self.assertIn('HOSTNAME=127.0.0.1', arguments)
        self.assertIn('DATABASE_URL=postgresql://fixture.invalid/noop', arguments)
        self.assertIn('MONITOR_PROMETHEUS_URL=http://172.20.0.1:19091', arguments)
        for forbidden in ('--env-file', '--publish', '-p', '--privileged', '/var/run/docker.sock'):
            self.assertNotIn(forbidden, arguments)
        self.assertFalse(any('MONITOR_GOOGLE_CLIENT_SECRET=' in value or '/etc/personal-homepage' in value for value in arguments))
        self.assertTrue(any(args[0] == 'exec' and args[-1] == '/probe/monitor-runtime-probe.mjs' for args in self.commands))
        self.assertEqual(self.commands[-1], ('rm', '--force', 'monitor-runtime-probe-' + self.identity[:12]))

    def test_failed_compiled_routes_still_remove_only_owned_candidate(self):
        def docker(*args, **kwargs):
            if args[0] == 'exec':
                self.commands.append(args)
                return self.response(1, stderr='runtime_current_http_503\n')
            return self.docker(*args, **kwargs)
        with patch.object(runtime, 'docker', side_effect=docker):
            with self.assertRaisesRegex(RuntimeError, 'runtime_current_http_503'):
                runtime.verify_runtime('registry/site:broken')
        self.assertEqual(self.commands[-1], ('rm', '--force', 'monitor-runtime-probe-' + self.identity[:12]))

    def test_standard_candidate_reads_only_explicit_shadow_source_with_same_isolation(self):
        with patch.object(runtime, 'docker', side_effect=self.docker), patch('builtins.print'):
            runtime.verify_runtime('registry/site:target', exporter_mode='standard', prometheus_port=19095)
        arguments = next(args for args in self.commands if args[0] == 'run')
        self.assertIn('MONITOR_PROMETHEUS_URL=http://172.20.0.1:19095', arguments)
        self.assertIn('MONITOR_EXPORTER_MODE=standard', arguments)
        self.assertNotIn('--publish', arguments)
        self.assertNotIn('--env-file', arguments)

    def test_invalid_source_is_rejected_before_docker_or_any_container(self):
        with patch.object(runtime, 'docker') as docker:
            for settings in ({'exporter_mode': 'unknown'}, {'prometheus_port': 19092}, {'prometheus_port': 8080}):
                with self.assertRaisesRegex(RuntimeError, 'invalid_source'):
                    runtime.verify_runtime('registry/site:target', **settings)
            docker.assert_not_called()

    def test_cleanup_refuses_container_with_different_identity(self):
        with patch.object(runtime, 'docker', return_value=self.response(stdout=json.dumps({runtime.LABEL: 'another-task'}))) as docker:
            with self.assertRaisesRegex(RuntimeError, 'cleanup_identity_mismatch'):
                runtime.cleanup('monitor-runtime-probe-owned-name', self.identity)
        self.assertEqual(docker.call_count, 1)

    def test_cleanup_does_not_hide_unavailable_docker(self):
        with patch.object(runtime, 'docker', return_value=self.response(1, stderr='Cannot connect to Docker daemon')):
            with self.assertRaisesRegex(RuntimeError, 'cleanup_unavailable'):
                runtime.cleanup('monitor-runtime-probe-owned-name', self.identity)

    def test_gate_is_after_shadow_readiness_and_before_cutover(self):
        script = (REPO / 'deploy/deploy-from-image.sh').read_text(encoding='utf-8')
        shadow = script.index('sudo python3 deploy/install-monitor-exporters.py prepare')
        probe = script.index('sudo python3 deploy/verify-monitor-runtime.py --image')
        prepare = script.index('sudo python3 deploy/install-prometheus.py prepare')
        cutover = script.index('sudo python3 deploy/install-prometheus.py cutover')
        recreate = script.index('compose_cli -f "$COMPOSE_FILE" up -d --no-build --force-recreate "$COMPOSE_SERVICE"', cutover)
        self.assertLess(shadow, probe)
        self.assertLess(probe, prepare)
        self.assertLess(prepare, cutover)
        self.assertLess(cutover, recreate)


if __name__ == '__main__':
    unittest.main()

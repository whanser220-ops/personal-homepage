"""Custom-only exporter tests: real loopback HTTP and fixed probe boundaries."""
import concurrent.futures
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
import urllib.error
import urllib.request

import exporter


CONTAINER_ID = "a" * 64


def custom_sample(*_):
    return {
        "containers": [{"name": "personal-homepage", "containerId": CONTAINER_ID,
                        "image": 'homepage:abc"\\one\ntwo', "state": "running", "health": "healthy", "restartCount": 0},
                       {"name": "learning-whiteboard", "containerId": None, "image": None,
                        "state": "unknown", "health": "unknown", "restartCount": None}],
        "services": [{"id": "study-agent", "name": "Study Agent 进程", "kind": "process",
                      "status": "healthy", "detail": 'systemd active; "只验证进程"'},
                     {"id": "postgres", "name": "PostgreSQL", "kind": "process", "status": "unknown",
                      "detail": "无法运行容器内 pg_isready"}],
    }


@contextmanager
def live_server(state, max_requests=4):
    server = exporter.MetricsServer((exporter.LISTEN_HOST, 0), state, max_requests=max_requests)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    worker.start()
    try:
        yield server
    finally:
        server.shutdown()
        worker.join(timeout=5)
        server.server_close()
        state.close()


def request(server, path="/metrics/custom", method="GET"):
    url = "http://127.0.0.1:" + str(server.server_port) + path
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=2)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode("utf-8")


class RenderingTests(unittest.TestCase):
    def test_custom_contract_contains_only_metadata_restarts_and_process_checks(self):
        text = exporter.render_custom("cloud-primary", custom_sample(), 123.75).decode("utf-8")
        self.assertIn('server_monitor_custom_collected_at_seconds{host_id="cloud-primary"} 123.75\n', text)
        self.assertIn('container_id="' + CONTAINER_ID + '"', text)
        self.assertIn('image="homepage:abc\\"\\\\one\\ntwo"', text)
        self.assertIn('server_monitor_custom_container_restart_count{host_id="cloud-primary",name="personal-homepage",container_id="' + CONTAINER_ID + '"} 0\n', text)
        self.assertIn('kind="process",status="healthy"', text)
        self.assertIn('只验证进程', text)
        for forbidden in ("host_cpu", "host_memory", "container_cpu", "container_memory", "service_latency", "service_http_status"):
            self.assertNotIn(forbidden, text)
        self.assertTrue(text.endswith("\n"))

    def test_unknown_container_identity_and_restarts_are_omitted_instead_of_fabricated(self):
        text = exporter.render_custom("cloud-primary", custom_sample(), 125).decode("utf-8")
        whiteboard = next(line for line in text.splitlines() if line.startswith("server_monitor_custom_container_info") and 'name="learning-whiteboard"' in line)
        self.assertNotIn("container_id", whiteboard)
        self.assertIn('image="",state="unknown",health="unknown"', whiteboard)
        self.assertNotIn('container_restart_count{host_id="cloud-primary",name="learning-whiteboard"', text)
        self.assertEqual(text.count("# TYPE server_monitor_custom_container_info gauge\n"), 1)

    def test_nonfinite_or_unknown_numbers_are_omitted_real_zero_is_kept(self):
        text = exporter.MetricsText()
        for value in (None, float("nan"), float("inf"), True, "invalid"):
            text.gauge("invalid", value, {"host_id": "test"})
        text.gauge("valid", 0, {"host_id": "test"})
        self.assertNotIn("invalid", text.encode().decode())
        self.assertIn('valid{host_id="test"} 0\n', text.encode().decode())


class ProbeTests(unittest.TestCase):
    def test_docker_inspect_reads_fixed_metadata_and_never_stats_env_or_health_logs(self):
        lines = [json.dumps({"name": "/personal-homepage", "containerId": CONTAINER_ID,
                             "image": "homepage:abc", "state": "running", "health": "healthy", "restartCount": 0}),
                 json.dumps({"name": "/personal-homepage-postgres", "containerId": "b" * 64,
                             "image": "postgres:17-alpine", "state": "running", "health": None, "restartCount": 7}),
                 json.dumps({"name": "/foreign-container", "containerId": "b" * 64, "restartCount": 50}), "not json"]
        with mock.patch.object(exporter, "command", return_value=(1, "\n".join(lines))) as command:
            result = exporter.collect_container_metadata()
        argv = command.call_args.args[0]
        self.assertEqual(argv[:3], ["docker", "inspect", "--format"])
        self.assertEqual(argv[4:], list(exporter.CONTAINER_NAMES))
        for field in (".Id", ".Name", ".Config.Image", ".State.Status", 'index .State "Health"', ".RestartCount"):
            self.assertIn(field, argv[3])
        self.assertIn('{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}}', argv[3])
        self.assertNotIn(".State.Health", argv[3])
        for forbidden in (".Env", ".Log", "stats", "--all"):
            self.assertNotIn(forbidden, " ".join(argv))
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["containerId"], CONTAINER_ID)
        self.assertEqual(result[0]["restartCount"], 0)
        self.assertEqual(result[1]["state"], "unknown")
        self.assertIsNone(result[1]["containerId"])
        self.assertEqual(result[2]["containerId"], "b" * 64)
        self.assertEqual(result[2]["state"], "running")
        self.assertEqual(result[2]["health"], "unknown")
        self.assertEqual(result[2]["restartCount"], 7)

    def test_invalid_container_identity_counts_and_metadata_stay_unknown(self):
        for identity in ("short", "A" * 64, 123, None):
            line = json.dumps({"name": "/personal-homepage", "containerId": identity,
                               "restartCount": True, "image": {"unexpected": "object"}, "state": "invented", "health": "secret text"})
            with mock.patch.object(exporter, "command", return_value=(0, line)):
                container = exporter.collect_container_metadata()[0]
            self.assertIsNone(container["containerId"])
            self.assertIsNone(container["restartCount"])
            self.assertIsNone(container["image"])
            self.assertEqual(container["state"], "unknown")
            self.assertEqual(container["health"], "unknown")

    def test_systemd_only_fixed_fields_and_units_keep_process_semantics(self):
        output = ("Id=study-agent.service\nLoadState=masked\nActiveState=active\n\n"
                  "Id=study-agent-remote.service\nLoadState=loaded\nActiveState=failed\n\n"
                  "Id=nginx.service\nLoadState=not-found\nActiveState=inactive\n\n"
                  "Id=docker.service\nLoadState=error\nActiveState=inactive\n")
        with mock.patch.object(exporter, "command", return_value=(1, output)) as command:
            result = exporter.systemd_probes()
        self.assertEqual(command.call_args.args[0], ["systemctl", "show", "--property=Id,LoadState,ActiveState", *[item[2] for item in exporter.SYSTEMD_SERVICES]])
        self.assertEqual([item["status"] for item in result], ["healthy", "unhealthy", "unknown", "unhealthy"])
        self.assertTrue(all(item["kind"] == "process" for item in result))
        with mock.patch.object(exporter, "command", return_value=(None, "")):
            self.assertTrue(all(item["status"] == "unknown" for item in exporter.systemd_probes()))

    def test_postgres_readiness_uses_quiet_container_identity_without_exporting_output(self):
        for code, status in ((0, "healthy"), (1, "unhealthy"), (2, "unhealthy"), (3, "unknown"), (None, "unknown")):
            with mock.patch.object(exporter, "command", return_value=(code, "secret output")) as command:
                result = exporter.postgres_probe()
            self.assertEqual(result["status"], status)
            self.assertEqual(result["kind"], "process")
            self.assertNotIn("secret", json.dumps(result))
            argv = command.call_args.args[0]
            self.assertEqual(argv[:5], ["docker", "exec", "personal-homepage-postgres", "sh", "-c"])
            self.assertIn("pg_isready -q", argv[5])
            self.assertIn("POSTGRES_USER", argv[5])
            self.assertNotIn("PASSWORD", argv[5])

    def test_custom_batch_only_runs_the_three_allowed_commands(self):
        def output(argv, timeout=exporter.PROBE_TIMEOUT):
            if argv[:2] == ["docker", "inspect"]:
                return 0, ""
            if argv[:2] == ["systemctl", "show"]:
                return 0, ""
            if argv[:2] == ["docker", "exec"]:
                return 0, ""
            raise AssertionError("unexpected command")
        with mock.patch.object(exporter, "command", side_effect=output) as command, \
             concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            result = exporter.collect_custom(pool)
        self.assertEqual(command.call_count, 3)
        self.assertEqual(len(result["containers"]), 3)
        self.assertEqual(len(result["services"]), 5)
        self.assertEqual(result["services"][-1]["id"], "postgres")
        self.assertTrue(all(item["kind"] == "process" for item in result["services"]))

    def test_probe_failures_finish_other_jobs_and_never_expose_exceptions(self):
        with mock.patch.object(exporter, "collect_container_metadata", side_effect=RuntimeError("secret inspect")), \
             mock.patch.object(exporter, "systemd_probes", side_effect=RuntimeError("secret systemd")), \
             mock.patch.object(exporter, "postgres_probe", side_effect=RuntimeError("secret postgres")), \
             concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool, \
             self.assertLogs("server-monitor-exporter", level="WARNING") as logs:
            result = exporter.collect_custom(pool)
        self.assertEqual(len(result["containers"]), 3)
        self.assertEqual(len(result["services"]), 5)
        self.assertNotIn("secret", json.dumps(result) + " ".join(logs.output))
        self.assertTrue(all(item["status"] == "unknown" for item in result["services"]))
        text = exporter.render_custom("cloud-primary", result, 100).decode()
        self.assertIn('image="",state="unknown",health="unknown"', text)
        self.assertNotIn('image="unknown"', text)

    def test_command_timeout_and_os_failures_are_bounded_and_discard_stderr(self):
        with mock.patch.object(exporter.subprocess, "run", return_value=mock.Mock(returncode=0, stdout="x" * 70000, stderr="secret")) as run:
            code, output = exporter.command(["docker", "inspect"])
        self.assertEqual(code, 0)
        self.assertEqual(len(output), 65536)
        self.assertEqual(run.call_args.kwargs["timeout"], 3)
        for error in (OSError("secret"), subprocess.TimeoutExpired("fixed", 3)):
            with mock.patch.object(exporter.subprocess, "run", side_effect=error):
                self.assertEqual(exporter.command(["docker", "inspect"]), (None, ""))


class SchedulingTests(unittest.TestCase):
    def test_nonoverlap_returns_cached_original_timestamp_without_recollecting(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def collect(pool):
            calls.append(pool)
            if len(calls) == 2:
                entered.set()
                if not release.wait(3):
                    raise RuntimeError("not released")
            return custom_sample()
        state = exporter.Exporter(custom_sampler=collect, clock=mock.Mock(side_effect=[100, 115]), monotonic=mock.Mock(side_effect=[0, 15]))
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            try:
                original = state.scrape()
                slow = pool.submit(state.scrape)
                self.assertTrue(entered.wait(1))
                self.assertIs(state.scrape(), original)
                self.assertEqual(len(calls), 2)
                self.assertIs(calls[0], calls[1])
                self.assertEqual(calls[0]._max_workers, 3)
                self.assertIn(b'} 100\n', original)
                release.set()
                self.assertIn(b'} 115\n', slow.result(timeout=2))
            finally:
                release.set()
                state.close()

    def test_failed_collection_does_not_make_a_cached_snapshot_fresh(self):
        state = exporter.Exporter(custom_sampler=custom_sample, clock=lambda: 100, monotonic=mock.Mock(side_effect=[0, 15]))
        try:
            self.assertIsNotNone(state.scrape())
            state.custom_sampler = mock.Mock(side_effect=RuntimeError("private details"))
            with self.assertLogs("server-monitor-exporter", level="WARNING") as logs:
                self.assertIsNone(state.scrape())
            self.assertNotIn("private", " ".join(logs.output))
        finally:
            state.close()

    def test_shadow_duplicate_scrapes_reuse_snapshot_without_extending_its_age(self):
        sampler = mock.Mock(side_effect=custom_sample)
        clock = mock.Mock(side_effect=[100, 114.001])
        state = exporter.Exporter(custom_sampler=sampler, clock=clock, monotonic=mock.Mock(side_effect=[0, 1, 13.999, 14.001]))
        try:
            first = state.scrape()
            self.assertIs(state.scrape(), first)
            self.assertIs(state.scrape(), first)
            self.assertIn(b'} 114.001\n', state.scrape())
            self.assertEqual(sampler.call_count, 2)
            self.assertEqual(clock.call_count, 2)
        finally:
            state.close()

    def test_normal_fifteen_second_scrape_jitter_does_not_skip_every_other_sample(self):
        sampler = mock.Mock(side_effect=custom_sample)
        state = exporter.Exporter(custom_sampler=sampler, monotonic=mock.Mock(side_effect=[100, 114.999, 129.998]))
        try:
            for _ in range(3):
                self.assertIsNotNone(state.scrape())
            self.assertEqual(sampler.call_count, 3)
        finally:
            state.close()


class HttpTests(unittest.TestCase):
    def state(self, **kwargs):
        return exporter.Exporter(custom_sampler=kwargs.pop("custom_sampler", custom_sample), **kwargs)

    def test_systemd_execstart_uses_arguments_accepted_by_the_real_cli_parser(self):
        unit = Path(exporter.__file__).with_name("personal-homepage-monitor-custom.service").read_text()
        command = shlex.split(next(line.removeprefix("ExecStart=") for line in unit.splitlines() if line.startswith("ExecStart=")))
        self.assertEqual(command[:2], ["/usr/bin/python3", "/opt/personal-homepage-monitor/custom/exporter.py"])
        arguments = exporter.parse_arguments(command[2:])
        self.assertEqual(arguments.port, 19104)
        self.assertEqual(arguments.host_id, "cloud-primary")

    def test_actual_cli_serves_only_custom_metrics_without_external_commands_or_state_files(self):
        with socket.socket() as reservation:
            reservation.bind((exporter.LISTEN_HOST, 0))
            port = reservation.getsockname()[1]
        with tempfile.TemporaryDirectory() as directory:
            # Deliberately hide Docker/systemctl so this real subprocess test
            # cannot contact any local or remote Docker context. Missing probes
            # must become unknown metadata and process states, never a crash.
            process = subprocess.Popen([sys.executable, str(Path(exporter.__file__).resolve()), "--port", str(port)],
                                       cwd=directory, env={**os.environ, "PATH": "", "PYTHONDONTWRITEBYTECODE": "1"},
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            base = "http://127.0.0.1:" + str(port)
            try:
                for attempt in range(40):
                    try:
                        with urllib.request.urlopen(base + "/health", timeout=0.2) as response:
                            self.assertEqual(response.read(), b"ok\n")
                        break
                    except OSError:
                        if process.poll() is not None or attempt == 39:
                            self.fail("custom CLI did not start")
                        time.sleep(0.025)
                with urllib.request.urlopen(base + "/metrics/custom", timeout=3) as response:
                    text = response.read().decode("utf-8")
                self.assertIn("server_monitor_custom_collected_at_seconds", text)
                self.assertEqual(sum(line.startswith("server_monitor_custom_container_info{") for line in text.splitlines()), 3)
                self.assertEqual(sum(line.startswith("server_monitor_custom_service_info{") for line in text.splitlines()), 5)
                self.assertNotIn("container_id=", text)
                self.assertNotIn("host_cpu", text)
                self.assertEqual(list(Path(directory).iterdir()), [])
                for path in ("/metrics/host", "/metrics/checks"):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + path, timeout=1)
                    self.assertEqual(error.exception.code, 404)
            finally:
                process.terminate()
                process.wait(timeout=5)

    def test_real_custom_route_health_headers_removed_routes_and_failure(self):
        state = self.state(clock=lambda: 100, monotonic=mock.Mock(return_value=0))
        with live_server(state) as server:
            code, headers, text = request(server)
            self.assertEqual(code, 200)
            self.assertIn("text/plain; version=0.0.4", headers["Content-Type"])
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertIn("server_monitor_custom_container_info", text)
            self.assertEqual(request(server, "/health")[2], "ok\n")
            for path in ("/", "/metrics", "/metrics/host", "/metrics/checks", "/metrics/custom?target=x"):
                self.assertEqual(request(server, path)[0], 404)
            self.assertEqual(request(server, method="POST")[0], 405)
            state.custom_sampler = mock.Mock(side_effect=RuntimeError("private"))
            state.monotonic.return_value = 15
            with self.assertLogs("server-monitor-exporter", level="WARNING"):
                self.assertEqual(request(server)[0], 503)

    def test_slow_initial_custom_batch_does_not_overlap_or_block_health(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def slow_checks(*_):
            calls.append(1)
            entered.set()
            if not release.wait(3):
                raise RuntimeError("not released")
            return custom_sample()
        state = self.state(custom_sampler=slow_checks)
        with live_server(state) as server, concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            slow = pool.submit(request, server)
            try:
                self.assertTrue(entered.wait(1))
                self.assertEqual(request(server)[0], 503)
                self.assertEqual(request(server, "/health")[0], 200)
                self.assertEqual(len(calls), 1)
            finally:
                release.set()
            self.assertEqual(slow.result(timeout=2)[0], 200)

    def test_http_workers_are_bounded_and_recover_after_slow_client_disconnects(self):
        state = self.state()
        with live_server(state, max_requests=1) as server:
            blocker = socket.create_connection(server.server_address, timeout=2)
            try:
                blocker.sendall(b"GET /metrics/custom HTTP/1.1\r\n")
                deadline = time.monotonic() + 1
                while server.request_slots._value != 0 and time.monotonic() < deadline:
                    time.sleep(0.005)
                try:
                    rejected = request(server)[0]
                except (ConnectionAbortedError, ConnectionResetError):
                    # Windows may reset a capacity-rejected TCP connection
                    # when its unread request bytes are closed after the 503.
                    rejected = 503
                self.assertEqual(rejected, 503)
            finally:
                blocker.close()
            deadline = time.monotonic() + 1
            while server.request_slots._value != 1 and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertEqual(request(server)[0], 200)

    def test_listener_rejects_public_bind_and_invalid_host_identity(self):
        state = self.state()
        try:
            for address in ("0.0.0.0", "::", "localhost", "192.168.1.1"):
                with self.assertRaisesRegex(ValueError, "loopback"):
                    exporter.MetricsServer((address, 0), state)
            for identifier in ("", "two hosts", "a" * 65):
                with self.assertRaises(ValueError):
                    exporter.Exporter(host_id=identifier)
        finally:
            state.close()


if __name__ == "__main__":
    unittest.main()

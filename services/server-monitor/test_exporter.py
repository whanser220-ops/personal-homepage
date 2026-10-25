"""Exporter integration tests; standard library only, no Docker or live host."""
import concurrent.futures
from contextlib import contextmanager
import socket
import threading
import time
import unittest
from unittest import mock
import urllib.error
import urllib.request

import exporter


def host_sample():
    host = {"hostname": 'node"\\one\ntwo', "cpu": {}, "memory": {}, "swap": {},
            "disk": {"mount": "/"}, "network": {"interface": "ens3"}}
    for index, (_, path) in enumerate(exporter.HOST_FIELDS):
        target = host
        for field in path[:-1]:
            target = target[field]
        target[path[-1]] = index + 0.5
    return host


def checks_sample(*_):
    return {
        "containers": [{"name": "personal-homepage", "image": "homepage:abc123", "state": "running",
                        "health": "healthy", "restartCount": 0, "cpuPercent": 1.5,
                        "memoryBytes": 2048, "memoryLimitBytes": None, "memoryPercent": 0.25}],
        "services": [{"id": "study-agent-http", "name": "Study Agent HTTP", "kind": "http",
                      "status": "reachable", "detail": '认证或跳转响应; "只证明可达"',
                      "httpStatus": 303, "latencyMs": 5.5},
                     {"id": "perforce", "name": "Perforce", "kind": "tcp", "status": "unhealthy",
                      "detail": "本机 TCP 连接失败或超时", "httpStatus": None, "latencyMs": None}],
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


def request(server, path="/metrics/host", method="GET"):
    url = "http://127.0.0.1:" + str(server.server_port) + path
    req = urllib.request.Request(url, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=2)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read().decode("utf-8")


class RenderingTests(unittest.TestCase):
    def test_all_host_fields_and_timestamp_are_exposed_with_escaped_labels(self):
        text = exporter.render_host("cloud-primary", host_sample(), 123.75).decode("utf-8")
        self.assertIn('hostname="node\\"\\\\one\\ntwo"', text)
        self.assertIn('mount="/",interface="ens3"', text)
        self.assertIn('server_monitor_host_collected_at_seconds{host_id="cloud-primary"} 123.75\n', text)
        for index, (suffix, _) in enumerate(exporter.HOST_FIELDS):
            self.assertIn('server_monitor_' + suffix + '{host_id="cloud-primary"} ' + str(index + 0.5) + '\n', text)
        self.assertTrue(text.endswith("\n"))

    def test_null_nan_reset_rates_are_absent_and_real_zero_is_retained(self):
        host = host_sample()
        host["cpu"]["percent"] = None
        host["network"]["rxBytesPerSecond"] = float("nan")
        host["network"]["txBytesPerSecond"] = float("inf")
        host["swap"]["usedPercent"] = 0
        text = exporter.render_host("cloud-primary", host, 123).decode("utf-8")
        self.assertNotIn("host_cpu_percent", text)
        self.assertNotIn("host_network_rx_bytes_per_second", text)
        self.assertNotIn("host_network_tx_bytes_per_second", text)
        self.assertIn('server_monitor_host_swap_used_percent{host_id="cloud-primary"} 0\n', text)

    def test_container_and_service_fields_keep_probe_meaning_and_unknown_values(self):
        text = exporter.render_checks("cloud-primary", checks_sample(), 125).decode("utf-8")
        self.assertIn('server_monitor_checks_collected_at_seconds{host_id="cloud-primary"} 125\n', text)
        self.assertIn('image="homepage:abc123",state="running",health="healthy"', text)
        self.assertIn('server_monitor_container_restart_count{host_id="cloud-primary",name="personal-homepage"} 0\n', text)
        self.assertNotIn("container_memory_limit_bytes", text)
        self.assertIn('kind="http",status="reachable"', text)
        self.assertIn('server_monitor_service_http_status{host_id="cloud-primary",id="study-agent-http"} 303\n', text)
        self.assertIn('kind="tcp",status="unhealthy"', text)
        self.assertNotIn('service_http_status{host_id="cloud-primary",id="perforce"}', text)
        self.assertIn('认证或跳转响应; \\"只证明可达\\"', text)

    def test_family_type_is_declared_once_for_multiple_entities(self):
        checks = checks_sample()
        checks["containers"].append({**checks["containers"][0], "name": "learning-whiteboard"})
        text = exporter.render_checks("cloud-primary", checks, 125).decode("utf-8")
        self.assertEqual(text.count("# TYPE server_monitor_container_info gauge\n"), 1)
        self.assertEqual(text.count("# TYPE server_monitor_container_restart_count gauge\n"), 1)


class SchedulingTests(unittest.TestCase):
    def test_slow_batch_does_not_block_host_or_overlap_and_cached_timestamp_stays_old(self):
        entered, release = threading.Event(), threading.Event()
        calls = []

        def checks(pool, timestamp):
            calls.append(timestamp())
            if len(calls) == 2:
                entered.set()
                if not release.wait(3):
                    raise RuntimeError("test failed to release slow probe")
            return checks_sample()

        sampler = mock.Mock()
        sampler.sample.return_value = host_sample()
        state = exporter.Exporter(sampler=sampler, checks_sampler=checks, clock=mock.Mock(side_effect=[100, 115, 118]))
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            try:
                old = state.scrape("checks")
                slow = pool.submit(state.scrape, "checks")
                self.assertTrue(entered.wait(1))
                self.assertIs(state.scrape("checks"), old)
                self.assertEqual(len(calls), 2)
                started = time.monotonic()
                self.assertIn(b"host_collected_at_seconds", state.scrape("host"))
                self.assertLess(time.monotonic() - started, 0.2)
                self.assertIn(b'} 100\n', old)
                release.set()
                self.assertIn(b'} 115\n', slow.result(timeout=2))
            finally:
                release.set()
                state.close()

    def test_failed_collection_returns_unavailable_instead_of_fresh_cached_data(self):
        state = exporter.Exporter(sampler=mock.Mock(), checks_sampler=checks_sample, clock=lambda: 100)
        try:
            self.assertIsNotNone(state.scrape("checks"))
            state.checks_sampler = mock.Mock(side_effect=RuntimeError("secret probe output"))
            with self.assertLogs("server-monitor-exporter", level="WARNING") as logs:
                self.assertIsNone(state.scrape("checks"))
            self.assertNotIn("secret", " ".join(logs.output))
        finally:
            state.close()

    def test_import_and_exporter_operation_never_open_legacy_queue_or_send_push(self):
        with mock.patch.object(exporter.collector, "SampleQueue", side_effect=AssertionError("legacy queue touched")), \
             mock.patch.object(exporter.collector, "send_delivery_batch", side_effect=AssertionError("push used")):
            state = exporter.Exporter(sampler=mock.Mock(sample=mock.Mock(return_value=host_sample())), checks_sampler=checks_sample)
            try:
                self.assertIsNotNone(state.scrape("host"))
                self.assertIsNotNone(state.scrape("checks"))
            finally:
                state.close()


class HttpTests(unittest.TestCase):
    def state(self, **kwargs):
        return exporter.Exporter(sampler=mock.Mock(sample=mock.Mock(return_value=host_sample())),
                                 checks_sampler=kwargs.pop("checks_sampler", checks_sample), **kwargs)

    def test_real_http_routes_headers_and_failure_status(self):
        state = self.state(clock=lambda: 100)
        with live_server(state) as server:
            code, headers, text = request(server)
            self.assertEqual(code, 200)
            self.assertIn("text/plain; version=0.0.4", headers["Content-Type"])
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertEqual(headers["Connection"], "close")
            self.assertIn("server_monitor_host_cpu_percent", text)
            self.assertEqual(request(server, "/metrics/checks")[0], 200)
            self.assertEqual(request(server, "/health")[2], "ok\n")
            for path in ("/", "/metrics", "/metrics/host?secret=x", "/metrics/host/extra"):
                self.assertEqual(request(server, path)[0], 404)
            self.assertEqual(request(server, method="POST")[0], 405)
            state.sampler.sample.side_effect = RuntimeError("private error")
            with self.assertLogs("server-monitor-exporter", level="WARNING"):
                code, _, text = request(server)
            self.assertEqual(code, 503)
            self.assertNotIn("private", text)

    def test_real_http_host_stays_available_during_slow_first_check(self):
        entered, release = threading.Event(), threading.Event()

        def slow_checks(*_):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("slow probe not released")
            return checks_sample()

        state = self.state(checks_sampler=slow_checks)
        with live_server(state) as server, concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            slow = pool.submit(request, server, "/metrics/checks")
            try:
                self.assertTrue(entered.wait(1))
                self.assertEqual(request(server, "/metrics/checks")[0], 503)
                self.assertEqual(request(server, "/metrics/host")[0], 200)
            finally:
                release.set()
            self.assertEqual(slow.result(timeout=2)[0], 200)

    def test_http_workers_are_bounded_and_recover_after_slow_client_disconnects(self):
        state = self.state()
        with live_server(state, max_requests=1) as server:
            blocker = socket.create_connection(server.server_address, timeout=2)
            try:
                blocker.sendall(b"GET /metrics/host HTTP/1.1\r\n")
                deadline = time.monotonic() + 1
                while server.request_slots._value != 0 and time.monotonic() < deadline:
                    time.sleep(0.005)
                self.assertEqual(server.request_slots._value, 0)
                self.assertEqual(request(server)[0], 503)
                state.sampler.sample.assert_not_called()
            finally:
                blocker.close()
            deadline = time.monotonic() + 1
            while server.request_slots._value != 1 and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertEqual(request(server)[0], 200)

    def test_listener_rejects_public_or_hostname_bind_and_invalid_identifiers(self):
        state = self.state()
        try:
            for address in ("0.0.0.0", "::", "localhost", "192.168.1.1"):
                with self.assertRaisesRegex(ValueError, "loopback"):
                    exporter.MetricsServer((address, 0), state)
            for identifier in ("", "two hosts", "a" * 65):
                with self.assertRaises(ValueError):
                    exporter.Exporter(host_id=identifier)
            with self.assertRaises(ValueError):
                exporter.Exporter(interface="ens3;bad")
        finally:
            state.close()


if __name__ == "__main__":
    unittest.main()

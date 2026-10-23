"""Offline regression tests: python -m unittest discover -s services/server-monitor."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest import mock
import urllib.error

SPEC = importlib.util.spec_from_file_location("collector", Path(__file__).with_name("collector.py"))
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


def sample(timestamp=None, suffix="", padding=""):
    return {"hostId": "cloud-primary", "collectedAt": collector.utc_iso(time.time() if timestamp is None else timestamp),
            "host": {"hostname": "test" + suffix, "padding": padding}, "containers": [], "services": []}


class HostTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.proc = Path(self.directory.name)
        (self.proc / "net").mkdir()
        self.write("stat", "cpu  20 0 20 40 20 0 0 0 0 0\n")
        self.write("meminfo", "MemTotal: 2000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n")
        self.write("loadavg", "0.25 0.50 0.75 1/100 25\n")
        self.write("uptime", "12345.5 2222.2\n")
        self.write("net/route", "Iface Destination Gateway Flags RefCnt Use Metric Mask\n"
                   "docker0 00000000 0100007F 0003 0 0 1 00000000\n"
                   "ens3 00000000 0100007F 0003 0 0 100 00000000\n")
        self.write("net/dev", "ens3: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n"
                   "docker0: 999999 0 0 0 0 0 0 0 999999 0 0 0 0 0 0 0\n")
        self.write("diskstats", "8 1 sda1 1 0 10 0 1 0 20 0 0 0 0\n")
        self.clock = mock.Mock(side_effect=[100, 115, 130, 145])
        self.sampler = collector.HostSampler(proc_root=self.proc, clock=self.clock)
        self.disk = mock.patch.object(self.sampler, "disk_counters", return_value=(5120, 10240))
        self.disk_mock = self.disk.start()
        self.statvfs = mock.patch.object(collector.os, "statvfs", create=True, return_value=types.SimpleNamespace(f_blocks=1000, f_frsize=1024, f_bfree=400, f_bavail=350))
        self.statvfs.start()

    def tearDown(self):
        self.disk.stop()
        self.statvfs.stop()
        self.directory.cleanup()

    def write(self, name, text):
        (self.proc / name).write_text(text, encoding="ascii")

    def test_first_frame_null_then_real_counter_deltas(self):
        first = self.sampler.sample()
        self.assertIsNone(first["cpu"]["percent"])
        self.assertIsNone(first["disk"]["readBytesPerSecond"])
        self.assertIsNone(first["network"]["rxBytesPerSecond"])
        self.assertEqual(first["network"]["interface"], "ens3")
        self.assertEqual(first["memory"]["usedPercent"], 75)
        self.assertEqual(first["swap"]["usedPercent"], 0)
        self.assertEqual(first["disk"]["usedBytes"], 600 * 1024)
        self.assertEqual(first["disk"]["availableBytes"], 350 * 1024)
        self.write("stat", "cpu  50 0 40 70 40 0 0 0 0 0\n")
        self.write("net/dev", "ens3: 2500 0 0 0 0 0 0 0 5000 0 0 0 0 0 0 0\n")
        self.disk_mock.return_value = (5120 + 15000, 10240 + 30000)
        second = self.sampler.sample()
        self.assertEqual(second["cpu"]["percent"], 50)
        self.assertEqual(second["network"]["rxBytesPerSecond"], 100)
        self.assertEqual(second["network"]["txBytesPerSecond"], 200)
        self.assertEqual(second["disk"]["readBytesPerSecond"], 1000)
        self.assertEqual(second["disk"]["writeBytesPerSecond"], 2000)

    def test_counter_reset_and_missing_metrics_stay_unknown(self):
        self.sampler.sample()
        self.write("stat", "cpu  1 0 1 1 1 0 0 0\n")
        self.write("net/dev", "ens3: 5 0 0 0 0 0 0 0 5 0 0 0 0 0 0 0\n")
        self.write("meminfo", "")
        self.disk_mock.return_value = (1, None)
        second = self.sampler.sample()
        self.assertIsNone(second["cpu"]["percent"])
        self.assertIsNone(second["disk"]["readBytesPerSecond"])
        self.assertIsNone(second["network"]["rxBytesPerSecond"])
        self.assertIsNone(second["memory"]["totalBytes"])
        self.assertIsNone(collector.HostSampler(proc_root=self.proc).sample()["cpu"]["percent"])

    def test_interface_change_does_not_mix_counters(self):
        self.sampler.sample()
        self.sampler.interface_override = "ens4"
        self.write("net/dev", "ens4: 250000 0 0 0 0 0 0 0 500000 0 0 0 0 0 0 0\n")
        self.assertIsNone(self.sampler.sample()["network"]["rxBytesPerSecond"])

    def test_disk_selects_root_device_without_summing_partitions(self):
        self.disk.stop()
        self.disk = mock.patch.object(self.sampler, "clock", self.clock)
        self.disk.start()
        with mock.patch.object(collector.os, "stat", return_value=types.SimpleNamespace(st_dev=123)), \
             mock.patch.object(collector.os, "major", create=True, return_value=8), \
             mock.patch.object(collector.os, "minor", create=True, return_value=1):
            # Path.read_text does not use the patched stat call.
            self.assertEqual(self.sampler.disk_counters(), (5120, 10240))


class ProbeTests(unittest.TestCase):
    def test_auth_redirect_is_reachable_and_body_never_read(self):
        response = mock.Mock()
        response.close = mock.Mock()
        error = urllib.error.HTTPError("http://127.0.0.1", 303, "See Other", {}, response)
        with mock.patch.object(collector, "local_http_opener") as factory:
            factory.return_value.open.side_effect = error
            result = collector.http_probe("test", "Test", "http://127.0.0.1:4320/")
        self.assertEqual(result["status"], "reachable")
        self.assertEqual(result["httpStatus"], 303)
        response.read.assert_not_called()

    def test_http_health_500_and_auth_403_are_distinct(self):
        for code, expected in ((500, "unhealthy"), (403, "reachable")):
            with mock.patch.object(collector, "local_http_opener") as factory:
                factory.return_value.open.side_effect = urllib.error.HTTPError("http://127.0.0.1", code, "error", {}, None)
                self.assertEqual(collector.http_probe("test", "Test", "http://127.0.0.1/")["status"], expected)

    def test_tcp_only_proves_reachability(self):
        with mock.patch.object(collector.socket, "create_connection"):
            self.assertEqual(collector.tcp_probe("test", "Test", 4321)["status"], "reachable")

    def test_process_active_is_separate_from_http(self):
        with mock.patch.object(collector, "command", return_value=(0, "active\n")):
            result = collector.systemd_probe("study-agent", "Study Agent", "study-agent.service")
        self.assertEqual(result["kind"], "process")
        self.assertEqual(result["status"], "healthy")

    def test_docker_only_reads_whitelisted_fields_and_sizes(self):
        meta = json.dumps({"name": "/personal-homepage", "image": "site:abc123", "state": "running", "health": "healthy", "restartCount": 2})
        stats = json.dumps({"Name": "personal-homepage", "CPUPerc": "12.5%", "MemUsage": "100MiB / 2GiB", "MemPerc": "4.88%"})
        with mock.patch.object(collector, "command", side_effect=[(0, meta), (0, stats)]) as execute:
            results = collector.collect_containers()
        self.assertEqual(results[0]["memoryBytes"], 100 * 1024 * 1024)
        self.assertEqual(results[0]["memoryLimitBytes"], 2 * 1024 * 1024 * 1024)
        self.assertEqual(results[0]["cpuPercent"], 12.5)
        self.assertEqual(results[1]["state"], "unknown")
        template = execute.call_args_list[0].args[0][3]
        self.assertNotIn(".Config.Env", template)
        self.assertNotIn(".State.Health.Log", template)
        self.assertEqual(set(results[0]), {"name", "image", "state", "health", "restartCount", "cpuPercent", "memoryBytes", "memoryLimitBytes", "memoryPercent"})

    def test_probe_errors_never_include_exception_secret(self):
        secret = "DO-NOT-LOG-THIS-TOKEN"
        with mock.patch.object(collector, "local_http_opener") as factory:
            factory.return_value.open.side_effect = OSError(secret)
            result = collector.http_probe("test", "Test", "http://127.0.0.1/")
        self.assertNotIn(secret, json.dumps(result))


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "queue.sqlite3"
        self.queue = collector.SampleQueue(self.path)

    def tearDown(self):
        self.queue.close()
        self.directory.cleanup()

    def test_persistent_dedup_and_acknowledge_only_given_keys(self):
        first = sample()
        second = sample(time.time() + 1)
        self.queue.enqueue(first)
        self.queue.enqueue(first)
        self.queue.enqueue(second)
        self.queue.close()
        self.queue = collector.SampleQueue(self.path)
        self.assertEqual(self.queue.count(), 2)
        self.queue.acknowledge([self.queue.batch()[0][0]])
        self.assertEqual(self.queue.batch()[0][1], second)

    def test_ttl_and_capacity_bound(self):
        now = time.time()
        self.queue.enqueue(sample(now - 3601), now=now)
        self.assertEqual(self.queue.count(), 0)
        self.queue.close()
        self.queue = collector.SampleQueue(self.path, max_bytes=128 * 1024)
        with self.assertLogs(collector.LOGGER, level="WARNING"):
            for index in range(40):
                self.queue.enqueue(sample(now + index, padding="x" * 4000), now=now)
        self.assertLess(self.queue.count(), 40)
        self.assertLessEqual(self.path.stat().st_size, 128 * 1024)
        self.assertEqual(self.queue.batch()[-1][1]["collectedAt"], collector.utc_iso(now + 39))
        self.queue.prune(now=now + 4000)
        self.assertEqual(self.queue.count(), 0)

    def test_failed_or_ambiguous_delivery_survives_restart_and_retry(self):
        original = sample()
        self.queue.enqueue(original)
        secret = "test-secret-never-print-it-123456789"
        with mock.patch.object(collector, "local_http_opener") as factory, \
             self.assertLogs(collector.LOGGER, level="WARNING") as logs:
            factory.return_value.open.side_effect = OSError(secret)
            self.assertFalse(collector.deliver(self.queue, "http://127.0.0.1:3000/api/monitor/ingest", secret))
        self.assertNotIn(secret, " ".join(logs.output))
        self.queue.close()
        self.queue = collector.SampleQueue(self.path)
        self.assertEqual(self.queue.batch()[0][1], original)
        with mock.patch.object(collector, "local_http_opener") as factory:
            response = factory.return_value.open.return_value.__enter__.return_value
            response.status = 201
            self.assertTrue(collector.deliver(self.queue, "http://127.0.0.1:3000/api/monitor/ingest", secret))
            sent = factory.return_value.open.call_args.args[0]
            self.assertEqual(json.loads(sent.data)["samples"], [original])
        self.assertEqual(self.queue.count(), 0)

    def test_batched_recovery_never_exceeds_20(self):
        now = time.time()
        for index in range(42):
            self.queue.enqueue(sample(now + index), now=now)
        with mock.patch.object(collector, "local_http_opener") as factory:
            factory.return_value.open.return_value.__enter__.return_value.status = 200
            self.assertFalse(collector.deliver(self.queue, "http://127.0.0.1:3000/api/monitor/ingest", "secret", max_batches=1))
            self.assertEqual(self.queue.count(), 22)
            self.assertTrue(collector.deliver(self.queue, "http://127.0.0.1:3000/api/monitor/ingest", "secret"))
            sizes = [len(json.loads(call.args[0].data)["samples"]) for call in factory.return_value.open.call_args_list]
            self.assertEqual(sizes, [20, 20, 2])

    def test_ingest_redirect_never_acknowledges_samples(self):
        self.queue.enqueue(sample())
        with mock.patch.object(collector, "local_http_opener") as factory:
            factory.return_value.open.side_effect = urllib.error.HTTPError("http://127.0.0.1", 302, "redirect", {}, None)
            collector.deliver(self.queue, "http://127.0.0.1:3000/api/monitor/ingest", "secret")
        self.assertEqual(self.queue.count(), 1)


class EndpointTests(unittest.TestCase):
    def test_endpoint_must_be_loopback_and_token_cannot_redirect(self):
        self.assertEqual(collector.validate_endpoint("http://127.0.0.1:3000/api/monitor/ingest"), "http://127.0.0.1:3000/api/monitor/ingest")
        for value in ("https://example.com/api/monitor/ingest", "http://localhost:3000/api/monitor/ingest", "http://secret@127.0.0.1:3000/api/monitor/ingest", "http://127.0.0.1:3000/api/monitor/ingest?token=bad"):
            with self.assertRaises(ValueError):
                collector.validate_endpoint(value)
        self.assertIsNone(collector.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))


if __name__ == "__main__":
    unittest.main()

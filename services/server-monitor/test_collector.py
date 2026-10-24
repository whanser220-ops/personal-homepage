"""Offline regression tests: python -m unittest discover -s services/server-monitor."""
import importlib.util
import concurrent.futures
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import threading
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

    def test_http_health_500_and_auth_401_403_are_distinct(self):
        for code, expected in ((500, "unhealthy"), (401, "reachable"), (403, "reachable")):
            with mock.patch.object(collector, "local_http_opener") as factory:
                factory.return_value.open.side_effect = urllib.error.HTTPError("http://127.0.0.1", code, "error", {}, None)
                self.assertEqual(collector.http_probe("test", "Test", "http://127.0.0.1/")["status"], expected)

    def test_tcp_only_proves_reachability(self):
        with mock.patch.object(collector.socket, "create_connection"):
            self.assertEqual(collector.tcp_probe("test", "Test", 4321)["status"], "reachable")

    def test_process_active_is_separate_from_http(self):
        output = "Id=study-agent.service\nLoadState=loaded\nActiveState=active\n"
        with mock.patch.object(collector, "command", return_value=(0, output)):
            result = collector.systemd_probes()[0]
        self.assertEqual(result["kind"], "process")
        self.assertEqual(result["status"], "healthy")

    def test_postgres_uses_container_identity_and_does_not_forward_output(self):
        for code, expected in ((0, "healthy"), (1, "unhealthy"), (2, "unhealthy"), (None, "unknown")):
            with self.subTest(code=code), mock.patch.object(collector, "command", return_value=(code, "private database output")) as execute:
                result = collector.postgres_probe()
            self.assertEqual(result["status"], expected)
            self.assertEqual(result["kind"], "process")
            argv = execute.call_args.args[0]
            self.assertEqual(argv[:5], ["docker", "exec", "personal-homepage-postgres", "sh", "-c"])
            self.assertIn('-U "${POSTGRES_USER:-postgres}"', argv[5])
            self.assertIn('-d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"', argv[5])
            self.assertNotIn("POSTGRES_PASSWORD", argv[5])
            self.assertNotIn("private database output", json.dumps(result))

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


class LocalHttpTests(unittest.TestCase):
    """Exercise real urllib requests on loopback, without contacting other services."""
    def setUp(self):
        self.requests = []
        requests = self.requests

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.path, self.headers.get("Authorization")))
                status = int(self.path.rsplit("/", 1)[-1]) if self.path.startswith("/status/") else 200
                self.send_response(status)
                if 300 <= status < 400:
                    self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/sink")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                requests.append((self.path, self.headers.get("Authorization")))
                self.send_response(int(self.path.rsplit("/", 1)[-1]))
                self.send_header("Location", f"http://127.0.0.1:{self.server.server_port}/sink")
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def test_http_only_transport_never_creates_tls_or_reads_environment_proxies(self):
        def probe():
            opener = collector.local_http_opener()
            with opener.open(self.base + "/status/204", timeout=2) as response:
                self.assertEqual(response.status, 204)
            for url in ("https://127.0.0.1/", "file:///should-not-open", "ftp://127.0.0.1/"):
                with self.assertRaises(urllib.error.URLError):
                    opener.open(url, timeout=0.1)

        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1", "ALL_PROXY": "http://127.0.0.1:1", "NO_PROXY": ""}), \
             mock.patch.object(collector.urllib.request, "getproxies", side_effect=AssertionError("proxy environment read")), \
             mock.patch.object(ssl, "_create_default_https_context", side_effect=AssertionError("unexpected TLS context")), \
             concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            executor.submit(probe).result(timeout=3)
        self.assertEqual(self.requests, [("/status/204", None)])

    def test_auth_statuses_and_redirects_are_reachable_without_following(self):
        for status in (301, 302, 303, 307, 308, 401, 403):
            with self.subTest(status=status):
                result = collector.http_probe("auth", "Authentication", self.base + f"/status/{status}")
                self.assertEqual(result["status"], "reachable")
                self.assertEqual(result["httpStatus"], status)
        self.assertFalse(any(path == "/sink" for path, _ in self.requests))

    def test_bearer_token_is_never_sent_to_a_redirect_target_or_acknowledged(self):
        with tempfile.TemporaryDirectory() as directory:
            queue = collector.SampleQueue(Path(directory) / "queue.sqlite3")
            try:
                queue.enqueue(sample())
                for status in (307, 308):
                    with self.subTest(status=status), self.assertLogs(collector.LOGGER, level="WARNING"):
                        self.assertFalse(collector.deliver(queue, self.base + f"/ingest/{status}", "test-only-bearer-value"))
                    self.assertEqual(queue.count(), 1)
            finally:
                queue.close()
        self.assertEqual(self.requests, [(f"/ingest/{status}", "Bearer test-only-bearer-value") for status in (307, 308)])


class OpenerReuseTests(unittest.TestCase):
    def test_reuses_within_each_thread_and_isolates_between_threads(self):
        barrier = threading.Barrier(2)

        def openers():
            first = collector.local_http_opener()
            barrier.wait(timeout=2)
            return first, collector.local_http_opener()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(openers) for _ in range(2)]
            pairs = [future.result(timeout=3) for future in futures]
        self.assertIs(pairs[0][0], pairs[0][1])
        self.assertIs(pairs[1][0], pairs[1][1])
        self.assertIsNot(pairs[0][0], pairs[1][0])


class SystemdBatchTests(unittest.TestCase):
    def test_fixed_units_and_fields_are_queried_once_and_mapped_by_id(self):
        output = "\n\n".join([
            "Id=docker.service\nLoadState=loaded\nActiveState=active",
            "Id=study-agent.service\nLoadState=loaded\nActiveState=active",
            "Id=study-agent-remote.service\nLoadState=loaded\nActiveState=failed",
            "Id=nginx.service\nLoadState=not-found\nActiveState=inactive",
        ])
        with mock.patch.object(collector, "command", return_value=(1, output)) as execute:
            results = collector.systemd_probes()
        self.assertEqual([item["id"] for item in results], [item[0] for item in collector.SYSTEMD_SERVICES])
        self.assertEqual([item["status"] for item in results], ["healthy", "unhealthy", "unknown", "healthy"])
        execute.assert_called_once()
        argv = execute.call_args.args[0]
        self.assertEqual(argv[:2], ["systemctl", "show"])
        self.assertEqual(set(argv[-len(collector.SYSTEMD_SERVICES):]), {item[2] for item in collector.SYSTEMD_SERVICES})
        fields = next(item.split("=", 1)[1] for item in argv if item.startswith("--property="))
        self.assertEqual(set(fields.split(",")), {"Id", "LoadState", "ActiveState"})
        self.assertTrue(all(item["kind"] == "process" for item in results))

    def test_missing_unit_cannot_hide_successful_units(self):
        output = "Id=docker.service\nLoadState=loaded\nActiveState=active\n"
        with mock.patch.object(collector, "command", return_value=(0, output)):
            results = collector.systemd_probes()
        self.assertEqual([item["status"] for item in results], ["unknown", "unknown", "unknown", "healthy"])

    def test_masking_a_running_unit_does_not_claim_its_process_has_stopped(self):
        for state, expected in (("active", "healthy"), ("inactive", "unhealthy")):
            output = f"Id=study-agent.service\nLoadState=masked\nActiveState={state}\n"
            with self.subTest(state=state), mock.patch.object(collector, "command", return_value=(0, output)):
                result = collector.systemd_probes()[0]
            self.assertEqual(result["status"], expected)

    def test_timeout_and_unavailable_output_stay_unknown_without_leaking_output(self):
        for code, output in ((None, ""), (None, "Id=study-agent.service\nLoadState=loaded\nActiveState=active\n"), (1, "private systemd failure output")):
            with self.subTest(code=code), mock.patch.object(collector, "command", return_value=(code, output)):
                results = collector.systemd_probes()
            self.assertEqual(len(results), 4)
            self.assertTrue(all(item["status"] == "unknown" for item in results))
            self.assertNotIn("private systemd failure output", json.dumps(results))


class SchedulingTests(unittest.TestCase):
    def simulate(self, directory, *, stop_at=39, slow_durations=(8, 20, 1),
                 slow_failures=(), delivery_failures=(0,), delivery_errors=()):
        owner = threading.get_ident()
        base = time.time()
        clock = types.SimpleNamespace(now=0.0)
        history, starts, blocking, acknowledgements = [], [], [], []
        self_test = self

        class Queue(collector.SampleQueue):
            def enqueue(self, value, **kwargs):
                self_test.assertEqual(threading.get_ident(), owner)
                history.append(json.loads(json.dumps(value)))
                return super().enqueue(value, **kwargs)

            def acknowledge(self, keys):
                self_test.assertEqual(threading.get_ident(), owner)
                acknowledgements.append(tuple(keys))
                return super().acknowledge(keys)

        class Future:
            def __init__(self, due, value, error=None):
                self.due, self.value, self.error = due, value, error

            def done(self):
                return clock.now >= self.due

            def result(self):
                if not self.done():
                    blocking.append((clock.now, self.due))
                    clock.now = self.due
                if self.error:
                    raise self.error
                return self.value

        class Executor:
            def __init__(self, kind):
                self.kind, self.futures, self.submitted = kind, [], []

            def submit(self, function, *args):
                self_test.assertFalse(any(not future.done() for future in self.futures),
                                      'only one task may be in flight per independent pool')
                index = len(self.submitted)
                self.submitted.append((clock.now, function, args))
                error = None
                if self.kind == 'slow':
                    self_test.assertIs(function, collector.collect_checks)
                    duration = slow_durations[min(index, len(slow_durations)-1)]
                    value = {'containers': [{'name': 'snapshot-'+str(index)}],
                             'services': [{'id': 'service-'+str(index)}],
                             'checksCollectedAt': args[1]()}
                    if index in slow_failures:
                        error = RuntimeError('private slow exception')
                else:
                    self_test.assertIs(function, collector.send_delivery_batch)
                    batch = args[0]
                    self_test.assertIsInstance(batch, tuple)
                    self_test.assertIsInstance(batch[0], tuple)
                    self_test.assertIsInstance(batch[1], bytes)
                    self_test.assertLessEqual(len(json.loads(batch[1])['samples']), 20)
                    self_test.assertNotIn(queue, args)
                    duration = 4
                    value = () if index in delivery_failures else batch[0]
                    if index in delivery_errors:
                        error = RuntimeError('private delivery exception')
                future = Future(clock.now+duration, value, error)
                self.futures.append(future)
                return future

        class Stopping:
            def is_set(self):
                return clock.now >= stop_at

            def wait(self, seconds):
                self_test.assertGreater(seconds, 0, 'no busy loop on an overdue slow batch')
                clock.now += seconds

        def host():
            starts.append(clock.now)
            return {'hostname': 'fast-test'}

        queue = Queue(Path(directory)/'queue-v2.sqlite3')
        slow, delivery = Executor('slow'), Executor('delivery')
        try:
            collector.run_sampling(queue, types.SimpleNamespace(sample=host), Stopping(),
                slow, object(), delivery, 'http://127.0.0.1:3000/api/monitor/ingest', 'x'*40,
                clock=lambda: clock.now, timestamp=lambda: collector.utc_iso(base+clock.now))
        finally:
            queue.close()
        return types.SimpleNamespace(base=base, clock=clock, history=history, starts=starts,
                                     blocking=blocking, slow=slow, delivery=delivery, acks=acknowledgements)

    def test_fast_ticks_continue_during_slow_checks_and_four_second_ingest(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.simulate(directory)
            self.assertEqual(result.starts, list(range(0, 40, 3)))
            self.assertEqual([task[0] for task in result.slow.submitted], [0, 15, 36])
            self.assertTrue(all(start >= 39 for start, _ in result.blocking),
                            'waiting for unfinished I/O is allowed only after stopping')
            snapshots = [value for value in result.history if 'checksCollectedAt' in value]
            self.assertEqual(len(snapshots), 3)
            self.assertEqual([value['checksCollectedAt'] for value in snapshots],
                             [collector.utc_iso(result.base+time) for time in (0,15,36)])
            for value in result.history:
                self.assertTrue(all(key in value for key in ('containers','services','checksCollectedAt'))
                                or all(key not in value for key in ('containers','services','checksCollectedAt')))
                if 'checksCollectedAt' in value:
                    self.assertLessEqual(value['checksCollectedAt'], value['collectedAt'])
            # The final completed snapshot was not in an older immutable POST.
            # It remains durable after queue close/reopen for the next startup.
            with closing(collector.sqlite3.connect(Path(directory)/'queue-v2.sqlite3')) as db:
                rows = [json.loads(row[0]) for row in db.execute('select payload from queue')]
            self.assertTrue(any(value.get('checksCollectedAt') == collector.utc_iso(result.base+36) for value in rows))
            self.assertLessEqual(len(result.delivery.submitted), len(result.starts))

    def test_slow_and_delivery_exceptions_keep_fast_ticks_and_do_not_reuse_old_checks(self):
        with tempfile.TemporaryDirectory() as directory, self.assertLogs(collector.LOGGER, level='WARNING') as logs:
            result = self.simulate(directory, stop_at=21, slow_durations=(4,2),
                                   slow_failures=(0,), delivery_errors=(0,))
        self.assertEqual(result.starts, list(range(0,21,3)))
        snapshots = [value for value in result.history if 'checksCollectedAt' in value]
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]['checksCollectedAt'], collector.utc_iso(result.base+15))
        self.assertNotIn('private', ' '.join(logs.output))
        self.assertTrue(all(start >= 21 for start, _ in result.blocking))

    def test_shutdown_persists_an_outstanding_slow_snapshot_before_queue_close(self):
        with tempfile.TemporaryDirectory() as directory:
            result = self.simulate(directory, stop_at=6, slow_durations=(20,))
            self.assertEqual(result.starts, [0,3,20])
            self.assertEqual(result.blocking[0], (6,20))
            with closing(collector.sqlite3.connect(Path(directory)/'queue-v2.sqlite3')) as db:
                values = [json.loads(row[0]) for row in db.execute('select payload from queue')]
            snapshots = [value for value in values if 'checksCollectedAt' in value]
            self.assertEqual(len(snapshots),1)
            self.assertEqual(snapshots[0]['checksCollectedAt'],collector.utc_iso(result.base))
            self.assertEqual(snapshots[0]['collectedAt'],collector.utc_iso(result.base+20))

    def test_immediate_shutdown_cannot_deduplicate_away_a_same_millisecond_snapshot(self):
        stamp = collector.utc_iso()
        class Stopping:
            stopped = False
            def is_set(self):
                return self.stopped
            def wait(self, seconds):
                self.stopped = True
        class Executor:
            def submit(self, function, *args):
                future = concurrent.futures.Future()
                future.set_result({'containers': [], 'services': [], 'checksCollectedAt': stamp}
                    if function is collector.collect_checks else ())
                return future
        with tempfile.TemporaryDirectory() as directory:
            queue = collector.SampleQueue(Path(directory)/'queue-v2.sqlite3')
            try:
                collector.run_sampling(queue, types.SimpleNamespace(sample=lambda: {'hostname':'test'}),
                    Stopping(), Executor(), object(), Executor(), 'http://127.0.0.1:3000/api/monitor/ingest', 'x'*40,
                    clock=lambda: 0, timestamp=lambda: stamp)
                values = [value for _, value in queue.batch()]
                self.assertEqual(len(values), 2)
                self.assertNotIn('checksCollectedAt', values[0])
                self.assertEqual(values[1]['checksCollectedAt'], stamp)
                self.assertGreater(values[1]['collectedAt'], stamp)
            finally:
                queue.close()

    def test_run_creates_distinct_bounded_pools_and_only_v2_queue(self):
        created=[]
        real_executor=concurrent.futures.ThreadPoolExecutor
        def pool(*args,**kwargs):
            created.append(kwargs['max_workers'])
            return real_executor(*args,**kwargs)
        def sampling(queue,sampler,stopping,slow,probe,delivery,*args,**kwargs):
            self.assertEqual(queue.path.name,'queue-v2.sqlite3')
            self.assertEqual(len({id(slow),id(probe),id(delivery)}),3)
            return 0
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.dict(os.environ,{'MONITOR_INGEST_TOKEN':'x'*48,'MONITOR_STATE_DIR':directory}), \
             mock.patch.dict(sys.modules,{'fcntl':types.SimpleNamespace(flock=mock.Mock(),LOCK_EX=1,LOCK_NB=2)}), \
             mock.patch.object(collector.signal,'signal'), \
             mock.patch.object(collector.concurrent.futures,'ThreadPoolExecutor',side_effect=pool), \
             mock.patch.object(collector,'run_sampling',side_effect=sampling):
            self.assertEqual(collector.run(),0)
            self.assertFalse((Path(directory)/'queue.sqlite3').exists())
        self.assertEqual(created,[1,4,1])

    def test_collect_checks_captures_time_in_slow_worker_before_probes(self):
        owner=threading.get_ident()
        stamp_calls=[]
        def stamp():
            stamp_calls.append(threading.get_ident())
            return '2026-10-24T00:00:00.000Z'
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as slow, \
             concurrent.futures.ThreadPoolExecutor(max_workers=4) as probes, \
             mock.patch.object(collector,'collect_containers',return_value=[]), \
             mock.patch.object(collector,'collect_services',return_value=[]):
            result=slow.submit(collector.collect_checks,probes,stamp).result(timeout=2)
        self.assertEqual(result,{'containers':[],'services':[],'checksCollectedAt':'2026-10-24T00:00:00.000Z'})
        self.assertEqual(len(stamp_calls),1)
        self.assertNotEqual(stamp_calls[0],owner)


class LegacyQueueTests(unittest.TestCase):
    def test_read_only_import_is_idempotent_and_preserves_old_rows_schema_and_bytes(self):
        import hashlib
        now=time.time()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'queue.sqlite3'
            legacy=collector.SampleQueue(path)
            retained=sample(now-30)
            expired=sample(now-4000)
            legacy.enqueue(retained,now=now)
            payload=json.dumps(expired)
            legacy.connection.execute('insert into queue values (?,?,?,?)',
                (expired['hostId']+':'+expired['collectedAt'],now-4000,payload,len(payload)))
            legacy.connection.commit()
            old_rows=legacy.connection.execute('select * from queue order by collected_at').fetchall()
            old_schema=legacy.connection.execute("select sql from sqlite_master where type='table' and name='queue'").fetchone()[0]
            legacy.close()
            original_hash=hashlib.sha256(path.read_bytes()).hexdigest()
            v2=collector.SampleQueue(Path(directory)/'queue-v2.sqlite3')
            try:
                collector.import_legacy_queue(path,v2,now=now)
                collector.import_legacy_queue(path,v2,now=now)
                self.assertEqual(v2.count(),1)
                self.assertEqual(v2.batch()[0][1],retained)
                self.assertEqual(len(v2.connection.execute('pragma table_info(queue)').fetchall()),4)
            finally:
                v2.close()
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),original_hash)
            with closing(collector.sqlite3.connect(path)) as check:
                self.assertEqual(check.execute('select * from queue order by collected_at').fetchall(),old_rows)
                self.assertEqual(check.execute("select sql from sqlite_master where type='table' and name='queue'").fetchone()[0],old_schema)

    def test_missing_or_unreadable_legacy_queue_does_not_create_or_replace_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'queue.sqlite3'
            v2=collector.SampleQueue(Path(directory)/'queue-v2.sqlite3')
            try:
                collector.import_legacy_queue(path,v2)
                self.assertFalse(path.exists())
                path.write_bytes(b'not a sqlite database')
                with self.assertLogs(collector.LOGGER,level='WARNING'):
                    collector.import_legacy_queue(path,v2)
                self.assertEqual(path.read_bytes(),b'not a sqlite database')
                self.assertEqual(v2.count(),0)
            finally:
                v2.close()


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

    def test_network_worker_only_receives_frozen_bytes_and_ack_waits_for_coordinator(self):
        owner = threading.get_ident()
        threads = []
        first = sample()
        self.queue.enqueue(first)
        frozen = collector.delivery_batch(self.queue)
        self.assertIsInstance(frozen[0], tuple)
        self.assertIsInstance(frozen[1], bytes)
        first['host']['hostname'] = 'changed-after-freeze'
        second = sample(time.time()+1)
        self.queue.enqueue(second)
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value.status = 200
        def worker_opener():
            threads.append(threading.get_ident())
            return opener
        with mock.patch.object(collector, 'local_http_opener', side_effect=worker_opener), \
             concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            acknowledged = executor.submit(collector.send_delivery_batch, frozen,
                'http://127.0.0.1:3000/api/monitor/ingest', 'x'*40).result(timeout=2)
        self.assertNotEqual(threads[0], owner)
        self.assertEqual(self.queue.count(), 2, 'worker must not delete any SQLite rows')
        posted = opener.open.call_args.args[0].data
        self.assertNotEqual(json.loads(posted)['samples'][0]['host']['hostname'], 'changed-after-freeze')
        self.queue.acknowledge(acknowledged)
        self.assertEqual(self.queue.count(), 1)
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
        response = mock.Mock()
        with mock.patch.object(collector, "local_http_opener") as factory:
            factory.return_value.open.side_effect = urllib.error.HTTPError("http://127.0.0.1", 302, "redirect", {}, response)
            collector.deliver(self.queue, "http://127.0.0.1:3000/api/monitor/ingest", "secret")
        self.assertEqual(self.queue.count(), 1)
        response.close.assert_called_once()
        response.read.assert_not_called()


class EndpointTests(unittest.TestCase):
    def test_endpoint_must_be_loopback_and_token_cannot_redirect(self):
        self.assertEqual(collector.validate_endpoint("http://127.0.0.1:3000/api/monitor/ingest"), "http://127.0.0.1:3000/api/monitor/ingest")
        for value in ("https://example.com/api/monitor/ingest", "http://localhost:3000/api/monitor/ingest", "http://secret@127.0.0.1:3000/api/monitor/ingest", "http://127.0.0.1:3000/api/monitor/ingest?token=bad"):
            with self.assertRaises(ValueError):
                collector.validate_endpoint(value)
        self.assertIsNone(collector.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))


if __name__ == "__main__":
    unittest.main()

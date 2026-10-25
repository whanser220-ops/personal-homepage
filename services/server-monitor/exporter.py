#!/usr/bin/env python3
"""Loopback-only, pull-based Prometheus exporter. Python 3.10+ stdlib.

Prometheus owns the 3 s host / 15 s checks schedule. Only the proven, fixed
read-only sampling functions are reused from collector.py; its push delivery,
credentials, SQLite queue and main entry point are never invoked here.
"""

import argparse
import concurrent.futures
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import logging
import math
import re
import signal
import threading
import time

import collector


LOGGER = logging.getLogger("server-monitor-exporter")
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 19100
PREFIX = "server_monitor_"
HOST_FIELDS = (
    ("host_cpu_percent", ("cpu", "percent")),
    ("host_load1", ("cpu", "load1")),
    ("host_load5", ("cpu", "load5")),
    ("host_load15", ("cpu", "load15")),
    ("host_cpu_cores", ("cpu", "cores")),
    *(("host_memory_" + suffix, ("memory", field)) for suffix, field in (
        ("total_bytes", "totalBytes"), ("available_bytes", "availableBytes"),
        ("used_bytes", "usedBytes"), ("used_percent", "usedPercent"))),
    *(("host_swap_" + suffix, ("swap", field)) for suffix, field in (
        ("total_bytes", "totalBytes"), ("used_bytes", "usedBytes"), ("used_percent", "usedPercent"))),
    *(("host_disk_" + suffix, ("disk", field)) for suffix, field in (
        ("total_bytes", "totalBytes"), ("used_bytes", "usedBytes"),
        ("available_bytes", "availableBytes"), ("used_percent", "usedPercent"),
        ("read_bytes_per_second", "readBytesPerSecond"),
        ("write_bytes_per_second", "writeBytesPerSecond"))),
    ("host_network_rx_bytes_per_second", ("network", "rxBytesPerSecond")),
    ("host_network_tx_bytes_per_second", ("network", "txBytesPerSecond")),
    ("host_uptime_seconds", ("uptimeSeconds",)),
)
CONTAINER_FIELDS = (
    ("container_restart_count", "restartCount"),
    ("container_cpu_percent", "cpuPercent"),
    ("container_memory_bytes", "memoryBytes"),
    ("container_memory_limit_bytes", "memoryLimitBytes"),
    ("container_memory_percent", "memoryPercent"),
)
SERVICE_FIELDS = (("service_latency_ms", "latencyMs"), ("service_http_status", "httpStatus"))


def label_value(value):
    """Prometheus text format permits UTF-8 labels; escape its three specials."""
    return ("" if value is None else str(value)).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


class MetricsText:
    def __init__(self):
        self.lines = []
        self.declared = set()

    def gauge(self, suffix, value, labels):
        # Missing counters, resets and unsupported metrics remain absent. Zero
        # must never be substituted for an unknown sample or first-frame rate.
        if value is None or isinstance(value, bool):
            return
        try:
            number = float(value)
            if not math.isfinite(number):
                return
        except (TypeError, ValueError, OverflowError):
            return
        name = PREFIX + suffix
        if name not in self.declared:
            self.lines.append("# TYPE " + name + " gauge")
            self.declared.add(name)
        dimensions = ",".join(key + '="' + label_value(item) + '"' for key, item in labels.items())
        value = value if isinstance(value, (int, float)) else number
        self.lines.append(name + "{" + dimensions + "} " + str(value))

    def encode(self):
        # A final newline is required by Prometheus text exposition format.
        return ("\n".join(self.lines) + "\n").encode("utf-8")


def render_host(host_id, host, captured_at):
    text = MetricsText()
    labels = {"host_id": host_id}
    text.gauge("host_info", 1, {**labels, "hostname": host.get("hostname"),
                               "mount": host.get("disk", {}).get("mount"),
                               "interface": host.get("network", {}).get("interface")})
    text.gauge("host_collected_at_seconds", captured_at, labels)
    for suffix, path in HOST_FIELDS:
        value = host
        for field in path:
            value = value.get(field) if isinstance(value, dict) else None
        text.gauge(suffix, value, labels)
    return text.encode()


def render_checks(host_id, checks, captured_at):
    text = MetricsText()
    labels = {"host_id": host_id}
    text.gauge("checks_collected_at_seconds", captured_at, labels)
    for container in checks["containers"]:
        identity = {**labels, "name": container["name"]}
        text.gauge("container_info", 1, {**identity, **{
            field: container.get(field) for field in ("image", "state", "health")}})
        for suffix, field in CONTAINER_FIELDS:
            text.gauge(suffix, container.get(field), identity)
    for service in checks["services"]:
        identity = {**labels, "id": service["id"]}
        text.gauge("service_info", 1, {**identity, **{
            field: service.get(field) for field in ("name", "kind", "status", "detail")}})
        for suffix, field in SERVICE_FIELDS:
            text.gauge(suffix, service.get(field), identity)
    return text.encode()


class Exporter:
    """Independent bounded host/check paths; no queued or overlapping samples."""
    def __init__(self, host_id="cloud-primary", interface=None, *, sampler=None,
                 checks_sampler=None, clock=time.time):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", host_id):
            raise ValueError("invalid host id")
        if interface and not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", interface):
            raise ValueError("invalid network interface")
        self.host_id = host_id
        self.clock = clock
        self.sampler = sampler or collector.HostSampler(interface=interface)
        self.checks_sampler = checks_sampler or collector.collect_checks
        self.probes = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="monitor-probe")
        self.locks = {scope: threading.Lock() for scope in ("host", "checks")}
        self.cache = {}

    def scrape(self, scope):
        if scope not in self.locks:
            raise ValueError("invalid metrics scope")
        lock = self.locks[scope]
        if not lock.acquire(blocking=False):
            # A duplicate scrape cannot extend a probe deadline or initiate
            # another batch. An old response keeps its old capture timestamp.
            return self.cache.get(scope)
        try:
            captured_at = self.clock()
            if scope == "host":
                payload = render_host(self.host_id, self.sampler.sample(), captured_at)
            else:
                checks = self.checks_sampler(self.probes, lambda: collector.utc_iso(captured_at))
                payload = render_checks(self.host_id, checks, captured_at)
            self.cache[scope] = payload
            return payload
        except Exception:
            # Prometheus records up=0 for this scrape; never stamp cached or
            # fabricated values as a fresh collection after a failure.
            LOGGER.warning("%s collection failed without telemetry", scope)
            return None
        finally:
            lock.release()

    def close(self):
        self.probes.shutdown(wait=True, cancel_futures=True)


class MetricsHandler(BaseHTTPRequestHandler):
    server_version = "ServerMonitorExporter"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def respond(self, status, payload, content_type="text/plain; version=0.0.4; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        self.close_connection = True

    def do_GET(self):
        if self.path == "/health":
            self.respond(200, b"ok\n", "text/plain; charset=utf-8")
            return
        if self.path not in ("/metrics/host", "/metrics/checks"):
            self.respond(404, b"not found\n")
            return
        payload = self.server.exporter.scrape(self.path.rsplit("/", 1)[-1])
        self.respond(200, payload) if payload is not None else self.respond(503, b"collection unavailable\n")

    def do_POST(self):
        self.respond(405, b"method not allowed\n")

    def log_message(self, *_):
        # Request paths and headers are never copied to logs.
        pass


class MetricsServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    request_queue_size = 4

    def __init__(self, address, exporter, max_requests=4):
        if address[0] != LISTEN_HOST:
            raise ValueError("exporter must bind IPv4 loopback only")
        self.exporter = exporter
        self.request_slots = threading.BoundedSemaphore(max_requests)
        super().__init__(address, MetricsHandler)

    def get_request(self):
        request, address = super().get_request()
        request.settimeout(3)
        return request, address

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            # No unbounded executor queue or one-thread-per-connection growth.
            try:
                request.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

    def handle_error(self, request, client_address):
        # Do not print exception contents or raw request data to journald.
        LOGGER.warning("metrics request failed")


def run(port=LISTEN_PORT, host_id="cloud-primary", interface=None):
    if not 1024 <= port <= 65535:
        raise ValueError("invalid exporter port")
    exporter = Exporter(host_id, interface)
    stopping = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stopping.set())
    try:
        with MetricsServer((LISTEN_HOST, port), exporter) as server:
            worker = threading.Thread(target=server.serve_forever, name="monitor-http")
            worker.start()
            try:
                while not stopping.wait(0.5):
                    pass
            finally:
                server.shutdown()
                worker.join()
    finally:
        exporter.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Expose read-only host telemetry to local Prometheus")
    parser.add_argument("--port", type=int, default=LISTEN_PORT)
    parser.add_argument("--host-id", default="cloud-primary")
    parser.add_argument("--interface")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(run(arguments.port, arguments.host_id, arguments.interface))
    except (OSError, ValueError):
        LOGGER.error("exporter stopped; verify loopback port and local dependencies")
        raise SystemExit(1)

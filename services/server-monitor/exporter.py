#!/usr/bin/env python3
"""Only project-specific Docker metadata and process checks. Python 3.10+.

Prometheus scrapes /metrics/custom every 15 s. Host resources, container
resources and HTTP/TCP probes belong to node_exporter, cAdvisor and blackbox.
No host sampler, Docker stats, SQLite, push transport or credential is used.
The legacy collector.py remains separate and is never imported by this service.
"""

import argparse
import concurrent.futures
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
import re
import signal
import subprocess
import threading
import time

LOGGER = logging.getLogger("server-monitor-exporter")
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 19104
PREFIX = "server_monitor_custom_"
PROBE_TIMEOUT = 3
CACHE_MIN_SECONDS = 14
CONTAINER_NAMES = ("personal-homepage", "learning-whiteboard", "personal-homepage-postgres")
SYSTEMD_SERVICES = (
    ("study-agent", "Study Agent 进程", "study-agent.service"),
    ("study-agent-remote", "远程运行进程", "study-agent-remote.service"),
    ("nginx", "Nginx 进程", "nginx.service"),
    ("docker", "Docker 进程", "docker.service"),
)


def command(argv, timeout=PROBE_TIMEOUT):
    """Fixed, bounded read-only commands; never return or log stderr."""
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout[:65536]
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return None, ""


def service_result(identifier, name, status="unknown", detail="探测未返回结果"):
    return {"id": identifier, "name": name, "kind": "process", "status": status, "detail": detail}


def collect_container_metadata():
    # Docker's fixed Go template never includes Config.Env or Health.Log.
    # Docker 29 treats an absent Health map key as a template error; index/with
    # keeps containers without a configured health check in the same batch.
    template = ('{"name":{{json .Name}},"containerId":{{json .Id}},"image":{{json .Config.Image}},'
                '"state":{{json .State.Status}},"health":'
                '{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}},'
                '"restartCount":{{.RestartCount}}}')
    _, output = command(["docker", "inspect", "--format", template, *CONTAINER_NAMES])
    inspected = {}
    for line in output.splitlines():
        try:
            item = json.loads(line)
            name = item["name"].lstrip("/")
            if name in CONTAINER_NAMES:
                inspected[name] = item
        except (ValueError, TypeError, KeyError, AttributeError):
            continue
    containers = []
    for name in CONTAINER_NAMES:
        item = inspected.get(name, {})
        identity = item.get("containerId")
        image = item.get("image")
        restarts = item.get("restartCount")
        containers.append({
            "name": name,
            "containerId": identity if isinstance(identity, str) and re.fullmatch(r"[0-9a-f]{64}", identity) else None,
            "image": image if isinstance(image, str) and len(image) <= 256 else None,
            "state": item.get("state") if item.get("state") in ("created", "restarting", "running", "removing", "paused", "exited", "dead") else "unknown",
            "health": item.get("health") if item.get("health") in ("healthy", "unhealthy", "starting") else "unknown",
            "restartCount": restarts if isinstance(restarts, int) and not isinstance(restarts, bool) and 0 <= restarts <= 2 ** 53 - 1 else None,
        })
    return containers


def systemd_probes():
    # Preserve the existing process-only semantics, using one fixed field query.
    units = [unit for _, _, unit in SYSTEMD_SERVICES]
    code, output = command(["systemctl", "show", "--property=Id,LoadState,ActiveState", *units])
    states, properties = {}, {}
    if code is not None:
        for line in [*output.splitlines(), ""]:
            if not line.strip():
                if properties.get("Id") in units:
                    states[properties["Id"]] = properties
                properties = {}
            elif "=" in line:
                key, value = line.split("=", 1)
                if key in ("Id", "LoadState", "ActiveState"):
                    properties[key] = value
    results = []
    for identifier, name, unit in SYSTEMD_SERVICES:
        item = states.get(unit, {})
        load, state = item.get("LoadState"), item.get("ActiveState")
        if load == "not-found":
            result = service_result(identifier, name, detail="systemd 单元不存在")
        elif load in ("loaded", "masked") and state == "active":
            result = service_result(identifier, name, "healthy", "systemd active；仅验证进程运行")
        elif load in ("error", "bad-setting", "masked"):
            result = service_result(identifier, name, "unhealthy", "systemd 单元无法加载")
        elif load == "loaded" and state in ("inactive", "failed", "activating", "deactivating", "reloading", "maintenance"):
            result = service_result(identifier, name, "unhealthy", "systemd " + state)
        else:
            result = service_result(identifier, name, detail="无法读取 systemd 进程状态")
        results.append(result)
    return results


def postgres_probe():
    # Only these non-secret identity variables are expanded inside the container;
    # no environment or password is read back or exported. -q suppresses output.
    probe = 'exec pg_isready -q -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"'
    code, _ = command(["docker", "exec", "personal-homepage-postgres", "sh", "-c", probe])
    if code == 0:
        return service_result("postgres", "PostgreSQL", "healthy", "容器内 pg_isready 接受连接")
    if code in (1, 2):
        return service_result("postgres", "PostgreSQL", "unhealthy", "pg_isready 未通过")
    return service_result("postgres", "PostgreSQL", detail="无法运行容器内 pg_isready")


def collect_custom(executor):
    # One HTTP coordinator submits exactly three leaf jobs to a persistent,
    # three-worker pool. Each subprocess has its own 3 s deadline.
    futures = [executor.submit(function) for function in
               (collect_container_metadata, systemd_probes, postgres_probe)]
    results = [None, None, None]
    for index, future in enumerate(futures):
        try:
            results[index] = future.result()
        except Exception:
            LOGGER.warning("custom probe failed without a result")
    if results[0] is None:
        # Unknown metadata is preferable to inventing a container ID or state.
        results[0] = [{"name": name} for name in CONTAINER_NAMES]
    if results[1] is None:
        results[1] = [service_result(identifier, name) for identifier, name, _ in SYSTEMD_SERVICES]
    if results[2] is None:
        results[2] = service_result("postgres", "PostgreSQL")
    return {"containers": results[0], "services": [*results[1], results[2]]}


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


def render_custom(host_id, checks, captured_at):
    text = MetricsText()
    labels = {"host_id": host_id}
    text.gauge("collected_at_seconds", captured_at, labels)
    for container in checks["containers"]:
        identity = {**labels, "name": container["name"]}
        if container.get("containerId"):
            identity["container_id"] = container["containerId"]
        text.gauge("container_info", 1, {**identity, "image": container.get("image"),
                                       "state": container.get("state") or "unknown",
                                       "health": container.get("health") or "unknown"})
        text.gauge("container_restart_count", container.get("restartCount"), identity)
    for service in checks["services"]:
        identity = {**labels, "id": service["id"]}
        text.gauge("service_info", 1, {**identity, **{
            field: service.get(field) for field in ("name", "kind", "status", "detail")}})
    return text.encode()


class Exporter:
    """One bounded custom snapshot; no overlapping collection or task queue."""
    def __init__(self, host_id="cloud-primary", *, custom_sampler=None, clock=time.time, monotonic=time.monotonic):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", host_id):
            raise ValueError("invalid host id")
        self.host_id = host_id
        self.clock = clock
        self.monotonic = monotonic
        self.custom_sampler = custom_sampler or collect_custom
        self.probes = concurrent.futures.ThreadPoolExecutor(max_workers=3, thread_name_prefix="monitor-custom")
        self.lock = threading.Lock()
        self.cache = None
        self.next_capture_at = 0

    def scrape(self):
        if not self.lock.acquire(blocking=False):
            # A duplicate scrape cannot extend a probe deadline or initiate
            # another batch. An old response keeps its old capture timestamp.
            return self.cache
        try:
            started = self.monotonic()
            # Two Prometheus instances may briefly overlap during shadow
            # validation. Keep their fixed commands from running twice per
            # interval, with 1 s jitter margin for the normal 15 s scrape.
            # Reused bytes retain the original capture timestamp and age.
            if self.cache is not None and started < self.next_capture_at:
                return self.cache
            captured_at = self.clock()
            payload = render_custom(self.host_id, self.custom_sampler(self.probes), captured_at)
            self.cache = payload
            self.next_capture_at = started + CACHE_MIN_SECONDS
            return payload
        except Exception:
            # Prometheus records up=0 for this scrape; never stamp cached or
            # fabricated values as a fresh collection after a failure.
            LOGGER.warning("custom collection failed without telemetry")
            return None
        finally:
            self.lock.release()

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
        if self.path != "/metrics/custom":
            self.respond(404, b"not found\n")
            return
        payload = self.server.exporter.scrape()
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


def run(port=LISTEN_PORT, host_id="cloud-primary"):
    if not 1024 <= port <= 65535:
        raise ValueError("invalid exporter port")
    exporter = Exporter(host_id)
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


def parse_arguments(argv=None):
    parser = argparse.ArgumentParser(description="Expose custom Docker metadata and process checks to local Prometheus")
    parser.add_argument("--port", type=int, default=LISTEN_PORT)
    parser.add_argument("--host-id", default="cloud-primary")
    return parser.parse_args(argv)


if __name__ == "__main__":
    arguments = parse_arguments()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(run(arguments.port, arguments.host_id))
    except (OSError, ValueError):
        LOGGER.error("exporter stopped; verify loopback port and local dependencies")
        raise SystemExit(1)

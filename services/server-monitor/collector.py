#!/usr/bin/env python3
"""Small, host-side server monitor. Python 3.10+; no third-party packages.

Only fixed, read-only probes are executed. Never read process arguments, container
environment, HTTP bodies, or Docker health-check logs into the telemetry queue.
"""

import argparse
import concurrent.futures
import datetime as dt
import json
import logging
import math
import os
from pathlib import Path
import re
import signal
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


LOGGER = logging.getLogger("server-monitor")
INTERVAL_SECONDS = 3
CHECK_INTERVAL_SECONDS = 15
RETENTION_SECONDS = 3600
QUEUE_MAX_BYTES = 20 * 1024 * 1024
BATCH_SIZE = 20
PROBE_TIMEOUT = 3
_HTTP_LOCAL = threading.local()
CONTAINER_NAMES = (
    # Jenkins now runs in local WSL; probe its forwarded HTTP endpoint below.
    # The stopped cloud container is retained for rollback, not current health.
    "personal-homepage", "learning-whiteboard",
    "personal-homepage-postgres",
)
HTTP_SERVICES = (
    ("website", "个人网站", "http://127.0.0.1:3000/api/health"),
    ("whiteboard", "学习白板", "http://127.0.0.1:4310/whiteboard/health"),
    ("jenkins", "Jenkins", "http://127.0.0.1:8080/login"),
    ("study-agent-http", "Study Agent HTTP", "http://127.0.0.1:4320/"),
)
SYSTEMD_SERVICES = (
    ("study-agent", "Study Agent 进程", "study-agent.service"),
    ("study-agent-remote", "远程运行进程", "study-agent-remote.service"),
    ("nginx", "Nginx 进程", "nginx.service"),
    ("docker", "Docker 进程", "docker.service"),
)


def utc_iso(timestamp=None):
    value = dt.datetime.fromtimestamp(timestamp, dt.timezone.utc) if timestamp is not None else dt.datetime.now(dt.timezone.utc)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def finite_number(value):
    try:
        number = float(value)
        return number if math.isfinite(number) and number >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def rate(current, previous, elapsed):
    if current is None or previous is None or elapsed <= 0 or current < previous:
        return None
    return round((current - previous) / elapsed, 2)


def command(argv, timeout=PROBE_TIMEOUT):
    """Return bounded stdout from a fixed command; deliberately discard stderr."""
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout[:65536]
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return None, ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def local_http_opener():
    # All collector URLs are local HTTP. build_opener() also constructs an
    # HTTPSHandler/SSL context, which is unnecessary work for every probe.
    # urllib handlers keep parent/state references: cache within each thread,
    # never share one opener across the persistent pool's worker threads.
    opener = getattr(_HTTP_LOCAL, "opener", None)
    if opener is None:
        opener = urllib.request.OpenerDirector()
        for handler in (urllib.request.ProxyHandler({}), urllib.request.UnknownHandler(),
                        urllib.request.HTTPHandler(), urllib.request.HTTPDefaultErrorHandler(),
                        NoRedirect(), urllib.request.HTTPErrorProcessor()):
            opener.add_handler(handler)
        _HTTP_LOCAL.opener = opener
    return opener


def service_result(identifier, name, kind, status="unknown", **extra):
    return {"id": identifier, "name": name, "kind": kind, "status": status,
            "latencyMs": None, "httpStatus": None, "detail": None, **extra}


def http_probe(identifier, name, url):
    start = time.monotonic()
    status = None
    try:
        request = urllib.request.Request(url, method="GET", headers={"User-Agent": "personal-homepage-monitor/1"})
        with local_http_opener().open(request, timeout=PROBE_TIMEOUT) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
    except (OSError, urllib.error.URLError, ValueError):
        return service_result(identifier, name, "http", "unhealthy", detail="本机 HTTP 请求失败或超时")
    elapsed = round((time.monotonic() - start) * 1000, 1)
    if 200 <= status < 300:
        return service_result(identifier, name, "http", "healthy", latencyMs=elapsed, httpStatus=status, detail="HTTP 检查通过（服务器本机视角）")
    if 300 <= status < 400 or status in (401, 403):
        return service_result(identifier, name, "http", "reachable", latencyMs=elapsed, httpStatus=status, detail="认证或跳转响应；仅证明 HTTP 端点可达")
    return service_result(identifier, name, "http", "unhealthy", latencyMs=elapsed, httpStatus=status, detail="HTTP 检查返回错误状态")


def tcp_probe(identifier, name, port):
    start = time.monotonic()
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=PROBE_TIMEOUT):
            pass
        return service_result(identifier, name, "tcp", "reachable", latencyMs=round((time.monotonic() - start) * 1000, 1), detail="仅验证本机 TCP 端口可达，未验证业务健康")
    except OSError:
        return service_result(identifier, name, "tcp", "unhealthy", detail="本机 TCP 连接失败或超时")


def systemd_probes():
    units = [unit for _, _, unit in SYSTEMD_SERVICES]
    code, output = command(["systemctl", "show", "--property=Id,LoadState,ActiveState", *units])
    states = {}
    if code is not None:
        properties = {}
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
        properties = states.get(unit, {})
        load, state = properties.get("LoadState"), properties.get("ActiveState")
        if load == "not-found":
            result = service_result(identifier, name, "process", detail="systemd 单元不存在")
        elif load in ("loaded", "masked") and state == "active":
            # Masking prevents a future start, but an already-running process
            # still satisfies the same process-only check as is-active did.
            result = service_result(identifier, name, "process", "healthy", detail="systemd active；仅验证进程运行")
        elif load in ("error", "bad-setting", "masked"):
            result = service_result(identifier, name, "process", "unhealthy", detail="systemd 单元无法加载")
        elif load == "loaded" and state in ("inactive", "failed", "activating", "deactivating", "reloading", "maintenance"):
            result = service_result(identifier, name, "process", "unhealthy", detail="systemd " + state)
        else:
            result = service_result(identifier, name, "process", detail="无法读取 systemd 进程状态")
        results.append(result)
    return results


def postgres_probe():
    # docker exec otherwise inherits the container's root OS identity, causing
    # PostgreSQL to log FATAL role "root" on every probe despite readiness.
    # Expand only the two non-secret identity variables inside the container;
    # never inspect or export its complete environment or password.
    probe = 'exec pg_isready -q -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"'
    code, _ = command(["docker", "exec", "personal-homepage-postgres", "sh", "-c", probe])
    if code == 0:
        return service_result("postgres", "PostgreSQL", "process", "healthy", detail="容器内 pg_isready 接受连接")
    if code in (1, 2):
        return service_result("postgres", "PostgreSQL", "process", "unhealthy", detail="pg_isready 未通过")
    return service_result("postgres", "PostgreSQL", "process", detail="无法运行容器内 pg_isready")


def collect_services(executor):
    jobs = [(http_probe, values) for values in HTTP_SERVICES]
    jobs += [(systemd_probes, ())]
    jobs += [(tcp_probe, ("remote-run-port", "远程运行端口", 4321)),
             (tcp_probe, ("perforce", "Perforce", 1666)), (postgres_probe, ())]
    # Called by a coordinator outside this leaf pool, never one of its workers.
    # Every job has its own timeout and all finish before the next sample starts.
    futures = [executor.submit(function, *args) for function, args in jobs]
    results = []
    for (function, args), future in zip(jobs, futures):
        try:
            if function is systemd_probes:
                results.extend(future.result())
            else:
                results.append(future.result())
        except Exception:
            # Never include exception text; external commands/HTTP errors can
            # otherwise turn sensitive information into stored telemetry.
            LOGGER.warning("service probe failed without a result")
            if function is systemd_probes:
                results.extend(service_result(identifier, name, "process", detail="探测未返回结果")
                               for identifier, name, _ in SYSTEMD_SERVICES)
            elif function is postgres_probe:
                results.append(service_result("postgres", "PostgreSQL", "process", detail="探测未返回结果"))
            else:
                kind = "http" if function is http_probe else "tcp"
                results.append(service_result(args[0], args[1], kind, detail="探测未返回结果"))
    return results


def collect_checks(executor, timestamp=None):
    """One slow batch, coordinated outside its bounded leaf-probe pool."""
    started_at = (timestamp or utc_iso)()
    containers = executor.submit(collect_containers)
    try:
        services = collect_services(executor)
    finally:
        # Even an unexpected service-batch exception must not leave an old
        # container job running when the next slow batch is allowed to start.
        container_values = containers.result()
    return {"containers": container_values, "services": services,
            "checksCollectedAt": started_at}


def parse_memory_size(value):
    match = re.fullmatch(r"\s*([\d.]+)\s*([KMGTPE]?i?B)\s*", value or "", re.IGNORECASE)
    if not match:
        return None
    number = finite_number(match.group(1))
    if number is None:
        return None
    unit = match.group(2).upper()
    exponent = "KMGTPE".find(unit[0]) + 1 if unit != "B" else 0
    return int(number * ((1024 if "I" in unit else 1000) ** exponent))


def parse_percent(value):
    return finite_number((value or "").strip().removesuffix("%"))


def collect_containers():
    template = ('{"name":{{json .Name}},"image":{{json .Config.Image}},'
                '"state":{{json .State.Status}},"health":'
                '{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},'
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
    _, output = command(["docker", "stats", "--no-stream", "--format", "{{json .}}", *CONTAINER_NAMES], timeout=5)
    stats = {}
    for line in output.splitlines():
        try:
            item = json.loads(line)
            if item.get("Name") in CONTAINER_NAMES:
                stats[item["Name"]] = item
        except (ValueError, TypeError, AttributeError):
            continue
    containers = []
    for name in CONTAINER_NAMES:
        meta, usage = inspected.get(name, {}), stats.get(name, {})
        parts = usage.get("MemUsage", "").split("/")
        memory = parse_memory_size(parts[0]) if len(parts) == 2 else None
        limit = parse_memory_size(parts[1]) if len(parts) == 2 else None
        containers.append({"name": name, "image": meta.get("image"),
                           "state": meta.get("state", "unknown"),
                           "health": meta.get("health") or "unknown",
                           "restartCount": meta.get("restartCount"),
                           "cpuPercent": parse_percent(usage.get("CPUPerc")),
                           "memoryBytes": memory, "memoryLimitBytes": limit,
                           "memoryPercent": parse_percent(usage.get("MemPerc"))})
    return containers


class HostSampler:
    def __init__(self, proc_root="/proc", interface=None, mount="/", clock=time.monotonic):
        self.proc = Path(proc_root)
        self.interface_override = interface
        self.mount = mount
        self.clock = clock
        self.previous = None

    def read(self, path):
        try:
            return (self.proc / path).read_text(encoding="ascii")
        except (OSError, UnicodeError):
            return ""

    def cpu_counters(self):
        first = self.read("stat").splitlines()
        try:
            values = [int(value) for value in first[0].split()[1:9]]
            return sum(values), values[3] + (values[4] if len(values) > 4 else 0)
        except (ValueError, IndexError):
            return None, None

    def memory(self):
        values = {}
        for line in self.read("meminfo").splitlines():
            try:
                key, value = line.split(":", 1)
                values[key] = int(value.strip().split()[0]) * 1024
            except (ValueError, IndexError):
                continue
        total, available = values.get("MemTotal"), values.get("MemAvailable")
        used = max(0, total - available) if total is not None and available is not None else None
        swap_total, swap_free = values.get("SwapTotal"), values.get("SwapFree")
        swap_used = max(0, swap_total - swap_free) if swap_total is not None and swap_free is not None else None
        memory = {"totalBytes": total, "availableBytes": available, "usedBytes": used,
                  "usedPercent": round(used / total * 100, 2) if total and used is not None else None}
        swap = {"totalBytes": swap_total, "usedBytes": swap_used,
                "usedPercent": round(swap_used / swap_total * 100, 2) if swap_total and swap_used is not None else (0 if swap_total == 0 else None)}
        return memory, swap

    def network_interface(self):
        if self.interface_override:
            return self.interface_override
        candidates = []
        for line in self.read("net/route").splitlines()[1:]:
            columns = line.split()
            try:
                if columns[1] == "00000000" and int(columns[3], 16) & 1 and not re.match(r"^(lo$|docker|veth|br-|virbr|tun|tap)", columns[0]):
                    candidates.append((int(columns[6]), columns[0]))
            except (ValueError, IndexError):
                continue
        return min(candidates)[1] if candidates else None

    def network_counters(self, interface):
        for line in self.read("net/dev").splitlines():
            if ":" not in line:
                continue
            name, data = line.split(":", 1)
            if name.strip() == interface:
                try:
                    values = data.split()
                    return int(values[0]), int(values[8])
                except (ValueError, IndexError):
                    break
        return None, None

    def disk_counters(self):
        try:
            device = os.stat(self.mount).st_dev
            major, minor = os.major(device), os.minor(device)
        except (OSError, AttributeError):
            return None, None
        for line in self.read("diskstats").splitlines():
            columns = line.split()
            try:
                if int(columns[0]) == major and int(columns[1]) == minor:
                    return int(columns[5]) * 512, int(columns[9]) * 512
            except (ValueError, IndexError):
                continue
        return None, None

    def sample(self):
        now = self.clock()
        cpu_total, cpu_idle = self.cpu_counters()
        interface = self.network_interface()
        rx, tx = self.network_counters(interface)
        read_bytes, write_bytes = self.disk_counters()
        current = {"time": now, "cpu_total": cpu_total, "cpu_idle": cpu_idle,
                   "rx": rx, "tx": tx, "read": read_bytes, "write": write_bytes,
                   "interface": interface}
        previous = self.previous or {}
        elapsed = now - previous.get("time", now)
        percent = None
        if cpu_total is not None and cpu_idle is not None and previous.get("cpu_total") is not None and previous.get("cpu_idle") is not None:
            delta_total, delta_idle = cpu_total - previous["cpu_total"], cpu_idle - previous["cpu_idle"]
            if delta_total > 0 and delta_idle >= 0 and elapsed > 0:
                percent = round(max(0, min(100, 100 * (delta_total - delta_idle) / delta_total)), 2)
        memory, swap = self.memory()
        disk = {"mount": self.mount, "totalBytes": None, "usedBytes": None,
                "availableBytes": None, "usedPercent": None,
                "readBytesPerSecond": rate(read_bytes, previous.get("read"), elapsed),
                "writeBytesPerSecond": rate(write_bytes, previous.get("write"), elapsed)}
        try:
            usage = os.statvfs(self.mount)
            total = usage.f_blocks * usage.f_frsize
            free = usage.f_bfree * usage.f_frsize
            available = usage.f_bavail * usage.f_frsize
            used = total - free
            disk.update(totalBytes=total, usedBytes=used, availableBytes=available,
                        usedPercent=round(used / total * 100, 2) if total else None)
        except (OSError, AttributeError):
            pass
        load = self.read("loadavg").split()
        uptime = self.read("uptime").split()
        # Counter resets (reboot, interface replacement, device remount) become
        # null rates. No backwards/negative traffic is fabricated.
        same_interface = interface is not None and interface == previous.get("interface")
        result = {"hostname": socket.gethostname()[:128],
                  "cpu": {"percent": percent, "load1": finite_number(load[0]) if load else None,
                          "load5": finite_number(load[1]) if len(load) > 1 else None,
                          "load15": finite_number(load[2]) if len(load) > 2 else None,
                          "cores": os.cpu_count()},
                  "memory": memory, "swap": swap, "disk": disk,
                  "network": {"interface": interface,
                              "rxBytesPerSecond": rate(rx, previous.get("rx"), elapsed) if same_interface else None,
                              "txBytesPerSecond": rate(tx, previous.get("tx"), elapsed) if same_interface else None},
                  "uptimeSeconds": finite_number(uptime[0]) if uptime else None}
        self.previous = current
        return result


class SampleQueue:
    """SQLite queue whose successful-ack removal and retention survive restart."""
    def __init__(self, path, retention_seconds=RETENTION_SECONDS, max_bytes=QUEUE_MAX_BYTES):
        self.path = Path(path)
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.retention_seconds = retention_seconds
        self.max_bytes = max_bytes
        self.connection = sqlite3.connect(str(self.path), timeout=5)
        self.connection.execute("PRAGMA auto_vacuum=FULL")
        self.connection.execute("PRAGMA journal_mode=DELETE")
        self.connection.execute("PRAGMA synchronous=FULL")
        page_size = self.connection.execute("PRAGMA page_size").fetchone()[0]
        self.connection.execute("PRAGMA max_page_count=" + str(max(4, max_bytes // page_size)))
        self.connection.execute("CREATE TABLE IF NOT EXISTS queue (sample_key TEXT PRIMARY KEY, collected_at REAL NOT NULL, payload TEXT NOT NULL, payload_bytes INTEGER NOT NULL)")
        self.connection.execute("CREATE INDEX IF NOT EXISTS queue_time ON queue(collected_at)")
        self.connection.commit()
        os.chmod(self.path, 0o600)

    def prune(self, now=None):
        now = time.time() if now is None else now
        before = self.count()
        self.connection.execute("DELETE FROM queue WHERE collected_at < ?", (now - self.retention_seconds,))
        # Reserve headroom for B-tree pages, indices and a transaction journal.
        budget = max(1024, int(self.max_bytes * 0.40))
        size = self.connection.execute("SELECT COALESCE(SUM(payload_bytes), 0) FROM queue").fetchone()[0]
        while size > budget:
            oldest = self.connection.execute("SELECT sample_key, payload_bytes FROM queue ORDER BY collected_at, sample_key LIMIT 1").fetchone()
            if not oldest:
                break
            self.connection.execute("DELETE FROM queue WHERE sample_key=?", (oldest[0],))
            size -= oldest[1]
        self.connection.commit()
        dropped = before - self.count()
        if dropped:
            LOGGER.warning("queue retention/capacity expired %d samples", dropped)

    def enqueue(self, sample, now=None):
        now = time.time() if now is None else now
        self.prune(now)
        payload = json.dumps(sample, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        size = len(payload.encode("utf-8"))
        if size > min(65536, int(self.max_bytes * 0.20)):
            raise ValueError("sample exceeds bounded queue item size")
        collected = dt.datetime.fromisoformat(sample["collectedAt"].replace("Z", "+00:00")).timestamp()
        if collected < now - self.retention_seconds:
            return
        key = sample["hostId"] + ":" + sample["collectedAt"]
        for attempt in range(2):
            try:
                self.connection.execute("INSERT OR IGNORE INTO queue VALUES (?, ?, ?, ?)", (key, collected, payload, size))
                self.connection.commit()
                break
            except sqlite3.OperationalError as error:
                self.connection.rollback()
                if "full" not in str(error).lower() or attempt:
                    raise
                self.connection.execute("DELETE FROM queue WHERE sample_key IN (SELECT sample_key FROM queue ORDER BY collected_at LIMIT 20)")
                self.connection.commit()
                LOGGER.warning("queue capacity expired oldest samples")
        self.prune(now)

    def batch(self, limit=BATCH_SIZE):
        rows = self.connection.execute("SELECT sample_key, payload FROM queue ORDER BY collected_at, sample_key LIMIT ?", (min(BATCH_SIZE, limit),)).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def acknowledge(self, keys):
        self.connection.executemany("DELETE FROM queue WHERE sample_key=?", [(key,) for key in keys])
        self.connection.commit()

    def count(self):
        return self.connection.execute("SELECT COUNT(*) FROM queue").fetchone()[0]

    def close(self):
        self.connection.close()


def import_legacy_queue(path, destination, now=None):
    """Copy retained v1 rows read-only; rollback must retain its original queue."""
    path = Path(path)
    if not path.exists():
        return
    if path.resolve() == destination.path.resolve():
        raise ValueError("legacy and v2 queue paths must differ")
    now = time.time() if now is None else now
    try:
        source = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            rows = source.execute("SELECT sample_key, collected_at, payload, payload_bytes FROM queue WHERE collected_at >= ? ORDER BY collected_at, sample_key",
                                  (now - RETENTION_SECONDS,))
            while True:
                batch = rows.fetchmany(BATCH_SIZE)
                if not batch:
                    break
                for _, _, payload, _ in batch:
                    destination.enqueue(json.loads(payload), now=now)
        finally:
            source.close()
    except (sqlite3.Error, ValueError, TypeError, KeyError):
        # The original file remains available to v1 rollback and a later v2
        # retry; never print stored telemetry or environment values here.
        LOGGER.warning("legacy queue import deferred; original queue retained")


def validate_endpoint(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username
            or parsed.password or parsed.path != "/api/monitor/ingest" or parsed.query or parsed.fragment):
        raise ValueError("ingest endpoint must be the loopback HTTP ingest path")
    return value


def delivery_batch(queue):
    """Coordinator-only: freeze up to 20 rows before crossing a thread boundary."""
    queue.prune()
    batch = queue.batch()
    if not batch:
        return None
    keys = tuple(key for key, _ in batch)
    payload = json.dumps({"samples": [sample for _, sample in batch]}, ensure_ascii=False, allow_nan=False).encode("utf-8")
    return keys, payload


def send_delivery_batch(batch, endpoint, token):
    """Network worker: immutable bytes/keys in, acknowledged keys out; no SQLite."""
    keys, payload = batch
    request = urllib.request.Request(endpoint, data=payload, method="POST", headers={
        "Content-Type": "application/json", "Authorization": "Bearer " + token,
        "User-Agent": "personal-homepage-monitor/1"})
    try:
        with local_http_opener().open(request, timeout=4) as response:
            if 200 <= response.status < 300:
                return keys
    except urllib.error.HTTPError as error:
        error.close()
    except (OSError, urllib.error.URLError, ValueError):
        pass
    LOGGER.warning("ingest deferred; batch=%d", len(keys))
    return ()


def deliver(queue, endpoint, token, max_batches=12):
    """Synchronous diagnostic wrapper; the daemon uses the isolated worker."""
    for _ in range(max_batches):
        batch = delivery_batch(queue)
        if not batch:
            return True
        acknowledged = send_delivery_batch(batch, endpoint, token)
        if not acknowledged:
            return False
        queue.acknowledge(acknowledged)
    return queue.count() == 0


def run_sampling(queue, sampler, stopping, slow_executor, probe_executor, delivery_executor,
                 endpoint, token, *, host_id="cloud-primary", once=False, clock=None, timestamp=None):
    """Coordinator owns SQLite; at most one slow batch and one delivery exist."""
    clock = clock or time.monotonic
    timestamp = timestamp or utc_iso
    next_host = next_checks = clock()
    slow_future = delivery_future = None
    pending_checks = None
    last_host_timestamp = None

    def take_delivery(wait=False):
        nonlocal delivery_future
        if delivery_future is None or not (wait or delivery_future.done()):
            return
        try:
            acknowledged = delivery_future.result()
        except Exception:
            LOGGER.warning("ingest worker failed; queued samples retained")
            acknowledged = ()
        if acknowledged:
            queue.acknowledge(acknowledged)
        delivery_future = None

    def take_checks(wait=False):
        nonlocal slow_future, pending_checks
        if slow_future is None or not (wait or slow_future.done()):
            return
        try:
            pending_checks = slow_future.result()
        except Exception:
            LOGGER.warning("slow check batch failed without a result")
        slow_future = None

    def persist_host():
        nonlocal pending_checks, last_host_timestamp
        collected_at = timestamp()
        if collected_at == last_host_timestamp:
            # Shutdown can flush checks in the same millisecond as a host-only
            # row; give it a distinct key so INSERT OR IGNORE cannot lose them.
            value = dt.datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
            collected_at = (value + dt.timedelta(milliseconds=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        sample = {"hostId": host_id,
                  "collectedAt": collected_at, "host": sampler.sample()}
        if pending_checks is not None:
            sample.update(pending_checks)
        # Do not consume a completed snapshot until its sparse row is durable.
        queue.enqueue(sample)
        last_host_timestamp = collected_at
        pending_checks = None

    def start_delivery():
        nonlocal delivery_future
        if delivery_future is None:
            batch = delivery_batch(queue)
            if batch:
                delivery_future = delivery_executor.submit(send_delivery_batch, batch, endpoint, token)

    try:
        if once:
            # A manual diagnostic still creates one complete sample. Waiting is
            # confined to this explicit one-shot mode and graceful shutdown.
            slow_future = slow_executor.submit(collect_checks, probe_executor, timestamp)
            take_checks(wait=True)
            persist_host()
            start_delivery()
            take_delivery(wait=True)
            return 0
        while not stopping.is_set():
            take_delivery()
            take_checks()
            if clock() >= next_host:
                persist_host()
                next_host += INTERVAL_SECONDS
                if next_host <= clock():
                    next_host = clock() + INTERVAL_SECONDS
                # A failed/ambiguous POST never removes rows. Recovery drains
                # one bounded batch per fast tick without growing a task queue.
                start_delivery()
            if slow_future is None and pending_checks is None and clock() >= next_checks:
                slow_future = slow_executor.submit(collect_checks, probe_executor, timestamp)
                next_checks = clock() + CHECK_INTERVAL_SECONDS
            deadlines = [next_host]
            if slow_future is None and pending_checks is None:
                deadlines.append(next_checks)
            stopping.wait(max(0, min(deadlines) - clock()))
    finally:
        # A signal can arrive between a slow batch's start and the next host
        # tick. Finish its bounded probes and persist that snapshot once before
        # closing SQLite; never silently discard or re-stamp it as a new check.
        take_checks(wait=True)
        if pending_checks is not None:
            persist_host()
        take_delivery(wait=True)
    return 0


def run(once=False):
    # Imported only for the Ubuntu runtime; host/queue unit tests also run on
    # Windows without replacing the host's installed Python interpreter.
    import fcntl

    token = os.environ.get("MONITOR_INGEST_TOKEN", "")
    if len(token) < 32 or any(character.isspace() for character in token):
        raise ValueError("MONITOR_INGEST_TOKEN must contain at least 32 non-whitespace characters")
    endpoint = validate_endpoint(os.environ.get("MONITOR_INGEST_URL", "http://127.0.0.1:3000/api/monitor/ingest"))
    host_id = os.environ.get("MONITOR_HOST_ID", "cloud-primary")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", host_id):
        raise ValueError("MONITOR_HOST_ID has an invalid format")
    interface = os.environ.get("MONITOR_NETWORK_INTERFACE") or None
    if interface and not re.fullmatch(r"[A-Za-z0-9_.-]{1,32}", interface):
        raise ValueError("MONITOR_NETWORK_INTERFACE has an invalid format")
    state = Path(os.environ.get("MONITOR_STATE_DIR", "/var/lib/personal-homepage-monitor"))
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    # The service and manual --once invocations cannot collect simultaneously.
    with (state / "collector.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("another collector already holds the state lock") from None
        queue = SampleQueue(state / "queue-v2.sqlite3")
        import_legacy_queue(state / "queue.sqlite3", queue)
        sampler = HostSampler(interface=interface)
        stopping = threading.Event()
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stopping.set())
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as slow_executor, \
                 concurrent.futures.ThreadPoolExecutor(max_workers=4) as probe_executor, \
                 concurrent.futures.ThreadPoolExecutor(max_workers=1) as delivery_executor:
                return run_sampling(queue, sampler, stopping, slow_executor, probe_executor,
                                    delivery_executor, endpoint, token, host_id=host_id, once=once)
        finally:
            queue.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Collect host telemetry into the local website monitor")
    parser.add_argument("--once", action="store_true", help="collect one sample and try one delivery batch")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        raise SystemExit(run(once=arguments.once))
    except (ValueError, OSError, sqlite3.Error):
        # Do not format exceptions: a credential or external response must never
        # appear in journald when startup or delivery fails.
        LOGGER.error("collector stopped; verify environment, state directory, and local dependencies")
        raise SystemExit(1)

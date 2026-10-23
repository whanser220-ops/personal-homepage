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
INTERVAL_SECONDS = 15
RETENTION_SECONDS = 3600
QUEUE_MAX_BYTES = 20 * 1024 * 1024
BATCH_SIZE = 20
PROBE_TIMEOUT = 3
CONTAINER_NAMES = (
    "personal-homepage", "learning-whiteboard", "jenkins",
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
    # Ignore HTTP_PROXY/HTTPS_PROXY: every request made by this process is local.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


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


def systemd_probe(identifier, name, unit):
    code, output = command(["systemctl", "is-active", unit])
    state = output.strip()
    if code == 0 and state == "active":
        return service_result(identifier, name, "process", "healthy", detail="systemd active；仅验证进程运行")
    if state in ("inactive", "failed", "activating", "deactivating", "reloading", "maintenance"):
        return service_result(identifier, name, "process", "unhealthy", detail="systemd " + state)
    return service_result(identifier, name, "process", detail="无法读取 systemd 进程状态")


def postgres_probe():
    code, _ = command(["docker", "exec", "personal-homepage-postgres", "pg_isready", "-q"])
    if code == 0:
        return service_result("postgres", "PostgreSQL", "process", "healthy", detail="容器内 pg_isready 接受连接")
    if code in (1, 2):
        return service_result("postgres", "PostgreSQL", "process", "unhealthy", detail="pg_isready 未通过")
    return service_result("postgres", "PostgreSQL", "process", detail="无法运行容器内 pg_isready")


def collect_services():
    jobs = [(http_probe, values) for values in HTTP_SERVICES]
    jobs += [(systemd_probe, values) for values in SYSTEMD_SERVICES]
    jobs += [(tcp_probe, ("remote-run-port", "远程运行端口", 4321)),
             (tcp_probe, ("perforce", "Perforce", 1666)), (postgres_probe, ())]
    # Every job has an internal timeout. The next sample cannot start until all
    # jobs finish, so periodic ticks never create overlapping probe batches.
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as executor:
        futures = [executor.submit(function, *args) for function, args in jobs]
        results = []
        for (function, args), future in zip(jobs, futures):
            try:
                results.append(future.result())
            except Exception:
                # Never include exception text; external commands/HTTP errors can
                # otherwise turn sensitive information into stored telemetry.
                LOGGER.warning("service probe failed without a result")
                if function is postgres_probe:
                    results.append(service_result("postgres", "PostgreSQL", "process", detail="探测未返回结果"))
                else:
                    kind = "http" if function is http_probe else ("tcp" if function is tcp_probe else "process")
                    results.append(service_result(args[0], args[1], kind, detail="探测未返回结果"))
        return results


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


def validate_endpoint(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username
            or parsed.password or parsed.path != "/api/monitor/ingest" or parsed.query or parsed.fragment):
        raise ValueError("ingest endpoint must be the loopback HTTP ingest path")
    return value


def deliver(queue, endpoint, token, max_batches=12):
    """A failed/ambiguous response leaves the batch intact for idempotent retry."""
    queue.prune()
    for _ in range(max_batches):
        batch = queue.batch()
        if not batch:
            return True
        payload = json.dumps({"samples": [sample for _, sample in batch]}, ensure_ascii=False, allow_nan=False).encode("utf-8")
        request = urllib.request.Request(endpoint, data=payload, method="POST", headers={
            "Content-Type": "application/json", "Authorization": "Bearer " + token,
            "User-Agent": "personal-homepage-monitor/1"})
        try:
            with local_http_opener().open(request, timeout=4) as response:
                if not 200 <= response.status < 300:
                    return False
        except (OSError, urllib.error.URLError, ValueError):
            LOGGER.warning("ingest deferred; queued=%d", queue.count())
            return False
        queue.acknowledge([key for key, _ in batch])
    return queue.count() == 0


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
        queue = SampleQueue(state / "queue.sqlite3")
        sampler = HostSampler(interface=interface)
        stopping = threading.Event()
        for signum in (signal.SIGTERM, signal.SIGINT):
            signal.signal(signum, lambda *_: stopping.set())
        deadline = time.monotonic()
        try:
            while not stopping.is_set():
                collected_at = utc_iso()
                host = sampler.sample()
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    container_task = executor.submit(collect_containers)
                    service_task = executor.submit(collect_services)
                    containers = container_task.result()
                    services = service_task.result()
                queue.enqueue({"hostId": host_id, "collectedAt": collected_at,
                               "host": host, "containers": containers, "services": services})
                # Catch-up has a time budget: a slow recovered backend must not
                # delay the following sample for up to 12 request timeouts.
                deliver(queue, endpoint, token, max_batches=1)
                if once:
                    return 0
                deadline += INTERVAL_SECONDS
                if deadline <= time.monotonic():
                    deadline = time.monotonic() + INTERVAL_SECONDS
                stopping.wait(max(0, deadline - time.monotonic()))
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

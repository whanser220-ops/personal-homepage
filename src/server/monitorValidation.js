export const MONITOR_HOST_ID = "cloud-primary";
export const MONITOR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MONITOR_MAX_BODY_BYTES = 1024 * 1024;
export const MONITOR_HISTORY_RANGES = Object.freeze({
  "1h": { durationSeconds: 3600, intervalSeconds: 3 },
  "24h": { durationSeconds: 86400, intervalSeconds: 300 },
  "7d": { durationSeconds: 604800, intervalSeconds: 1800 },
});

export class MonitorValidationError extends Error {
  constructor(message = "invalid_payload") {
    super(message);
    this.name = "MonitorValidationError";
  }
}

function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MonitorValidationError();
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new MonitorValidationError("unexpected_field");
  return value;
}

function text(value, maxLength = 128, nullable = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (typeof value !== "string" || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new MonitorValidationError();
  }
  if (/(bearer\s+\S+|-----begin|(?:password|passwd|secret|token|credential|api[_-]?key)\s*[:=]|:\/\/[^\s/]+:[^\s/]+@)/i.test(value)) {
    return "[redacted]";
  }
  return value;
}

function number(value, max = Number.MAX_SAFE_INTEGER, integer = false) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) {
    throw new MonitorValidationError();
  }
  return value;
}

function numericObject(value, fields, percentFields = []) {
  object(value, fields);
  return Object.fromEntries(fields.map((field) => [field, number(value[field], percentFields.includes(field) ? 100 : Number.MAX_SAFE_INTEGER)]));
}

function timestamp(value, now) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new MonitorValidationError("invalid_timestamp");
  }
  const collectedAt = Date.parse(value);
  if (!Number.isFinite(collectedAt) || collectedAt < now - MONITOR_RETENTION_MS || collectedAt > now + 60_000) {
    throw new MonitorValidationError("timestamp_out_of_range");
  }
  if (new Date(collectedAt).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new MonitorValidationError("invalid_timestamp");
  }
  return new Date(collectedAt).toISOString();
}

function normalizeChecks(input, collectedAt, now) {
  const hasContainers = Object.hasOwn(input, "containers"), hasServices = Object.hasOwn(input, "services");
  const hasTimestamp = Object.hasOwn(input, "checksCollectedAt");
  if (hasContainers !== hasServices || (hasTimestamp && !hasContainers)) {
    throw new MonitorValidationError("incomplete_checks");
  }
  // Omission means no new snapshot. Never make host-only samples look like
  // freshly completed empty checks, or repeat previous checks in every row.
  if (!hasContainers) return {};
  const checksCollectedAt = hasTimestamp ? timestamp(input.checksCollectedAt, now) : collectedAt;
  if (checksCollectedAt > collectedAt) throw new MonitorValidationError("checks_after_sample");
  if (!Array.isArray(input.containers) || input.containers.length > 100 || !Array.isArray(input.services) || input.services.length > 30) {
    throw new MonitorValidationError();
  }
  const containers = input.containers.map((item) => {
    object(item, ["name", "image", "state", "health", "restartCount", "cpuPercent", "memoryBytes", "memoryLimitBytes", "memoryPercent"]);
    return {
      name: text(item.name), image: text(item.image, 256, true), state: text(item.state, 32), health: text(item.health, 32, true),
      restartCount: number(item.restartCount, Number.MAX_SAFE_INTEGER, true), cpuPercent: number(item.cpuPercent),
      memoryBytes: number(item.memoryBytes), memoryLimitBytes: number(item.memoryLimitBytes), memoryPercent: number(item.memoryPercent, 100),
    };
  });
  const services = input.services.map((item) => {
    object(item, ["id", "name", "kind", "status", "latencyMs", "httpStatus", "detail"]);
    if (!["http", "process", "tcp"].includes(item.kind) || !["healthy", "unhealthy", "reachable", "unknown"].includes(item.status)) {
      throw new MonitorValidationError();
    }
    const httpStatus = number(item.httpStatus, 599, true);
    if (httpStatus !== null && httpStatus < 100) throw new MonitorValidationError();
    return { id: text(item.id, 64), name: text(item.name), kind: item.kind, status: item.status,
      latencyMs: number(item.latencyMs, 60_000), httpStatus, detail: text(item.detail, 240, true) };
  });
  if (new Set(containers.map((item) => item.name)).size !== containers.length || new Set(services.map((item) => item.id)).size !== services.length) {
    throw new MonitorValidationError("duplicate_item");
  }
  return { checksCollectedAt, containers, services };
}

export function normalizeMonitorSample(input, now = Date.now()) {
  object(input, ["hostId", "collectedAt", "host", "checksCollectedAt", "containers", "services"]);
  if (input.hostId !== MONITOR_HOST_ID) throw new MonitorValidationError("invalid_host");
  const collectedAt = timestamp(input.collectedAt, now);
  const host = object(input.host, ["hostname", "cpu", "memory", "swap", "disk", "network", "uptimeSeconds"]);
  const cpu = numericObject(host.cpu, ["percent", "load1", "load5", "load15", "cores"], ["percent"]);
  const memory = numericObject(host.memory, ["totalBytes", "availableBytes", "usedBytes", "usedPercent"], ["usedPercent"]);
  const swap = numericObject(host.swap, ["totalBytes", "usedBytes", "usedPercent"], ["usedPercent"]);
  const disk = object(host.disk, ["mount", "totalBytes", "usedBytes", "availableBytes", "usedPercent", "readBytesPerSecond", "writeBytesPerSecond"]);
  const network = object(host.network, ["interface", "rxBytesPerSecond", "txBytesPerSecond"]);
  const checks = normalizeChecks(input, collectedAt, now);
  return {
    hostId: MONITOR_HOST_ID, collectedAt,
    host: {
      hostname: text(host.hostname), cpu, memory, swap,
      disk: { mount: text(disk.mount, 128), ...numericObject(Object.fromEntries(Object.entries(disk).filter(([key]) => key !== "mount")),
        ["totalBytes", "usedBytes", "availableBytes", "usedPercent", "readBytesPerSecond", "writeBytesPerSecond"], ["usedPercent"]) },
      network: { interface: text(network.interface, 64, true), rxBytesPerSecond: number(network.rxBytesPerSecond), txBytesPerSecond: number(network.txBytesPerSecond) },
      uptimeSeconds: number(host.uptimeSeconds),
    }, ...checks,
  };
}

export function normalizeMonitorBatch(input, now = Date.now()) {
  const values = input && Object.hasOwn(input, "samples") ? object(input, ["samples"]).samples : [input];
  if (!Array.isArray(values) || values.length === 0 || values.length > 240) throw new MonitorValidationError("invalid_batch");
  return values.map((value) => normalizeMonitorSample(value, now));
}

export function buildMonitorHistoryPoints(rows, range, now = Date.now()) {
  const definition = MONITOR_HISTORY_RANGES[range];
  if (!definition) throw new MonitorValidationError("invalid_range");
  const stepMs = definition.intervalSeconds * 1000;
  const end = Math.floor(now / stepMs) * stepMs;
  const start = end - definition.durationSeconds * 1000;
  const values = new Map(rows.map((row) => [new Date(row.collectedAt).getTime(), row]));
  const fields = ["cpuPercent", "memoryPercent", "swapPercent", "diskPercent", "diskReadBytesPerSecond", "diskWriteBytesPerSecond", "rxBytesPerSecond", "txBytesPerSecond"];
  const points = [];
  for (let time = start; time <= end; time += stepMs) {
    const row = values.get(time);
    points.push({ collectedAt: new Date(time).toISOString(), ...Object.fromEntries(fields.map((field) => [field, row?.[field] === null || row?.[field] === undefined ? null : Number(row[field])])) });
  }
  return { range, intervalSeconds: definition.intervalSeconds, points };
}

"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Progress,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";

const ColumnChart = dynamic(() => import("@ant-design/charts").then((module) => module.Column), {
  ssr: false,
});

const PieChart = dynamic(() => import("@ant-design/charts").then((module) => module.Pie), {
  ssr: false,
});

const MIN_STAGE_PIE_SLICE_RATIO = 0.03;
const MIN_STAGE_PIE_SLICE_MS = 1000;
const BOOT_LOADING_MS = 900;

const emptySnapshot = {
  configured: false,
  source: "empty",
  state: "unconfigured",
  result: "",
  runId: "",
  jobName: "unity-linux-docker-build",
  buildNumber: null,
  currentStage: "",
  currentRun: null,
  stages: [],
  bundles: [],
  assetTypes: [],
  recentRuns: [],
  summary: {
    stageCount: 0,
    completedStageCount: 0,
    totalBundles: 0,
    completedBundles: 0,
    activeBundles: 0,
    assetTypeCount: 0,
    totalAssetBytes: 0,
    totalDurationMs: 0,
  },
};

export function BuildMonitorDashboard({ initialSnapshot = null, initialNowMs = null }) {
  const [snapshot, setSnapshot] = useState(() => initialSnapshot || emptySnapshot);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [nowMs, setNowMs] = useState(() => initialNowMs || Date.now());
  const [dashboardReady, setDashboardReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDashboardReady(true);
    }, BOOT_LOADING_MS);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    let source;
    let connectTimer;
    let pollTimer;

    async function loadInitial() {
      try {
        const response = await fetch("/api/build-metrics/runs/latest", { cache: "no-store" });
        const payload = await response.json();
        if (!disposed) {
          setSnapshot(payload);
          setLoadError(response.ok ? "" : "构建监控暂不可用");
        }
      } catch {
        if (!disposed) {
          setLoadError("构建监控暂不可用");
        }
      }
    }

    if (!initialSnapshot) {
      loadInitial();
    }

    if (typeof window.EventSource !== "function") {
      setConnected(false);
      pollTimer = window.setInterval(loadInitial, 30_000);
      return () => {
        disposed = true;
        window.clearInterval(pollTimer);
      };
    }

    connectTimer = window.setTimeout(() => {
      if (!disposed) {
        setConnected(false);
      }
    }, 5_000);

    source = new window.EventSource("/api/build-metrics/stream");
    source.addEventListener("open", () => {
      if (!disposed) {
        window.clearTimeout(connectTimer);
        setConnected(true);
      }
    });
    source.addEventListener("snapshot", (event) => {
      if (disposed) {
        return;
      }

      try {
        setSnapshot(JSON.parse(event.data));
        setLoadError("");
      } catch {
        setLoadError("构建监控数据格式异常");
      }
    });
    source.addEventListener("error", () => {
      if (!disposed) {
        window.clearTimeout(connectTimer);
        setConnected(false);
      }
    });

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      window.clearInterval(pollTimer);
      source?.close();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  async function refreshSnapshot() {
    try {
      const response = await fetch("/api/build-metrics/runs/latest", { cache: "no-store" });
      const payload = await response.json();
      setSnapshot(payload);
      setLoadError(response.ok ? "" : "构建监控暂不可用");
    } catch {
      setLoadError("构建监控暂不可用");
    }
  }

  const stages = snapshot.stages || [];
  const bundles = snapshot.bundles || [];
  const assetTypes = snapshot.assetTypes || [];
  const summary = snapshot.summary || emptySnapshot.summary;
  const run = snapshot.currentRun;
  const sseStatusColor = connected ? "green" : connected === false ? "default" : "processing";
  const sseStatusText = connected ? "SSE connected" : connected === false ? "SSE offline" : "SSE connecting";
  const totalBundles = summary.totalBundles || bundles.length;
  const completedBundles = summary.completedBundles || 0;
  const bundlePercent = totalBundles > 0 ? Math.round((completedBundles / totalBundles) * 100) : 0;
  const activeBundleCount = summary.activeBundles || bundles.filter((bundle) => bundle.state === "running").length;
  const elapsedDurationMs = getRunElapsedDurationMs(run, summary, snapshot.state, nowMs);

  const activeBundleRows = useMemo(
    () =>
      bundles
        .filter((bundle) => bundle.state === "running")
        .slice()
        .sort((left, right) => compareBundleSizeDesc(left, right) || compareBundleName(left, right)),
    [bundles],
  );

  const completedBundleRows = useMemo(
    () =>
      bundles
        .filter((bundle) => bundle.state === "success" || bundle.state === "failure")
        .slice()
        .sort(
          (left, right) =>
            getBundleDurationMs(right, nowMs) - getBundleDurationMs(left, nowMs) ||
            compareBundleSizeDesc(left, right) ||
            compareBundleName(left, right),
        ),
    [bundles, nowMs],
  );

  const stagePieData = useMemo(() => buildDurationPieData(stages), [stages]);

  const assetTypeChartData = useMemo(
    () =>
      assetTypes.map((item) => ({
        type: item.assetType,
        mb: Number((item.sizeBytes / 1024 / 1024).toFixed(2)),
      })),
    [assetTypes],
  );

  const bundleColumns = [
    {
      title: "Bundle",
      dataIndex: "bundleName",
      key: "bundleName",
      render: (value) => <Typography.Text code>{value}</Typography.Text>,
    },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: 90,
      render: (value, row) => (
        <Tag color={statusColor(value)}>
          {row.cached && value === "success" ? "cached" : row.cached && value === "running" ? "copying" : statusLabel(value)}
        </Tag>
      ),
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 120,
      render: (_, row) => formatDuration(getBundleDurationMs(row, nowMs)),
    },
    {
      title: "大小",
      key: "size",
      width: 130,
      render: (_, row) => formatBytes(row.sizeBytes || row.inputSizeBytes),
    },
  ];

  const stageColumns = [
    {
      title: "阶段",
      dataIndex: "stageName",
      key: "stageName",
    },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: 90,
      render: (value) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>,
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 130,
      render: (value) => formatDuration(value),
    },
  ];

  if (!dashboardReady) {
    return <BuildMonitorLoadingScreen run={run} />;
  }

  return (
    <div className="build-monitor-page build-monitor-dashboard-ready">
      <header className="build-monitor-topbar">
        <a href="/" className="build-monitor-home" aria-label="返回首页">
          <img src="/assets/site-logo.webp" alt="" width="34" height="34" />
          <span>Huang</span>
        </a>
        <div className="build-monitor-title">
          <Typography.Title level={1}>构建监控</Typography.Title>
          <Typography.Text type="secondary">
            {run ? `${run.jobName} #${run.buildNumber || "-"} ${run.buildTarget || ""}` : "等待构建指标"}
          </Typography.Text>
        </div>
        <Space className="build-monitor-actions">
          <Tag color={sseStatusColor}>{sseStatusText}</Tag>
          <Button icon={<ReloadOutlined />} onClick={refreshSnapshot}>
            刷新
          </Button>
        </Space>
      </header>

      <main className="build-monitor-main">
        {loadError && <Alert type="error" message={loadError} showIcon />}
        {snapshot.state === "unconfigured" && (
          <Alert type="warning" message="构建指标数据库未配置" showIcon />
        )}
        {snapshot.state === "idle" && <Alert type="info" message="还没有构建打点数据" showIcon />}

        <section className="build-monitor-stats" aria-label="构建状态">
          <Card>
            <Statistic title="状态" value={statusLabel(snapshot.state)} valueStyle={{ color: statusTextColor(snapshot.state) }} />
          </Card>
          <Card>
            <Statistic title="总耗时" value={formatDuration(elapsedDurationMs)} />
          </Card>
          <Card>
            <Statistic title="当前阶段" value={snapshot.currentStage || "-"} />
          </Card>
          <Card>
            <Statistic title="Bundle" value={`${completedBundles}/${totalBundles || 0}`} />
          </Card>
        </section>

        <section className="build-monitor-progress" aria-label="Bundle 进度">
          <div className="build-monitor-progress-summary">
            <Typography.Text strong>Bundle 总进度</Typography.Text>
            <Typography.Text type="secondary">
              已完成 {completedBundles}/{totalBundles || 0}
              {activeBundleCount > 0 ? ` · 正在构建 ${activeBundleCount}` : ""}
            </Typography.Text>
          </div>
          <Progress percent={bundlePercent} status={snapshot.state === "failure" ? "exception" : "active"} />
        </section>

        <section className="build-monitor-grid" aria-label="构建耗时">
          <Card title="业务阶段耗时">
            <div className="build-monitor-chart-frame">
              {stagePieData.length > 0 ? (
                <PieChart
                  data={stagePieData}
                  angleField="durationSeconds"
                  colorField="stage"
                  height={320}
                  radius={0.8}
                  innerRadius={0.55}
                  label={{
                    text: "stage",
                    position: "outside",
                  }}
                  legend={{
                    color: { position: "bottom" },
                  }}
                  tooltip={{
                    items: [
                      {
                        field: "durationSeconds",
                        name: "耗时",
                        valueFormatter: (value) => formatDuration(Number(value || 0) * 1000),
                      },
                    ],
                  }}
                />
              ) : (
                <Empty description="暂无阶段耗时" />
              )}
            </div>
          </Card>

          <Card title="各类型资源占用">
            <div className="build-monitor-chart-frame">
              {assetTypeChartData.length > 0 ? (
                <ColumnChart
                  data={assetTypeChartData}
                  xField="type"
                  yField="mb"
                  height={320}
                  axis={{
                    x: { labelAutoRotate: false, labelAutoHide: true },
                    y: { title: "MB" },
                  }}
                  colorField="type"
                />
              ) : (
                <Empty description="暂无资源类型统计" />
              )}
            </div>
          </Card>
        </section>

        <section className="build-monitor-section" aria-label="实时 Bundle">
          <Card title="实时 Bundle 构建">
            <Typography.Title level={5}>正在构建</Typography.Title>
            <Table
              rowKey="bundleName"
              columns={bundleColumns}
              dataSource={activeBundleRows}
              locale={{ emptyText: <Empty description="暂无正在构建的 Bundle" /> }}
              pagination={false}
              scroll={{ x: 760 }}
              size="middle"
            />

            <Typography.Title className="build-monitor-subtitle" level={5}>
              已完成
            </Typography.Title>
            <Table
              rowKey="bundleName"
              columns={bundleColumns}
              dataSource={completedBundleRows}
              locale={{ emptyText: <Empty description="暂无已完成的 Bundle" /> }}
              pagination={{ pageSize: 20, hideOnSinglePage: true }}
              scroll={{ x: 760 }}
              size="middle"
            />
          </Card>
        </section>

        <section className="build-monitor-section" aria-label="阶段明细">
          <Card title="阶段明细">
            <Table
              rowKey="stageId"
              columns={stageColumns}
              dataSource={stages}
              pagination={false}
              scroll={{ x: 720 }}
              size="middle"
            />
          </Card>
        </section>
      </main>
    </div>
  );
}

function BuildMonitorLoadingScreen({ run }) {
  const loadingText = run
    ? `${run.jobName} #${run.buildNumber || "-"} 指标加载中`
    : "正在启动构建指标面板";

  return (
    <div className="build-monitor-page build-monitor-loading-page">
      <div className="build-monitor-loader" role="status" aria-live="polite">
        <div className="build-monitor-loader-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <h1>构建监控</h1>
          <p>{loadingText}</p>
        </div>
        <div className="build-monitor-loader-bar" aria-hidden="true" />
      </div>
    </div>
  );
}

function statusColor(state) {
  if (state === "success") {
    return "success";
  }
  if (state === "failure" || state === "unavailable") {
    return "error";
  }
  if (state === "running") {
    return "processing";
  }
  return "default";
}

function buildDurationPieData(stages) {
  const rows = (stages || [])
    .map((stage) => ({
      stage: stage.stageName || stage.stageId || "-",
      durationMs: Number(stage.durationMs || 0),
    }))
    .filter((stage) => Number.isFinite(stage.durationMs) && stage.durationMs > 0);

  const totalMs = rows.reduce((total, stage) => total + stage.durationMs, 0);
  if (totalMs <= 0) {
    return [];
  }

  const thresholdMs = Math.max(totalMs * MIN_STAGE_PIE_SLICE_RATIO, MIN_STAGE_PIE_SLICE_MS);
  const visible = [];
  let otherMs = 0;

  for (const row of rows) {
    if (row.durationMs < thresholdMs) {
      otherMs += row.durationMs;
    } else {
      visible.push(row);
    }
  }

  if (otherMs > 0) {
    visible.push({
      stage: "其他",
      durationMs: otherMs,
    });
  }

  return visible.map((stage) => ({
    ...stage,
    durationSeconds: Number((stage.durationMs / 1000).toFixed(1)),
    durationLabel: formatDuration(stage.durationMs),
  }));
}

function getRunElapsedDurationMs(run, summary, state, nowMs) {
  const started = parseTimeMs(run?.startedAt);
  if (started) {
    const finished = parseTimeMs(run?.finishedAt);
    if (finished && finished >= started) {
      return finished - started;
    }
    if (state === "running" || run?.state === "running") {
      return Math.max(0, nowMs - started);
    }
  }

  return Number(run?.totalDurationMs || summary?.totalDurationMs || 0);
}

function getBundleDurationMs(bundle, nowMs) {
  const explicitDuration = Number(bundle?.durationMs || 0);
  if (explicitDuration > 0) {
    return explicitDuration;
  }

  const started = parseTimeMs(bundle?.startedAt);
  if (!started) {
    return 0;
  }

  const finished = parseTimeMs(bundle?.finishedAt);
  if (finished && finished >= started) {
    return finished - started;
  }

  if (bundle?.state === "running") {
    return Math.max(0, nowMs - started);
  }

  return 0;
}

function compareBundleSizeDesc(left, right) {
  return getBundleSizeForSort(right) - getBundleSizeForSort(left);
}

function compareBundleName(left, right) {
  return String(left?.bundleName || "").localeCompare(String(right?.bundleName || ""));
}

function getBundleSizeForSort(bundle) {
  return Number(bundle?.sizeBytes || bundle?.inputSizeBytes || 0);
}

function parseTimeMs(value) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusTextColor(state) {
  if (state === "success") {
    return "#23784b";
  }
  if (state === "failure" || state === "unavailable") {
    return "#b42318";
  }
  if (state === "running") {
    return "#1d5f8c";
  }
  return "#39434c";
}

function statusLabel(state) {
  if (state === "running") {
    return "构建中";
  }
  if (state === "success") {
    return "成功";
  }
  if (state === "failure") {
    return "失败";
  }
  if (state === "unconfigured") {
    return "未配置";
  }
  if (state === "unavailable") {
    return "不可用";
  }
  return "空闲";
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  if (value < 1000) {
    return `${Math.max(0.1, value / 1000).toFixed(1)}s`;
  }

  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let next = value;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }

  return `${next >= 10 || index === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[index]}`;
}

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

export function BuildMonitorDashboard() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [connected, setConnected] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let disposed = false;
    let source;

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

    loadInitial();

    source = new EventSource("/api/build-metrics/stream");
    source.addEventListener("open", () => {
      if (!disposed) {
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
        setConnected(false);
      }
    });

    return () => {
      disposed = true;
      source?.close();
    };
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
  const totalBundles = summary.totalBundles || bundles.length;
  const completedBundles = summary.completedBundles || 0;
  const bundlePercent = totalBundles > 0 ? Math.round((completedBundles / totalBundles) * 100) : 0;

  const stageChartData = useMemo(
    () =>
      stages
        .filter((stage) => stage.durationMs > 0)
        .map((stage) => ({
          stage: stage.stageName || stage.stageId,
          minutes: Number((stage.durationMs / 60000).toFixed(2)),
        })),
    [stages],
  );

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
      render: (value, row) => <Tag color={statusColor(value)}>{row.cached ? "cached" : statusLabel(value)}</Tag>,
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 120,
      render: (value) => formatDuration(value),
    },
    {
      title: "大小",
      key: "size",
      width: 130,
      render: (_, row) => formatBytes(row.sizeBytes || row.inputSizeBytes),
    },
    {
      title: "进度",
      key: "progress",
      width: 120,
      render: (_, row) =>
        row.completedBundles && row.totalBundles ? `${row.completedBundles}/${row.totalBundles}` : "-",
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

  return (
    <div className="build-monitor-page">
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
          <Tag color={connected ? "green" : "default"}>{connected ? "SSE connected" : "SSE offline"}</Tag>
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
            <Statistic title="总耗时" value={formatDuration(run?.totalDurationMs || summary.totalDurationMs)} />
          </Card>
          <Card>
            <Statistic title="当前阶段" value={snapshot.currentStage || "-"} />
          </Card>
          <Card>
            <Statistic title="Bundle" value={`${completedBundles}/${totalBundles || 0}`} />
          </Card>
        </section>

        <section className="build-monitor-progress" aria-label="Bundle 进度">
          <Progress percent={bundlePercent} status={snapshot.state === "failure" ? "exception" : "active"} />
        </section>

        <section className="build-monitor-grid" aria-label="构建耗时">
          <Card title="业务阶段耗时">
            {stageChartData.length > 0 ? (
              <ColumnChart
                data={stageChartData}
                xField="stage"
                yField="minutes"
                height={320}
                axis={{
                  x: { labelAutoRotate: false, labelAutoHide: true },
                  y: { title: "分钟" },
                }}
                colorField="stage"
              />
            ) : (
              <Empty description="暂无阶段耗时" />
            )}
          </Card>

          <Card title="各类型资源占用">
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
          </Card>
        </section>

        <section className="build-monitor-section" aria-label="实时 Bundle">
          <Card title="实时 Bundle 构建">
            <Table
              rowKey="bundleName"
              columns={bundleColumns}
              dataSource={bundles}
              pagination={{ pageSize: 20, hideOnSinglePage: true }}
              scroll={{ x: 920 }}
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

  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
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

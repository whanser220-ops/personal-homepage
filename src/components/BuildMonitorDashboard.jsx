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
  Tooltip,
  Typography,
} from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
  Box,
  CheckCircle2,
  CircleDashed,
  Clock,
  Cloud,
  Database,
  GitBranch,
  LoaderCircle,
  Monitor,
  Package,
  Server,
  XCircle,
} from "lucide-react";

const ColumnChart = dynamic(() => import("@ant-design/charts").then((module) => module.Column), {
  ssr: false,
});

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

const ENVIRONMENT_DEFINITIONS = {
  cloud: {
    key: "cloud",
    label: "云服务器",
    detail: "1.117.232.198 · Docker/Jenkins 宿主机",
    icon: Cloud,
  },
  jenkins: {
    key: "jenkins",
    label: "Jenkins 控制器",
    detail: "jenkins 容器 · 调度构建任务",
    icon: Server,
  },
  builder: {
    key: "builder",
    label: "构建机",
    detail: "Jenkins Docker agent 节点",
    icon: Monitor,
  },
  container: {
    key: "container",
    label: "Unity 容器",
    detail: "构建工作区 /workspace",
    icon: Box,
  },
  unity: {
    key: "unity",
    label: "Unity Editor",
    detail: "Unity 6000 LinuxEditor 批处理",
    icon: Server,
  },
  github: {
    key: "github",
    label: "GitHub",
    detail: "代码源 Main 分支",
    icon: GitBranch,
  },
  perforce: {
    key: "perforce",
    label: "Perforce",
    detail: "美术资源仓库",
    icon: Database,
  },
  yooasset: {
    key: "yooasset",
    label: "YooAsset/SBP",
    detail: "资源打包工具链",
    icon: Package,
  },
};

const MAIN_FLOW_DEFINITIONS = [
  {
    key: "agent",
    title: "准备构建执行环境",
    purpose: "让 Jenkins 分配执行节点，并确认构建容器和工作区可用",
    stageIds: ["agent", "agent-ready"],
    environments: ["cloud", "jenkins", "builder", "container"],
    icon: Cloud,
  },
  {
    key: "bootstrap",
    title: "同步项目代码",
    purpose: "同步 Unity 项目代码到构建工作区",
    stageIds: ["bootstrap"],
    environments: ["builder", "container", "github"],
    icon: GitBranch,
  },
  {
    key: "p4-sync",
    title: "同步美术资源",
    purpose: "从 Perforce 拉取美术和关卡资源",
    stageIds: ["p4-sync"],
    environments: ["builder", "container", "perforce"],
    icon: Database,
  },
  {
    key: "sanitize-source-art",
    title: "整理资源文件",
    purpose: "清理资源文件名和路径，避免 Unity 导入失败",
    stageIds: ["sanitize-source-art"],
    environments: ["builder", "container"],
    icon: Box,
  },
  {
    key: "unity-bootstrap",
    title: "启动 Unity 编辑器",
    purpose: "完成许可证、LFS 和输出目录准备，并启动 Unity 编辑器",
    stageIds: ["unity-license", "git-lfs", "cleanup", "unity-editor-start"],
    fallbackStageIds: ["unity-build-script", "unity-process"],
    environments: ["builder", "container", "unity"],
    icon: Server,
  },
  {
    key: "build-target",
    title: "配置构建目标",
    purpose: "切换到 Windows64 构建目标并应用构建设置",
    stageIds: ["build-target-switch", "build-target-settings"],
    environments: ["container", "unity"],
    icon: Monitor,
  },
  {
    key: "yooasset-prepare",
    title: "准备资源打包",
    purpose: "应用 YooAsset 收集器并生成资源打包计划",
    stageIds: ["yooasset-prepare", "dependency-analysis", "yooasset-plan-write", "yooasset-apply-collectors"],
    environments: ["container", "unity", "yooasset"],
    icon: Package,
  },
  {
    key: "yooasset-build",
    title: "生成资源包",
    purpose: "调用 YooAsset/SBP 产出可发布的资源包",
    stageIds: ["yooasset-sbp-build", "yooasset-sbp-content", "yooasset-sbp-layout"],
    environments: ["container", "unity", "yooasset"],
    icon: Package,
  },
  {
    key: "build-player",
    title: "生成 Windows 程序",
    purpose: "调用 BuildPipeline 生成 Windows 玩家程序",
    stageIds: ["build-player"],
    environments: ["container", "unity"],
    icon: Monitor,
  },
  {
    key: "package-player",
    title: "打包构建产物",
    purpose: "压缩 Windows 构建结果，形成可下载产物",
    stageIds: ["package-player"],
    environments: ["builder", "container"],
    icon: Package,
  },
];

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
  const mainFlowSteps = useMemo(() => buildMainFlowSteps(stages, snapshot, nowMs), [stages, snapshot, nowMs]);
  const currentMainFlowStep = getCurrentMainFlowStep(mainFlowSteps);
  const currentMainFlowLabel = currentMainFlowStep?.title || "-";

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
            <Statistic title="当前主步骤" value={currentMainFlowLabel} />
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

        <MainFlowDisclosure steps={mainFlowSteps} currentStep={currentMainFlowStep} />

        <section className="build-monitor-grid build-monitor-grid-single" aria-label="资源统计">
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

      </main>
    </div>
  );
}

function MainFlowDisclosure({ steps, currentStep }) {
  return (
    <section className="build-monitor-flow-panel" aria-label="主流程进度">
      <div className="build-monitor-flow-heading">
        <div className="build-monitor-flow-heading-copy">
          <Typography.Text strong>主流程进度</Typography.Text>
          <Typography.Text type="secondary">执行到：{currentStep?.title || "等待构建步骤"}</Typography.Text>
        </div>
        <Tag color={statusColor(currentStep?.state || "idle")}>{steps.length > 0 ? `已显示 ${steps.length} 个步骤` : "暂无步骤"}</Tag>
      </div>

      {steps.length > 0 ? (
        <ol className="build-monitor-flow-list">
          {steps.map((step) => {
            const StepIcon = step.icon;
            const StatusIcon = getFlowStatusIcon(step.state);

            return (
              <li key={step.key} className="build-monitor-flow-item">
                <Tooltip title={<FlowStepTooltip step={step} />} placement="top">
                  <div className={`build-monitor-flow-step build-monitor-flow-step-${step.tone} build-monitor-flow-state-${step.state}`}>
                    <div className="build-monitor-flow-step-icon" aria-hidden="true">
                      <StepIcon size={21} strokeWidth={2.1} />
                    </div>
                    <div className="build-monitor-flow-step-body">
                      <div className="build-monitor-flow-step-header">
                        <Typography.Text strong className="build-monitor-flow-step-title">
                          {step.title}
                        </Typography.Text>
                        <span className="build-monitor-flow-status">
                          <StatusIcon size={14} strokeWidth={2.2} aria-hidden="true" />
                          {statusLabel(step.state)}
                        </span>
                      </div>
                      <Typography.Text className="build-monitor-flow-purpose">{step.purpose}</Typography.Text>
                      <div className="build-monitor-flow-env-list" aria-label={`${step.title}执行位置`}>
                        {step.environments.map((environment) => (
                          <FlowEnvironmentChip key={environment.key} environment={environment} />
                        ))}
                      </div>
                      <span className="build-monitor-flow-duration" aria-label={`${step.title}耗时`}>
                        <Clock size={14} strokeWidth={2.1} aria-hidden="true" />
                        {step.durationLabel}
                      </span>
                    </div>
                  </div>
                </Tooltip>
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty description="暂无主流程步骤" />
      )}
    </section>
  );
}

function FlowEnvironmentChip({ environment }) {
  const EnvironmentIcon = environment.icon;

  return (
    <span className={`build-monitor-flow-env build-monitor-flow-env-${environment.key}`} title={environment.detail}>
      <EnvironmentIcon size={14} strokeWidth={2.1} aria-hidden="true" />
      <span>{environment.label}</span>
    </span>
  );
}

function FlowStepTooltip({ step }) {
  return (
    <div className="build-monitor-flow-tooltip">
      <strong>{step.title}</strong>
      <span>状态：{statusLabel(step.state)}</span>
      <span>耗时：{step.durationLabel}</span>
      <span>开始：{formatDateTime(step.startedAt)}</span>
      <span>结束：{step.state === "running" ? "进行中" : formatDateTime(step.finishedAt)}</span>
      <span>涉及环境：{step.environments.map((environment) => environment.label).join(" / ")}</span>
      {step.runtimeDetails.length > 0 && <span>运行信息：{step.runtimeDetails.join(" / ")}</span>}
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

function buildMainFlowSteps(stages, snapshot, nowMs) {
  const stageById = new Map();
  for (const stage of stages || []) {
    if (stage?.stageId) {
      stageById.set(stage.stageId, stage);
    }
  }

  return MAIN_FLOW_DEFINITIONS.map((definition) => buildMainFlowStep(definition, stageById, snapshot, nowMs)).filter(Boolean);
}

function buildMainFlowStep(definition, stageById, snapshot, nowMs) {
  const primaryStages = definition.stageIds.map((stageId) => stageById.get(stageId)).filter(Boolean);
  const fallbackStages = (definition.fallbackStageIds || []).map((stageId) => stageById.get(stageId)).filter(Boolean);
  const sourceStages = primaryStages.length > 0 ? primaryStages : fallbackStages;
  if (sourceStages.length === 0) {
    return null;
  }

  const state = getMainFlowStepState(sourceStages, snapshot);
  const durationMs = getMainFlowDurationMs(sourceStages, state, nowMs);
  const startedAt = getEarliestStageTime(sourceStages, "startedAt") || getEarliestStageTime(sourceStages, "finishedAt");
  const finishedAt = state === "running" ? "" : getLatestStageTime(sourceStages, "finishedAt");

  return {
    ...definition,
    state,
    durationMs,
    durationLabel: formatDuration(durationMs),
    startedAt,
    finishedAt,
    tone: durationTone(durationMs, state),
    environments: definition.environments.map((key) => ENVIRONMENT_DEFINITIONS[key]).filter(Boolean),
    runtimeDetails: buildRuntimeDetails(sourceStages),
  };
}

function getMainFlowStepState(sourceStages, snapshot) {
  if (sourceStages.some((stage) => stage.state === "failure" || stage.state === "unavailable")) {
    return "failure";
  }
  if (sourceStages.some((stage) => stage.state === "running")) {
    return "running";
  }
  if (snapshot?.state === "failure" && sourceStages.some((stage) => !stage.finishedAt)) {
    return "failure";
  }
  return "success";
}

function getMainFlowDurationMs(sourceStages, state, nowMs) {
  if (sourceStages.length === 1) {
    return getStageDurationMs(sourceStages[0], nowMs);
  }

  const startedTimes = sourceStages.map((stage) => parseTimeMs(stage.startedAt)).filter(Boolean);
  if (startedTimes.length > 0) {
    const startedAt = Math.min(...startedTimes);
    if (state === "running") {
      return Math.max(0, nowMs - startedAt);
    }

    const finishedTimes = sourceStages.map((stage) => parseTimeMs(stage.finishedAt)).filter(Boolean);
    if (finishedTimes.length > 0) {
      return Math.max(0, Math.max(...finishedTimes) - startedAt);
    }
  }

  return sourceStages.reduce((total, stage) => total + Number(stage.durationMs || 0), 0);
}

function getStageDurationMs(stage, nowMs) {
  const explicitDuration = Number(stage?.durationMs || 0);
  if (explicitDuration > 0) {
    return explicitDuration;
  }

  const started = parseTimeMs(stage?.startedAt);
  const finished = parseTimeMs(stage?.finishedAt);
  if (started && finished && finished >= started) {
    return finished - started;
  }
  if (started && stage?.state === "running") {
    return Math.max(0, nowMs - started);
  }

  return 0;
}

function getCurrentMainFlowStep(steps) {
  const failedStep = steps.find((step) => step.state === "failure");
  if (failedStep) {
    return failedStep;
  }

  const runningStep = steps.find((step) => step.state === "running");
  if (runningStep) {
    return runningStep;
  }

  return steps.length > 0 ? steps[steps.length - 1] : null;
}

function getFlowStatusIcon(state) {
  if (state === "success") {
    return CheckCircle2;
  }
  if (state === "failure" || state === "unavailable") {
    return XCircle;
  }
  if (state === "running") {
    return LoaderCircle;
  }
  return CircleDashed;
}

function durationTone(durationMs, state) {
  if (state === "failure" || state === "unavailable") {
    return "failed";
  }
  if (state === "running") {
    return "running";
  }

  const value = Number(durationMs || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "unknown";
  }
  if (value < 10_000) {
    return "fast";
  }
  if (value < 60_000) {
    return "normal";
  }
  if (value < 180_000) {
    return "slow";
  }
  return "long";
}

function getEarliestStageTime(sourceStages, fieldName) {
  const times = sourceStages
    .map((stage) => parseTimeMs(stage?.[fieldName]))
    .filter(Boolean);
  if (times.length === 0) {
    return "";
  }

  return new Date(Math.min(...times)).toISOString();
}

function getLatestStageTime(sourceStages, fieldName) {
  const times = sourceStages
    .map((stage) => parseTimeMs(stage?.[fieldName]))
    .filter(Boolean);
  if (times.length === 0) {
    return "";
  }

  return new Date(Math.max(...times)).toISOString();
}

function buildRuntimeDetails(sourceStages) {
  const details = [];
  const nodeNames = uniqueMetadataValues(sourceStages, "nodeName");
  const workspaces = uniqueMetadataValues(sourceStages, "workspace");
  const platforms = uniqueMetadataValues(sourceStages, "platform");
  const unityVersions = uniqueMetadataValues(sourceStages, "unityVersion");

  details.push(...nodeNames.map((value) => `构建节点：${value}`));
  details.push(...workspaces.map((value) => `工作区：${value}`));
  details.push(...platforms.map((value) => `Unity 平台：${value}`));
  details.push(...unityVersions.map((value) => `Unity 版本：${value}`));

  return details;
}

function uniqueMetadataValues(sourceStages, key) {
  return Array.from(
    new Set(
      sourceStages
        .map((stage) => stage?.metadata?.[key])
        .filter((value) => typeof value === "string" && value.trim().length > 0),
    ),
  );
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

function formatDateTime(value) {
  const time = parseTimeMs(value);
  if (!time) {
    return "-";
  }

  const date = new Date(time);
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

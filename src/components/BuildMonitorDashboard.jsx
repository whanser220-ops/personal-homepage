"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Card as AntCard,
  Empty,
  Progress,
  Space,
  Statistic,
  Table,
  Tooltip,
  Typography,
} from "antd";
import {
  Box,
  CheckCircle2,
  CircleDashed,
  Clock,
  Cloud,
  Database,
  LoaderCircle,
  Monitor,
  Package,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { Badge as UiBadge } from "./ui/badge.jsx";
import { Button as UiButton } from "./ui/button.jsx";
import { Card as UiCard, CardContent as UiCardContent } from "./ui/card.jsx";
import { cn } from "../lib/utils.js";
import styles from "./BuildMonitorDashboard.module.css";

const BOOT_LOADING_MS = 900;

function css(...names) {
  return cn(...names.map((name) => name && styles[name]));
}

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
  bundleModules: [],
  redundantAssets: [],
  recentRuns: [],
  summary: {
    stageCount: 0,
    completedStageCount: 0,
    totalBundles: 0,
    completedBundles: 0,
    activeBundles: 0,
    assetTypeCount: 0,
    totalAssetBytes: 0,
    duplicateAssetCount: 0,
    totalRedundantSizeBytes: 0,
    totalDurationMs: 0,
  },
};

const SCENE_MODULE_LABEL = "\u573a\u666f\u6a21\u5757";
const REDUNDANCY_ANALYSIS_LABEL = "\u5197\u4f59\u5206\u6790";
const DUPLICATE_RESOURCE_LABEL = "\u91cd\u590d\u8d44\u6e90";
const TOTAL_REDUNDANT_SIZE_LABEL = "\u5197\u4f59\u603b\u5927\u5c0f";
const NO_REDUNDANT_ASSETS_LABEL = "\u6682\u65e0\u5197\u4f59\u8d44\u6e90\u5206\u6790";
const NO_BUNDLES_LABEL = "\u6682\u65e0 Bundle";
const BUNDLE_MODULE_DEFINITIONS = [
  { key: "summer", label: "\u590f" },
  { key: "autumn", label: "\u79cb" },
  { key: "winter", label: "\u51ac" },
  { key: "common", label: "\u516c\u5171" },
];

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
  perforce: {
    key: "perforce",
    label: "Perforce",
    detail: "源码、美术资源和 Jenkinsfile 统一来源",
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
    title: "同步 Perforce 项目代码",
    purpose: "从 Perforce 拉取 Jenkinsfile、Unity 工程和构建脚本",
    stageIds: ["bootstrap", "p4-bootstrap", "p4-project-sync"],
    environments: ["builder", "container", "perforce"],
    icon: Database,
  },
  {
    key: "p4-sync",
    title: "同步 Perforce 项目资源",
    purpose: "从 Perforce 同步 Unity 工程资源和关卡内容",
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
    purpose: "完成许可证和输出目录准备，并启动 Unity 编辑器",
    stageIds: ["unity-license", "cleanup", "unity-editor-start"],
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
  const [nowMs, setNowMs] = useState(() => initialNowMs || 0);
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
    setNowMs(Date.now());

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
  const summary = snapshot.summary || emptySnapshot.summary;
  const redundantAssets = snapshot.redundantAssets || [];
  const run = snapshot.currentRun;
  const revision = getRunRevision(run);
  const sseStatusVariant = connected ? "success" : connected === false ? "secondary" : "warning";
  const sseStatusText = connected ? "SSE connected" : connected === false ? "SSE offline" : "SSE connecting";
  const totalBundles = summary.totalBundles || bundles.length;
  const completedBundles = summary.completedBundles || 0;
  const bundlePercent = totalBundles > 0 ? Math.round((completedBundles / totalBundles) * 100) : 0;
  const buildIsRunning = snapshot.state === "running";
  const activeBundleCount = buildIsRunning
    ? summary.activeBundles || bundles.filter((bundle) => bundle.state === "running").length
    : 0;
  const elapsedDurationMs = getRunElapsedDurationMs(run, summary, snapshot.state, nowMs);
  const runFreezeTimeMs = buildIsRunning ? 0 : getRunFreezeTimeMs(run, snapshot);
  const mainFlowSteps = useMemo(() => buildMainFlowSteps(stages, snapshot, nowMs), [stages, snapshot, nowMs]);
  const currentMainFlowStep = getCurrentMainFlowStep(mainFlowSteps);
  const currentMainFlowLabel = currentMainFlowStep?.title || "-";
  const bundleModuleTree = useMemo(
    () => resolveBundleModuleTree(snapshot.bundleModules, bundles),
    [snapshot.bundleModules, bundles],
  );
  const duplicateAssetCount = summary.duplicateAssetCount || redundantAssets.length;
  const totalRedundantSizeBytes =
    summary.totalRedundantSizeBytes ||
    redundantAssets.reduce((total, item) => total + Number(item.redundantSizeBytes || 0), 0);

  const activeBundleRows = useMemo(
    () => {
      if (!buildIsRunning) {
        return [];
      }

      return bundles
        .filter((bundle) => bundle.state === "running")
        .slice()
        .sort((left, right) => compareBundleSizeDesc(left, right) || compareBundleName(left, right));
    },
    [bundles, buildIsRunning],
  );

  const completedBundleRows = useMemo(
    () =>
      bundles
        .filter((bundle) => bundle.state === "success" || bundle.state === "failure")
        .slice()
        .sort(
          (left, right) =>
            getBundleDurationMs(right, nowMs, runFreezeTimeMs) - getBundleDurationMs(left, nowMs, runFreezeTimeMs) ||
            compareBundleSizeDesc(left, right) ||
            compareBundleName(left, right),
        ),
    [bundles, nowMs, runFreezeTimeMs],
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
        <UiBadge className={css("build-monitor-status-badge")} variant={statusBadgeVariant(value)}>
          {row.cached && value === "success" ? "cached" : row.cached && value === "running" ? "copying" : statusLabel(value)}
        </UiBadge>
      ),
    },
    {
      title: "耗时",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 120,
      render: (_, row) => formatDuration(getBundleDurationMs(row, nowMs, runFreezeTimeMs)),
    },
    {
      title: "大小",
      key: "size",
      width: 130,
      render: (_, row) => formatBytes(row.sizeBytes || row.inputSizeBytes),
    },
  ];

  const redundantAssetColumns = [
    {
      title: "\u8d44\u6e90",
      key: "assetPath",
      render: (_, row) => (
        <div className={css("build-monitor-resource-cell")}>
          <Typography.Text strong>{row.assetName || getAssetName(row.assetPath)}</Typography.Text>
          <Typography.Text code>{row.assetPath}</Typography.Text>
          {row.assetType ? <Typography.Text type="secondary">{row.assetType}</Typography.Text> : null}
        </div>
      ),
    },
    {
      title: "\u91cd\u590d\u6b21\u6570",
      dataIndex: "duplicateCount",
      key: "duplicateCount",
      width: 110,
      render: (value) => Number(value || 0),
    },
    {
      title: "\u5355\u4efd\u5927\u5c0f",
      dataIndex: "singleSizeBytes",
      key: "singleSizeBytes",
      width: 120,
      render: (value) => formatBytes(value),
    },
    {
      title: "\u5197\u4f59\u5927\u5c0f",
      dataIndex: "redundantSizeBytes",
      key: "redundantSizeBytes",
      width: 120,
      render: (value) => formatBytes(value),
    },
    {
      title: "\u51fa\u73b0 Bundle",
      key: "bundles",
      render: (_, row) => <BundleCopyList bundles={row.bundles || []} />,
    },
  ];

  if (!dashboardReady) {
    return <BuildMonitorLoadingScreen run={run} />;
  }

  return (
    <div className={css("build-monitor-page", "build-monitor-dashboard-ready")}>
      <header className={css("build-monitor-topbar")}>
        <UiButton asChild className={css("build-monitor-home")} variant="ghost">
          <Link href="/" aria-label="返回首页">
            <img src="/assets/site-logo.webp" alt="" width="34" height="34" />
            <span>Huang</span>
          </Link>
        </UiButton>
        <div className={css("build-monitor-title")}>
          <Typography.Title level={1}>构建监控</Typography.Title>
          <Typography.Text type="secondary">{formatRunSubtitle(run, revision)}</Typography.Text>
        </div>
        <Space className={css("build-monitor-actions")}>
          <UiBadge variant={sseStatusVariant}>{sseStatusText}</UiBadge>
          <UiButton onClick={refreshSnapshot} size="sm" type="button" variant="outline">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            刷新
          </UiButton>
        </Space>
      </header>

      <main className={css("build-monitor-main")}>
        {loadError && <Alert type="error" message={loadError} showIcon />}
        {snapshot.state === "unconfigured" && (
          <Alert type="warning" message="构建指标数据库未配置" showIcon />
        )}
        {snapshot.state === "idle" && <Alert type="info" message="还没有构建打点数据" showIcon />}

        <section className={css("build-monitor-stats")} aria-label="构建状态">
          <UiCard className={css("build-monitor-stat-card")}>
            <UiCardContent>
              <Statistic title="状态" value={statusLabel(snapshot.state)} valueStyle={{ color: statusTextColor(snapshot.state) }} />
            </UiCardContent>
          </UiCard>
          <UiCard className={css("build-monitor-stat-card")}>
            <UiCardContent>
              <Statistic title="版本来源" value={revision.label} />
              {revision.detail ? <Typography.Text className={css("build-monitor-stat-detail")} type="secondary">{revision.detail}</Typography.Text> : null}
            </UiCardContent>
          </UiCard>
          <UiCard className={css("build-monitor-stat-card")}>
            <UiCardContent>
              <Statistic title="总耗时" value={formatDuration(elapsedDurationMs)} />
            </UiCardContent>
          </UiCard>
          <UiCard className={css("build-monitor-stat-card")}>
            <UiCardContent>
              <Statistic title="当前主步骤" value={currentMainFlowLabel} />
            </UiCardContent>
          </UiCard>
          <UiCard className={css("build-monitor-stat-card")}>
            <UiCardContent>
              <Statistic title="Bundle" value={`${completedBundles}/${totalBundles || 0}`} />
            </UiCardContent>
          </UiCard>
        </section>

        <section className={css("build-monitor-progress")} aria-label="Bundle 进度">
          <div className={css("build-monitor-progress-summary")}>
            <Typography.Text strong>Bundle 总进度</Typography.Text>
            <Typography.Text type="secondary">
              已完成 {completedBundles}/{totalBundles || 0}
              {activeBundleCount > 0 ? ` · 正在构建 ${activeBundleCount}` : ""}
            </Typography.Text>
          </div>
          <Progress percent={bundlePercent} status={snapshot.state === "failure" ? "exception" : "active"} />
        </section>

        <MainFlowDisclosure steps={mainFlowSteps} currentStep={currentMainFlowStep} />

        <section className={css("build-monitor-grid", "build-monitor-grid-single")} aria-label="Bundle modules">
          <AntCard title={SCENE_MODULE_LABEL}>
            <BundleModuleGraph root={bundleModuleTree} />
          </AntCard>
        </section>

        <section className={css("build-monitor-section")} aria-label="Bundle redundancy">
          <AntCard title={REDUNDANCY_ANALYSIS_LABEL}>
            <div className={css("build-monitor-analysis-summary")}>
              <Statistic title={DUPLICATE_RESOURCE_LABEL} value={duplicateAssetCount} />
              <Statistic title={TOTAL_REDUNDANT_SIZE_LABEL} value={formatBytes(totalRedundantSizeBytes)} />
            </div>
            <Table
              rowKey={(row) => row.assetPath}
              columns={redundantAssetColumns}
              dataSource={redundantAssets}
              locale={{ emptyText: <Empty description={NO_REDUNDANT_ASSETS_LABEL} /> }}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              scroll={{ x: 960 }}
              size="middle"
            />
          </AntCard>
        </section>

        <section className={css("build-monitor-section")} aria-label="实时 Bundle">
          <AntCard title="实时 Bundle 构建">
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

            <Typography.Title className={css("build-monitor-subtitle")} level={5}>
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
          </AntCard>
        </section>

      </main>
    </div>
  );
}

function MainFlowDisclosure({ steps, currentStep }) {
  return (
    <section className={css("build-monitor-flow-panel")} aria-label="主流程进度">
      <div className={css("build-monitor-flow-heading")}>
        <div className={css("build-monitor-flow-heading-copy")}>
          <Typography.Text strong>主流程进度</Typography.Text>
          <Typography.Text type="secondary">执行到：{currentStep?.title || "等待构建步骤"}</Typography.Text>
        </div>
        <UiBadge variant={statusBadgeVariant(currentStep?.state || "idle")}>
          {steps.length > 0 ? `已显示 ${steps.length} 个步骤` : "暂无步骤"}
        </UiBadge>
      </div>

      {steps.length > 0 ? (
        <ol className={css("build-monitor-flow-list")}>
          {steps.map((step) => {
            const StepIcon = step.icon;
            const StatusIcon = getFlowStatusIcon(step.state);

            return (
              <li key={step.key} className={css("build-monitor-flow-item")}>
                <Tooltip title={<FlowStepTooltip step={step} />} placement="top">
                  <div className={css("build-monitor-flow-step", `build-monitor-flow-step-${step.tone}`, `build-monitor-flow-state-${step.state}`)}>
                    <div className={css("build-monitor-flow-step-icon")} aria-hidden="true">
                      <StepIcon size={21} strokeWidth={2.1} />
                    </div>
                    <div className={css("build-monitor-flow-step-body")}>
                      <div className={css("build-monitor-flow-step-header")}>
                        <Typography.Text strong className={css("build-monitor-flow-step-title")}>
                          {step.title}
                        </Typography.Text>
                        <UiBadge className={css("build-monitor-flow-status")} variant={statusBadgeVariant(step.state)}>
                          <StatusIcon aria-hidden="true" data-icon="inline-start" />
                          {statusLabel(step.state)}
                        </UiBadge>
                      </div>
                      <Typography.Text className={css("build-monitor-flow-purpose")}>{step.purpose}</Typography.Text>
                      <div className={css("build-monitor-flow-env-list")} aria-label={`${step.title}执行位置`}>
                        {step.environments.map((environment) => (
                          <FlowEnvironmentChip key={environment.key} environment={environment} />
                        ))}
                      </div>
                      <span className={css("build-monitor-flow-duration")} aria-label={`${step.title}耗时`}>
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
    <UiBadge className={css("build-monitor-flow-env", `build-monitor-flow-env-${environment.key}`)} title={environment.detail} variant="outline">
      <EnvironmentIcon aria-hidden="true" data-icon="inline-start" />
      <span>{environment.label}</span>
    </UiBadge>
  );
}

function FlowStepTooltip({ step }) {
  return (
    <div className={css("build-monitor-flow-tooltip")}>
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

function BundleModuleGraph({ root }) {
  const children = root?.children || [];

  return (
    <div className={css("build-monitor-module-graph")}>
      <div className={css("build-monitor-module-root")}>
        <Typography.Text strong>{root?.label || SCENE_MODULE_LABEL}</Typography.Text>
        <Typography.Text type="secondary">
          {children.reduce((total, child) => total + Number(child.bundleCount || 0), 0)} Bundles
        </Typography.Text>
      </div>
      <div className={css("build-monitor-module-children")}>
        {children.map((module) => (
          <div key={module.key} className={css("build-monitor-module-node", `build-monitor-module-node-${module.key}`)}>
            <div className={css("build-monitor-module-node-header")}>
              <Typography.Text strong>{module.label}</Typography.Text>
              <UiBadge variant={module.bundleCount > 0 ? "accent" : "secondary"}>{module.bundleCount || 0}</UiBadge>
            </div>
            <div className={css("build-monitor-module-stats")}>
              <span>{formatBytes(module.totalSizeBytes || 0)}</span>
              <span>{Number(module.totalAssetCount || 0)} assets</span>
            </div>
            <BundleNameList bundles={module.bundles || []} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BundleNameList({ bundles }) {
  if (!bundles || bundles.length === 0) {
    return <Empty className={css("build-monitor-module-empty")} description={NO_BUNDLES_LABEL} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <ul className={css("build-monitor-module-bundle-list")}>
      {bundles.map((bundle) => (
        <li key={bundle.bundleName}>
          <Typography.Text code>{bundle.bundleName}</Typography.Text>
          <span>{formatBytes(bundle.sizeBytes || bundle.inputSizeBytes || 0)}</span>
        </li>
      ))}
    </ul>
  );
}

function BundleCopyList({ bundles }) {
  if (!bundles || bundles.length === 0) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }

  return (
    <div className={css("build-monitor-bundle-copy-list")}>
      {bundles.map((bundle) => (
        <UiBadge key={bundle.bundleName} variant="outline">
          {bundle.bundleName}
          {bundle.copySizeBytes ? ` · ${formatBytes(bundle.copySizeBytes)}` : ""}
        </UiBadge>
      ))}
    </div>
  );
}

function BuildMonitorLoadingScreen({ run }) {
  const loadingText = run
    ? `${run.jobName} #${run.buildNumber || "-"} 指标加载中`
    : "正在启动构建指标面板";

  return (
    <div className={css("build-monitor-page", "build-monitor-loading-page")}>
      <div className={css("build-monitor-loader")} role="status" aria-live="polite">
        <div className={css("build-monitor-loader-mark")} aria-hidden="true">
          <span />
        </div>
        <div>
          <h1>构建监控</h1>
          <p>{loadingText}</p>
        </div>
        <div className={css("build-monitor-loader-bar")} aria-hidden="true" />
      </div>
    </div>
  );
}

function statusBadgeVariant(state) {
  if (state === "success") {
    return "success";
  }
  if (state === "failure" || state === "unavailable") {
    return "destructive";
  }
  if (state === "running") {
    return "accent";
  }
  if (state === "unconfigured") {
    return "warning";
  }
  return "secondary";
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
  const p4Changes = uniqueNestedMetadataValues(sourceStages, ["p4", "changelist"]);
  const p4Streams = uniqueNestedMetadataValues(sourceStages, ["p4", "stream"]);

  details.push(...nodeNames.map((value) => `构建节点：${value}`));
  details.push(...workspaces.map((value) => `工作区：${value}`));
  details.push(...platforms.map((value) => `Unity 平台：${value}`));
  details.push(...unityVersions.map((value) => `Unity 版本：${value}`));
  details.push(...p4Changes.map((value) => `P4 CL：${value}`));
  details.push(...p4Streams.map((value) => `P4 Stream：${value}`));

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

function uniqueNestedMetadataValues(sourceStages, path) {
  return Array.from(
    new Set(
      sourceStages
        .map((stage) => getNestedValue(stage?.metadata, path))
        .filter((value) => typeof value === "string" && value.trim().length > 0),
    ),
  );
}

function getNestedValue(source, path) {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = current[key];
  }
  return current;
}

function formatRunSubtitle(run, revision) {
  if (!run) {
    return "等待构建指标";
  }

  return [run.jobName ? `${run.jobName} #${run.buildNumber || "-"}` : "", revision.label, run.buildTarget]
    .filter(Boolean)
    .join(" · ");
}

function getRunRevision(run) {
  const revision = run?.revision;
  if (revision?.type === "perforce" || revision?.type === "git") {
    return normalizeRevision(revision);
  }

  const p4 = run?.metadata?.p4;
  if (p4 && typeof p4 === "object" && !Array.isArray(p4)) {
    const changelist = String(p4.changelist || p4.change || p4.syncedChange || "").trim();
    const stream = String(p4.stream || "").trim();
    const client = String(p4.client || "").trim();
    if (changelist || stream || client) {
      return normalizeRevision({
        type: "perforce",
        label: changelist ? `P4 CL ${changelist}` : "Perforce",
        detail: [stream, client].filter(Boolean).join(" · "),
        changelist,
        stream,
        client,
      });
    }
  }

  if (run?.gitCommit || run?.gitRef) {
    return normalizeRevision({
      type: "git",
      label: run.gitCommit ? `Git ${run.gitCommit}` : run.gitRef,
      detail: run.gitRef || "",
    });
  }

  return normalizeRevision({ type: "unknown", label: "版本未知", detail: "" });
}

function normalizeRevision(revision) {
  return {
    type: revision?.type || "unknown",
    label: String(revision?.label || "版本未知").trim() || "版本未知",
    detail: String(revision?.detail || "").trim(),
  };
}

function getRunElapsedDurationMs(run, summary, state, nowMs) {
  const explicitDuration = Number(run?.totalDurationMs || summary?.totalDurationMs || 0);
  const started = parseTimeMs(run?.startedAt);
  if (started) {
    const finished = parseTimeMs(run?.finishedAt);
    if (finished && finished >= started) {
      return finished - started;
    }
    if (state === "running") {
      return Math.max(0, nowMs - started);
    }
  }

  return explicitDuration;
}

function getBundleDurationMs(bundle, nowMs, freezeTimeMs = 0) {
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
    const end = freezeTimeMs || nowMs;
    return Math.max(0, end - started);
  }

  return 0;
}

function getRunFreezeTimeMs(run, snapshot) {
  return parseTimeMs(run?.finishedAt) || parseTimeMs(snapshot?.updatedAt);
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

function resolveBundleModuleTree(bundleModules, bundles) {
  if (Array.isArray(bundleModules) && bundleModules.length > 0) {
    const root = bundleModules[0];
    return {
      key: root?.key || "scene",
      label: root?.label || SCENE_MODULE_LABEL,
      children: mergeBundleModuleChildren(root?.children || []),
    };
  }

  return {
    key: "scene",
    label: SCENE_MODULE_LABEL,
    children: buildBundleModuleChildren(bundles),
  };
}

function mergeBundleModuleChildren(children) {
  const byKey = new Map(
    BUNDLE_MODULE_DEFINITIONS.map((definition) => [
      definition.key,
      {
        key: definition.key,
        label: definition.label,
        bundleCount: 0,
        totalSizeBytes: 0,
        totalAssetCount: 0,
        bundles: [],
      },
    ]),
  );

  for (const child of children || []) {
    const key = normalizeBundleModuleKey(child?.key || child?.label || "");
    const current = byKey.get(key);
    if (!current) {
      continue;
    }

    current.label = bundleModuleLabel(key, child.label);
    current.bundleCount = Number(child.bundleCount || 0);
    current.totalSizeBytes = Number(child.totalSizeBytes || 0);
    current.totalAssetCount = Number(child.totalAssetCount || 0);
    current.bundles = Array.isArray(child.bundles) ? child.bundles : [];
  }

  return BUNDLE_MODULE_DEFINITIONS.map((definition) => byKey.get(definition.key));
}

function buildBundleModuleChildren(bundles) {
  const children = BUNDLE_MODULE_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    bundleCount: 0,
    totalSizeBytes: 0,
    totalAssetCount: 0,
    bundles: [],
  }));
  const byKey = new Map(children.map((child) => [child.key, child]));

  for (const bundle of bundles || []) {
    const key = classifyBundleModule(bundle.bundleName);
    const module = byKey.get(key) || byKey.get("common");
    const sizeBytes = Number(bundle.sizeBytes || bundle.inputSizeBytes || 0);
    const assetCount = Number(bundle.assetCount || 0);
    module.bundles.push({
      bundleName: bundle.bundleName,
      sizeBytes,
      assetCount,
    });
    module.bundleCount += 1;
    module.totalSizeBytes += sizeBytes;
    module.totalAssetCount += assetCount;
  }

  for (const module of children) {
    module.bundles.sort((left, right) => right.sizeBytes - left.sizeBytes || compareBundleName(left, right));
  }

  return children;
}

function classifyBundleModule(bundleName) {
  const normalized = String(bundleName || "").toLowerCase();
  if (normalized.includes("summer")) {
    return "summer";
  }
  if (normalized.includes("autumn")) {
    return "autumn";
  }
  if (normalized.includes("winter")) {
    return "winter";
  }
  return "common";
}

function normalizeBundleModuleKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "summer" || normalized === "\u590f") {
    return "summer";
  }
  if (normalized === "autumn" || normalized === "\u79cb") {
    return "autumn";
  }
  if (normalized === "winter" || normalized === "\u51ac") {
    return "winter";
  }
  if (normalized === "common" || normalized === "shared" || normalized === "\u516c\u5171") {
    return "common";
  }
  return classifyBundleModule(normalized);
}

function bundleModuleLabel(key, fallback) {
  const definition = BUNDLE_MODULE_DEFINITIONS.find((item) => item.key === normalizeBundleModuleKey(key));
  return definition?.label || fallback || key;
}

function getAssetName(assetPath) {
  const normalized = String(assetPath || "").replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
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
    return "var(--status-success)";
  }
  if (state === "failure" || state === "unavailable") {
    return "var(--destructive)";
  }
  if (state === "running") {
    return "var(--status-info)";
  }
  return "var(--muted-foreground)";
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

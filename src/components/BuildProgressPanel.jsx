"use client";

import { useEffect, useMemo, useState } from "react";

const activePollMs = 5000;
const idlePollMs = 30000;

export function BuildProgressPanel() {
  const [progress, setProgress] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isMounted = true;
    let timer = null;

    async function loadProgress() {
      try {
        const response = await fetch("/api/build-progress", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const nextProgress = await response.json();
        if (!isMounted) {
          return;
        }

        setProgress(nextProgress);
        setLoadError(nextProgress.ok ? "" : nextProgress.error || "Jenkins 状态暂不可用");
        setIsLoading(false);

        const isActive = nextProgress.state === "running" || nextProgress.queue?.inQueue;
        timer = window.setTimeout(loadProgress, isActive ? activePollMs : idlePollMs);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : "Jenkins 状态暂不可用");
        setIsLoading(false);
        timer = window.setTimeout(loadProgress, idlePollMs);
      }
    }

    loadProgress();

    return () => {
      isMounted = false;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const currentStage = useMemo(() => getCurrentStage(progress?.stages || []), [progress]);
  const currentBuild = progress?.currentBuild || null;
  const percent = Math.max(0, Math.min(100, progress?.progress?.percent || 0));
  const statusTone = getStatusTone(progress?.state, currentBuild?.result);

  return (
    <section className="build-progress-panel" aria-label="Unity6 Jenkins 构建进度">
      <div className="build-progress-header">
        <div>
          <span className="build-progress-eyebrow">Jenkins Docker Cloud</span>
          <h2>Unity6 容器构建进度</h2>
          <p>
            {progress?.jobName || "unity-linux-docker-build"}
            {currentBuild?.number ? ` #${currentBuild.number}` : ""}
          </p>
        </div>
        <span className={`build-status build-status-${statusTone}`}>{formatState(progress, isLoading)}</span>
      </div>

      {loadError && <div className="build-progress-alert">{loadError}</div>}

      <div
        className="build-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="build-progress-stats">
        <ProgressStat label="进度" value={`${percent}%`} />
        <ProgressStat label="当前阶段" value={currentStage?.name || "-"} />
        <ProgressStat label="已用时间" value={formatDuration(getElapsedMs(currentBuild))} />
        <ProgressStat label="预计总时长" value={formatDuration(currentBuild?.estimatedDurationMs)} />
        <ProgressStat label="最近结果" value={currentBuild?.result || "-"} tone={statusTone} />
        <ProgressStat label="更新时间" value={formatDateTime(progress?.updatedAt)} />
      </div>

      {progress?.queue?.inQueue && progress.queue.why && (
        <div className="build-progress-alert">{progress.queue.why}</div>
      )}

      {progress?.stages?.length > 0 && (
        <div className="build-stage-list" aria-label="构建阶段">
          {progress.stages.map((stage) => (
            <div key={stage.id || stage.name} className={`build-stage build-stage-${getStageTone(stage)}`}>
              <strong>{stage.name}</strong>
              <span>
                {stage.result || stage.state || "-"} · {formatDuration(stage.durationMs)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="build-progress-columns">
        <div>
          <h3>最近构建</h3>
          <div className="build-run-list">
            {(progress?.recentRuns || []).slice(0, 5).map((run) => (
              <div key={run.id} className="build-run-row">
                <span>#{run.id}</span>
                <strong className={`build-result build-result-${getStatusTone(run.state, run.result)}`}>
                  {run.result || run.state || "-"}
                </strong>
                <span>{formatDuration(run.durationMs)}</span>
              </div>
            ))}
            {progress && progress.recentRuns?.length === 0 && <div className="build-muted">暂无构建记录</div>}
          </div>
        </div>

        <div>
          <h3>归档产物</h3>
          <div className="build-artifact-list">
            {(progress?.artifacts || []).slice(0, 6).map((artifact) => (
              <div key={artifact.path || artifact.name} className="build-artifact-row">
                <span>{artifact.name}</span>
                <strong>{formatBytes(artifact.sizeBytes)}</strong>
              </div>
            ))}
            {progress && progress.artifacts?.length === 0 && <div className="build-muted">暂无归档产物</div>}
          </div>
        </div>
      </div>

      {progress?.logTail?.length > 0 && (
        <div className="build-log-tail">
          <h3>日志尾部</h3>
          <pre>{progress.logTail.join("\n")}</pre>
        </div>
      )}
    </section>
  );
}

function ProgressStat({ label, value, tone }) {
  return (
    <div className={`build-progress-stat ${tone ? `build-progress-stat-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function getCurrentStage(stages) {
  return stages.find((stage) => stage.state && stage.state !== "FINISHED") || stages.at(-1) || null;
}

function getElapsedMs(build) {
  if (!build) {
    return 0;
  }

  if (!build.building) {
    return build.durationMs || 0;
  }

  return build.timestamp ? Date.now() - build.timestamp : build.durationMs || 0;
}

function formatState(progress, isLoading) {
  if (isLoading && !progress) {
    return "读取中";
  }

  if (!progress) {
    return "未知";
  }

  if (progress.queue?.inQueue) {
    return "排队中";
  }

  if (progress.state === "running") {
    return "构建中";
  }

  if (progress.state === "unconfigured") {
    return "未配置";
  }

  if (progress.state === "unavailable") {
    return "不可用";
  }

  return progress.currentBuild?.result || progress.state || "未知";
}

function getStatusTone(state, result) {
  if (state === "running" || state === "queued") {
    return "running";
  }

  if (state === "unavailable" || result === "FAILURE") {
    return "danger";
  }

  if (result === "UNSTABLE" || result === "ABORTED") {
    return "warning";
  }

  if (result === "SUCCESS" || state === "success") {
    return "success";
  }

  return "neutral";
}

function getStageTone(stage) {
  if (stage.state && stage.state !== "FINISHED") {
    return "running";
  }

  return getStatusTone(stage.state?.toLowerCase(), stage.result);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "-";
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

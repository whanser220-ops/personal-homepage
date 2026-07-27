export default function BuildMonitorLoading() {
  return (
    <div className="build-monitor-page build-monitor-loading-page">
      <div className="build-monitor-loader" role="status" aria-live="polite">
        <div className="build-monitor-loader-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <h1>构建监控</h1>
          <p>正在启动构建指标面板</p>
        </div>
        <div className="build-monitor-loader-bar" aria-hidden="true" />
      </div>
    </div>
  );
}

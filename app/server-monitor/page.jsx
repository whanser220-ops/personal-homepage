import { ServerMonitorDashboard } from "../../src/components/ServerMonitorDashboard.jsx";

export const metadata = {
  title: "服务监控 | Huang",
  description: "私有服务器运行状态、资源趋势与基础设施监控。",
  robots: { index: false, follow: false, nocache: true },
};

export default function ServerMonitorPage() {
  return <ServerMonitorDashboard />;
}

import { ServerMonitorDashboard } from "../../src/components/ServerMonitorDashboard.jsx";

export const metadata = {
  title: "服务监控 | Huang",
  description: "私有云服务器与应用状态监控。",
  robots: { index: false, follow: false, nocache: true },
};

export default function ServerMonitorPage() {
  return <ServerMonitorDashboard />;
}

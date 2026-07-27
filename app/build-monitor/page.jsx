import { AntdProvider } from "../../src/components/AntdProvider.jsx";
import { BuildMonitorDashboard } from "../../src/components/BuildMonitorDashboard.jsx";

export const metadata = {
  title: "构建监控",
  description: "Unity6 构建业务阶段和资源打点监控。",
};

export default function BuildMonitorPage() {
  return (
    <AntdProvider>
      <BuildMonitorDashboard />
    </AntdProvider>
  );
}

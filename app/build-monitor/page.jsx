import { AntdProvider } from "../../src/components/AntdProvider.jsx";
import { BuildMonitorDashboard } from "../../src/components/BuildMonitorDashboard.jsx";
import { readLatestBuildMetrics } from "../../src/server/buildMetricsDb.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "构建监控",
  description: "Unity6 构建业务阶段和资源打点监控。",
};

export default async function BuildMonitorPage() {
  let initialSnapshot = null;
  try {
    initialSnapshot = await readLatestBuildMetrics();
  } catch {
    initialSnapshot = null;
  }

  return (
    <AntdProvider>
      <BuildMonitorDashboard initialSnapshot={initialSnapshot} />
    </AntdProvider>
  );
}

import { BundleReportDashboard } from "../../src/components/BundleReportDashboard.jsx";

export const metadata = {
  title: "Unity6 YooAsset 构建分析报告",
  description: "Unity6 YooAsset bundle 构建体积、重复资源和依赖深度报告",
};

export default function BundleReportPage() {
  return <BundleReportDashboard />;
}

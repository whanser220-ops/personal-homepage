import { StudyAgentDocs } from "../../../src/components/StudyAgentDocs.jsx";

export const metadata = {
  title: "Study Agent · 云端现状与工具 | Huang",
  description: "Study Agent 云端部署现状、原生工具与学习白板工具的说明、参数和示例。",
};

export default async function StudyAgentPage({ searchParams }) {
  const params = await searchParams;
  return <StudyAgentDocs selectedTool={typeof params.tool === "string" ? params.tool : "overview"} />;
}

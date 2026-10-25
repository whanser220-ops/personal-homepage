import { StudyAgentDocs } from "../../../src/components/StudyAgentDocs.jsx";
import { loadStudyAgentDocs } from "../../../src/server/studyAgentDocs.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata = {
  title: "Study Agent · 云端现状与工具 | Huang",
  description: "Study Agent 云端部署现状、原生工具与学习白板工具的说明、参数和示例。",
};

export default async function StudyAgentPage({ searchParams }) {
  const params = await searchParams ?? {};
  const docs = await loadStudyAgentDocs();
  return <StudyAgentDocs docs={docs} selectedTool={typeof params.tool === "string" ? params.tool : "overview"} />;
}

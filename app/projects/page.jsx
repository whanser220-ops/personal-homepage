import { IllustratedPageFrame } from "../../src/components/IllustratedPageFrame.jsx";
import { Projects } from "../../src/components/Projects.jsx";

export const metadata = {
  title: "项目 | Huang",
  description: "Huang 的项目作品和工具入口。",
};

export default function ProjectsPage() {
  return (
    <IllustratedPageFrame
      active="projects"
      description="从构建链路到实时监控，把复杂工程整理成可见、可验证的系统。"
      eyebrow="PROJECTS / 持续构建"
      title="项目"
    >
      <Projects />
    </IllustratedPageFrame>
  );
}

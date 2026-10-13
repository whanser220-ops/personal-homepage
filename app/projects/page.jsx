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
      description="日常使用的学习助手与工程工具，从这里直接打开。"
      eyebrow="PROJECTS / 持续构建"
      title="项目"
    >
      <Projects />
    </IllustratedPageFrame>
  );
}

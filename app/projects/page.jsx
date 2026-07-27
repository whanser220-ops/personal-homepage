import { PageFrame } from "../../src/components/PageFrame.jsx";
import { Projects } from "../../src/components/Projects.jsx";

export const metadata = {
  title: "项目 | Huang",
  description: "Huang 的项目作品和工具入口。",
};

export default function ProjectsPage() {
  return (
    <PageFrame>
      <main className="projects-page">
        <Projects />
      </main>
    </PageFrame>
  );
}

import { Contact } from "../../src/components/Contact.jsx";
import { DashboardVisual } from "../../src/components/DashboardVisual.jsx";
import { PageFrame } from "../../src/components/PageFrame.jsx";
import { Projects } from "../../src/components/Projects.jsx";

export const metadata = {
  title: "项目 | Huang",
  description: "Huang 的项目作品和工具入口。",
};

export default function ProjectsPage() {
  return (
    <PageFrame>
      <main className="content-page">
        <section className="content-hero">
          <div>
            <p className="eyebrow">Projects</p>
            <h1>项目</h1>
            <p>这里集中放个人主页、构建报告和后续继续扩展的作品入口。</p>
          </div>
          <DashboardVisual className="content-visual" title="Work" />
        </section>
        <Projects />
        <Contact />
      </main>
    </PageFrame>
  );
}

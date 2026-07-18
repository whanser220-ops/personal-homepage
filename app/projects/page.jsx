import { Contact } from "../../src/components/Contact.jsx";
import { PageFrame } from "../../src/components/PageFrame.jsx";
import { Projects } from "../../src/components/Projects.jsx";

export const metadata = {
  title: "项目 | Huang",
  description: "Huang 的项目作品和工具入口。",
};

export default function ProjectsPage() {
  return (
    <PageFrame>
      <main className="content-page essay-page">
        <header className="essay-hero page-animate">
          <p className="eyebrow">Projects</p>
          <h1>项目</h1>
          <p>这里集中放已经上线或正在迭代的作品，保持每个项目的目标、状态和入口清楚可读。</p>
        </header>
        <Projects />
        <Contact />
      </main>
    </PageFrame>
  );
}

import { About } from "../../src/components/About.jsx";
import { Contact } from "../../src/components/Contact.jsx";
import { PageFrame } from "../../src/components/PageFrame.jsx";
import { Stack } from "../../src/components/Stack.jsx";

export const metadata = {
  title: "关于我 | Huang",
  description: "Huang 的个人介绍、能力方向和联系方式。",
};

export default function AboutPage() {
  return (
    <PageFrame>
      <main className="content-page essay-page">
        <header className="essay-hero page-animate">
          <p className="eyebrow">About</p>
          <h1>关于我</h1>
          <p>这里记录我怎样把一个个人主页逐步改造成完整项目：从视觉、交互、工程结构到部署流程。</p>
        </header>
        <About />
        <Stack />
        <Contact />
      </main>
    </PageFrame>
  );
}

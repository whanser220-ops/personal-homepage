import { About } from "../../src/components/About.jsx";
import { AnimatedCat } from "../../src/components/AnimatedCat.jsx";
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
      <main className="content-page">
        <section className="content-hero">
          <div>
            <p className="eyebrow">About</p>
            <h1>关于我</h1>
            <p>从页面表达、交互细节到工程结构，持续把想法做成可以访问和迭代的作品。</p>
          </div>
          <AnimatedCat className="content-cat" tone="blue" />
        </section>
        <About />
        <Stack />
        <Contact />
      </main>
    </PageFrame>
  );
}

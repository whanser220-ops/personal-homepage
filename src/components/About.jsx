import { SectionHeading } from "./SectionHeading.jsx";

export function About() {
  return (
    <section id="about" className="section">
      <SectionHeading eyebrow="About" title="关于我" />
      <div className="split-layout">
        <p>
          我是一名正在持续积累作品的开发者，喜欢把想法拆成清晰的页面、可操作的功能和可以长期维护的代码。
        </p>
        <p>
          这个主页会随着项目经验不断更新：从个人介绍、作品展示，到更完整的交互、内容管理和线上服务能力，
          逐步形成一个真正可用的个人入口。
        </p>
      </div>
    </section>
  );
}

export function About() {
  return (
    <section id="about" className="section prose-section page-animate">
      <h2>我在做什么</h2>
      <p>
        我正在用这个个人主页练习完整的前端工程流程。每一次提示词都会推动页面结构、组件边界、样式系统和部署流程发生变化，
        这些变化会被提交到 GitHub，并通过 Jenkins 部署到服务器。
      </p>
      <p>
        这个项目不是一次性写完的作品，而是一个持续演进的练习场。重点不是把页面写得复杂，而是让每一次改造都能看见代码结构如何变化。
      </p>
      <blockquote>把一个小页面当成真实项目维护，能更早看见工程组织、路由、构建和部署之间的关系。</blockquote>
    </section>
  );
}

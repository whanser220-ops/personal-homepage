const abilities = [
  ["页面表达", "用清晰的层级、排版和视觉节奏组织信息。"],
  ["交互实现", "用 React 状态和 Anime.js 动画增强页面反馈。"],
  ["工程结构", "把路由、组件、样式和数据拆到合适的位置。"],
  ["上线交付", "通过 GitHub PR、Jenkins 和 Nginx 完成可验证部署。"],
];

export function Stack() {
  return (
    <section id="stack" className="section prose-section page-animate">
      <h2>能力方向</h2>
      <div className="prose-list">
        {abilities.map(([title, body]) => (
          <article className="prose-list-item" key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

import { ArrowRight, GitBranch } from "lucide-react";

import { Button } from "./ui/button.jsx";

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-content">
        <p className="eyebrow">Personal homepage</p>
        <h1>Huang，专注把想法做成清晰可用的 Web 体验。</h1>
        <p className="hero-copy">
          我关注界面表达、交互细节和代码结构，希望每个作品都能被快速理解、顺畅使用，
          并在后续迭代中持续变得更完整。
        </p>
        <div className="hero-actions">
          <Button asChild>
            <a href="#projects">
              <span>查看项目</span>
              <ArrowRight aria-hidden="true" size={18} />
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href="#contact">
              <GitBranch aria-hidden="true" size={18} />
              <span>联系我</span>
            </a>
          </Button>
        </div>
      </div>
      <figure className="hero-media">
        <picture>
          <source srcSet="/assets/hero-workspace.webp" type="image/webp" />
          <img
            src="/assets/hero-workspace.png"
            alt="一张现代开发者工作台插画，桌上有电脑、笔记本和绿植。"
          />
        </picture>
      </figure>
    </section>
  );
}

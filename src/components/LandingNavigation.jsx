"use client";

import { useEffect, useRef } from "react";
import { animate, stagger } from "animejs";
import { BookOpen, FolderKanban, Smile } from "lucide-react";

const navItems = [
  { href: "/about", label: "关于我", icon: Smile },
  { href: "/articles", label: "文章", icon: BookOpen },
  { href: "/projects", label: "项目", icon: FolderKanban },
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LandingNavigation() {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!rootRef.current || prefersReducedMotion()) {
      return;
    }

    const panels = [...rootRef.current.querySelectorAll(".dashboard-animate")];
    const floating = [...rootRef.current.querySelectorAll(".dashboard-float")];

    animate(panels, {
      opacity: { from: 0 },
      translateY: { from: "1.3rem" },
      scale: { from: 0.98 },
      delay: stagger(85),
      duration: 760,
      ease: "outCubic",
    });

    const floatAnimation = animate(floating, {
      translateY: ["-0.5rem", "0.5rem"],
      alternate: true,
      loop: true,
      delay: stagger(140),
      duration: 2200,
      ease: "inOutSine",
    });

    return () => floatAnimation?.pause?.();
  }, []);

  return (
    <main className="dashboard-page" ref={rootRef}>
      <div className="dashboard-shell">
        <aside className="dashboard-sidebar glass-panel dashboard-animate" aria-label="主页导航">
          <nav className="dashboard-nav">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <a className="dashboard-nav-link" href={item.href} key={item.label}>
                  <Icon aria-hidden="true" size={24} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        </aside>

        <section className="dashboard-main">
          <section className="hero-profile glass-panel dashboard-animate" aria-labelledby="dashboard-title">
            <span className="profile-orb dashboard-float">WH</span>
            <h2 id="dashboard-title">
              <span>Good Afternoon</span>
              <span>
                I&apos;m <strong>Huang</strong>,
              </span>
              <span>nice to meet you!</span>
            </h2>
          </section>

          <div className="latest-card glass-panel dashboard-animate">
            <h2>最新文章</h2>
            <a className="latest-entry" href="/articles">
              <span className="latest-thumb">01</span>
              <span>
                <h3>个人主页改造记录</h3>
                <p>从静态页面到 Next.js、组件库和部署流水线。</p>
                <time>2026/7/18</time>
              </span>
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}

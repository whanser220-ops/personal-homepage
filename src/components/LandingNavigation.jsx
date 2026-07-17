"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import {
  BookOpen,
  FolderKanban,
  GitBranch,
  Globe2,
  Grid2X2,
  Mail,
  Music2,
  Newspaper,
  PenLine,
  Play,
  Smile,
  Star,
} from "lucide-react";

const navItems = [
  { href: "/articles", label: "近期文章", icon: BookOpen },
  { href: "/projects", label: "我的项目", icon: Grid2X2 },
  { href: "/about", label: "关于网站", icon: Smile },
  { href: "/projects", label: "推荐分享", icon: Star, active: true },
  { href: "/bundle-report", label: "构建报告", icon: Globe2 },
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatClock(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function LandingNavigation() {
  const rootRef = useRef(null);
  const [now, setNow] = useState(() => new Date());
  const calendarDays = useMemo(() => Array.from({ length: 31 }, (_, index) => index + 1), []);
  const today = now.getDate();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
          <div className="dashboard-brand">
            <span className="dashboard-avatar">WH</span>
            <div>
              <h1>Warm Hanser</h1>
              <span className="dashboard-status">开发中</span>
            </div>
          </div>

          <nav className="dashboard-nav">
            <p className="dashboard-nav-title">General</p>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <a className={`dashboard-nav-link${item.active ? " is-active" : ""}`} href={item.href} key={item.label}>
                  <Icon aria-hidden="true" size={24} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        </aside>

        <section className="dashboard-main">
          <div className="banner-card glass-panel dashboard-animate" aria-hidden="true" />

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

          <div className="quick-links dashboard-animate">
            <a className="quick-link quick-link-dark" href="https://github.com/whanser220-ops" rel="noreferrer" target="_blank">
              <GitBranch aria-hidden="true" size={24} />
              GitHub
            </a>
            <a className="quick-link" href="/articles">
              <Newspaper aria-hidden="true" size={24} />
              Articles
            </a>
            <a className="quick-link" href="/projects">
              <FolderKanban aria-hidden="true" size={24} />
              Projects
            </a>
            <a className="quick-link" href="/about" aria-label="联系入口">
              <Mail aria-hidden="true" size={24} />
            </a>
          </div>

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

        <section className="dashboard-right">
          <a className="write-button dashboard-animate" href="/articles">
            <PenLine aria-hidden="true" size={22} />
            写文章
          </a>

          <section className="clock-card glass-panel dashboard-animate" aria-label="当前时间">
            <div className="clock-display">{formatClock(now)}</div>
          </section>

          <section className="calendar-card glass-panel dashboard-animate" aria-label="日历">
            <p className="calendar-caption">{formatDate(now)}</p>
            <div className="calendar-grid">
              {["一", "二", "三", "四", "五", "六", "日"].map((day, index) => (
                <span className={`calendar-weekday${index === 4 ? " is-today" : ""}`} key={day}>
                  {day}
                </span>
              ))}
              {calendarDays.map((day) => (
                <span className={`calendar-day${day === today ? " is-today" : ""}`} key={day}>
                  {day}
                </span>
              ))}
            </div>
          </section>

          <section className="music-card glass-panel dashboard-animate" aria-label="音乐播放器">
            <Music2 className="music-note" aria-hidden="true" size={34} />
            <div>
              <p className="music-title">Close To You</p>
              <div className="music-bar">
                <span className="music-progress" />
              </div>
            </div>
            <span className="music-play">
              <Play aria-hidden="true" size={28} />
            </span>
          </section>
        </section>
      </div>
    </main>
  );
}

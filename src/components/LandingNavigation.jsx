"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { animate, stagger } from "animejs";
import {
  BookOpen,
  Camera,
  CheckSquare,
  ClipboardList,
  Code2,
  FolderKanban,
  GitBranch,
  Heart,
  Lightbulb,
  Mail,
  Map,
  MapPin,
  Palette,
  PenLine,
  Plus,
  Send,
  Sparkles,
  Star,
} from "lucide-react";
import { articles, projects } from "../data/homepage.js";
import { ThemeToggle } from "./ThemeToggle.jsx";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const noteNavItems = [
  { href: "/articles", icon: ClipboardList, label: "全部便签", count: articles.length },
  { href: "/articles", icon: Lightbulb, label: "灵感记录", count: 1 },
  { href: "/articles", icon: BookOpen, label: "读书笔记", count: 1 },
  { href: "/projects", icon: FolderKanban, label: "项目记录", count: projects.length },
  { href: "/about", icon: Send, label: "关于主页", count: null },
];

const weeklyPlans = [
  { label: "完成个人主页视觉改版", icon: BookOpen },
  { label: "整理构建监控项目入口", icon: FolderKanban },
  { label: "写一篇部署流水线笔记", icon: PenLine },
  { label: "继续打磨便签交互", icon: Sparkles },
];

const skillTags = ["UI设计", "前端", "交互", "动画", "Next.js", "Unity", "部署"];

const articleIcons = [Map, Palette, Camera, BookOpen];

export function LandingNavigation() {
  const rootRef = useRef(null);
  const project = projects[0];

  useEffect(() => {
    if (!rootRef.current || prefersReducedMotion()) {
      return;
    }

    const panels = [...rootRef.current.querySelectorAll(".note-animate")];

    if (panels.length === 0) {
      return;
    }

    const entranceAnimation = animate(panels, {
      translateY: { from: "1.3rem" },
      scale: { from: 0.98 },
      delay: stagger(80),
      duration: 680,
      ease: "outCubic",
    });

    return () => entranceAnimation?.pause?.();
  }, []);

  return (
    <main className="note-homepage" ref={rootRef}>
      <img
        className="note-wall-image"
        src="/assets/warm-cafe-hero-tall.png"
        alt=""
        width="1672"
        height="1271"
        aria-hidden="true"
      />

      <section className="note-board" aria-label="个人主页便签墙">
        <aside className="note-stack note-stack-left" aria-label="导航与简介">
          <section className="paper-panel note-menu note-animate">
            <div className="note-panel-title">
              <ClipboardList aria-hidden="true" size={28} />
              <h1>我的便签</h1>
              <Send aria-hidden="true" size={26} />
            </div>

            <nav className="note-menu-list" aria-label="便签分类">
              {noteNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link className="note-menu-link" href={item.href} key={item.label}>
                    <Icon aria-hidden="true" size={20} />
                    <span>{item.label}</span>
                    {item.count !== null ? <strong>{item.count}</strong> : <Send aria-hidden="true" size={17} />}
                  </Link>
                );
              })}

              <ThemeToggle className="note-menu-link note-theme-toggle" />
            </nav>
          </section>

          <section className="paper-panel note-about-card note-animate">
            <div className="note-section-heading">
              <h2>
                关于我
                <Heart aria-hidden="true" size={19} />
              </h2>
            </div>
            <div className="note-about-body">
              <img src="/assets/site-logo.webp" alt="" width="72" height="72" />
              <p>一个喜欢把页面、工程流程和小灵感慢慢整理成作品的前端练习者。</p>
            </div>
            <div className="note-chip-row" aria-label="个人关键词">
              <span>设计</span>
              <span>前端</span>
              <span>项目</span>
            </div>
            <Link className="note-card-action" href="/about">
              更多关于我
              <Send aria-hidden="true" size={17} />
            </Link>
          </section>

          <section className="paper-panel note-project-card note-animate">
            <div className="note-section-heading">
              <h2>
                项目
                <FolderKanban aria-hidden="true" size={22} />
              </h2>
            </div>
            {project ? (
              <div className="note-project-list">
                <Link className="note-project-row" href="/projects">
                  <CheckSquare aria-hidden="true" size={18} />
                  <span>{project.title}</span>
                  <strong>{project.year}</strong>
                </Link>
                {project.links.map((link) => (
                  <Link className="note-project-row" href={link.href} key={link.href}>
                    <CheckSquare aria-hidden="true" size={18} />
                    <span>{link.label}</span>
                    <strong>入口</strong>
                  </Link>
                ))}
              </div>
            ) : null}
            <Link className="note-card-action" href="/projects">
              查看全部项目
              <Send aria-hidden="true" size={17} />
            </Link>
          </section>
        </aside>

        <section className="note-center" aria-label="灵感与文章便签">
          <article className="paper-panel quote-note note-animate">
            <p>“今日一言”</p>
            <blockquote>“灵感不是凭空出现，而是用心去感受生活。”</blockquote>
            <cite>-- 写给自己的主页</cite>
          </article>

          <div className="note-article-strip" aria-label="文章便签">
            {articles.map((article, index) => {
              const Icon = articleIcons[index % articleIcons.length];

              return (
                <Link
                  className="sticky-note article-sticky note-animate"
                  href="/articles"
                  key={article.title}
                  style={{ "--note-tilt": `${index % 2 === 0 ? -1.4 : 1.1}deg` }}
                >
                  <h2>{article.title}</h2>
                  <p>{article.body}</p>
                  <span>
                    <Icon aria-hidden="true" size={23} />
                    <time>{article.date}</time>
                  </span>
                </Link>
              );
            })}

            <Link className="sticky-note new-note-card note-animate" href="/articles">
              <Plus aria-hidden="true" size={34} />
              <span>新建便签</span>
            </Link>
          </div>
        </section>

        <aside className="note-stack note-stack-right" aria-label="计划、技能与联系">
          <section className="paper-panel plan-panel note-animate">
            <div className="note-section-heading">
              <h2>
                本周计划
                <Star aria-hidden="true" size={22} />
              </h2>
              <Star aria-hidden="true" size={20} />
            </div>

            <div className="plan-list">
              {weeklyPlans.map((item) => {
                const Icon = item.icon;

                return (
                  <Link className="plan-row" href="/articles" key={item.label}>
                    <CheckSquare aria-hidden="true" size={18} />
                    <span>{item.label}</span>
                    <Icon aria-hidden="true" size={22} />
                  </Link>
                );
              })}
            </div>
            <p>加油！让每一天都充满创造力</p>
          </section>

          <section className="paper-panel skills-panel note-animate">
            <div className="note-section-heading">
              <h2>
                技能标签
                <Heart aria-hidden="true" size={19} />
              </h2>
            </div>
            <div className="skill-note-grid" aria-label="技能标签">
              {skillTags.map((skill) => (
                <Link href="/about" key={skill}>
                  {skill}
                </Link>
              ))}
            </div>
            <span className="doodle-cat" aria-hidden="true">
              ᓚᘏᗢ
            </span>
          </section>

          <section className="paper-panel contact-panel note-animate">
            <div className="note-section-heading">
              <h2>
                联系我
                <Send aria-hidden="true" size={24} />
              </h2>
            </div>

            <div className="contact-note-list">
              <a href="https://github.com/whanser220-ops" rel="noreferrer" target="_blank">
                <GitBranch aria-hidden="true" size={20} />
                <span>GitHub</span>
                <strong>whanser220-ops</strong>
              </a>
              <Link href="/articles">
                <Mail aria-hidden="true" size={20} />
                <span>文章</span>
                <strong>灵感便签</strong>
              </Link>
              <Link href="/projects">
                <Code2 aria-hidden="true" size={20} />
                <span>项目</span>
                <strong>作品入口</strong>
              </Link>
              <span>
                <MapPin aria-hidden="true" size={20} />
                <span>站点</span>
                <strong>warmhanser.com</strong>
              </span>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

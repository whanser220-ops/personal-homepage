"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { animate, stagger } from "animejs";
import {
  Archive,
  BookOpen,
  Camera,
  CheckSquare,
  ClipboardList,
  Cloud,
  Coffee,
  FolderKanban,
  GitBranch,
  Globe2,
  Heart,
  Leaf,
  Lightbulb,
  Mail,
  Palette,
  PenLine,
  Plus,
  Send,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { projects } from "../data/homepage.js";
import { cn } from "../lib/utils.js";
import styles from "./LandingNavigation.module.css";
import { ThemeToggle } from "./ThemeToggle.jsx";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function css(...names) {
  return cn(...names.map((name) => name && styles[name]));
}

const noteNavItems = [
  { href: "/articles", icon: ClipboardList, label: "全部便签", count: 128 },
  { href: "/articles", icon: Lightbulb, label: "灵感随记", count: 68 },
  { href: "/articles", icon: BookOpen, label: "读书摘抄", count: 24 },
  { href: "/articles", icon: Send, label: "旅行记录", count: 16 },
  { href: "/articles", icon: Trash2, label: "草稿箱", count: 7 },
];

const weeklyPlans = [
  { label: "完成插画练习", meta: "3/5", icon: Palette, done: true },
  { label: "整理读书笔记", icon: BookOpen, done: true },
  { label: "更新作品集页面", icon: FolderKanban },
  { label: "学习新技能：水彩", icon: Sparkles },
  { label: "周末城市漫步拍照", icon: Camera },
];

const skillTags = ["UI设计", "插画", "摄影", "前端", "文案", "品牌", "手账"];

const projectRows = [
  {
    href: "/projects",
    icon: FolderKanban,
    label: "个人作品集",
    count: 12,
    image: "/assets/project-paper-cream.webp",
    tone: "cream",
  },
  {
    href: projects[0]?.links[0]?.href || "/projects",
    icon: PenLine,
    label: "插画练习计划",
    count: 8,
    image: "/assets/project-paper-blue.webp",
    tone: "blue",
  },
  {
    href: "/articles",
    icon: Archive,
    label: "旅行手账",
    count: 5,
    image: "/assets/project-paper-kraft.webp",
    tone: "kraft",
  },
];

const contactRows = [
  { href: "/articles", icon: Mail, label: "邮箱", value: "hello@warmhanser.com" },
  { href: "https://github.com/whanser220-ops", icon: GitBranch, label: "GitHub", value: "whanser220-ops", external: true },
  { href: "/articles", icon: BookOpen, label: "文章", value: "灵感便签" },
  { href: "/", icon: Globe2, label: "站点", value: "warmhanser.com" },
];

const featuredNotes = [
  {
    href: "/articles",
    title: "午后咖啡灵感",
    body: "阳光、咖啡、和一张空白便签。",
    tag: "随记",
    date: "05/18",
    icon: Coffee,
    image: "/assets/article-note-coffee.webp",
    tone: "warm",
  },
  {
    href: "/articles",
    title: "海边小镇速写",
    body: "风很温柔，海浪在耳边说悄悄话。",
    tag: "旅行",
    date: "05/16",
    icon: Cloud,
    image: "/assets/article-note-sea.webp",
    tone: "blue",
  },
  {
    href: "/articles",
    title: "《月亮与六便士》",
    body: "满地都是六便士，他却抬头看见了月亮。",
    tag: "读书",
    date: "05/14",
    icon: BookOpen,
    image: "/assets/article-note-book.webp",
    tone: "amber",
  },
  {
    href: "/articles",
    title: "多肉植物观察",
    body: "每一片叶子，都在认真地生活。",
    tag: "随记",
    date: "05/12",
    icon: Leaf,
    image: "/assets/article-note-plant.webp",
    tone: "green",
  },
];

export function LandingNavigation() {
  const rootRef = useRef(null);

  useEffect(() => {
    if (!rootRef.current || prefersReducedMotion()) {
      return;
    }

    const panels = [...rootRef.current.querySelectorAll(`.${styles["note-animate"]}`)];

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

    const clearMotionStyles = window.setTimeout(() => {
      panels.forEach((panel) => {
        // Let CSS own transforms again after the entrance motion finishes.
        panel.style.removeProperty("transform");
        panel.style.removeProperty("translate");
        panel.style.removeProperty("scale");
      });
    }, 680 + (panels.length - 1) * 80 + 80);

    return () => {
      window.clearTimeout(clearMotionStyles);
      entranceAnimation?.pause?.();
    };
  }, []);

  return (
    <main className={css("note-homepage")} ref={rootRef}>
      <img
        className={css("note-wall-image")}
        src="/assets/warm-cafe-hero-tall.png"
        alt=""
        width="1672"
        height="1271"
        aria-hidden="true"
      />

      <section className={css("note-board")} aria-label="个人主页便签墙">
        <aside className={css("note-stack", "note-stack-left")} aria-label="导航与简介">
          <section className={css("paper-panel", "note-menu", "note-animate")}>
            <div className={css("note-panel-title")}>
              <ClipboardList aria-hidden="true" size={25} />
              <h1>我的便签</h1>
              <Coffee aria-hidden="true" size={28} />
            </div>

            <nav className={css("note-menu-list")} aria-label="便签分类">
              {noteNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link className={css("note-menu-link")} href={item.href} key={item.label}>
                    <Icon aria-hidden="true" size={20} />
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </Link>
                );
              })}

              <ThemeToggle className={css("note-menu-link")} />
            </nav>
          </section>

          <section className={css("paper-panel", "note-about-card", "note-animate")}>
            <div className={css("note-section-heading")}>
              <h2>
                关于我
                <Heart aria-hidden="true" size={19} />
              </h2>
            </div>
            <div className={css("note-about-body")}>
              <img src="/assets/site-logo.webp" alt="" width="72" height="72" />
              <p>喜欢记录生活里的灵感与美好，用画笔和文字收藏每一刻心动。</p>
            </div>
            <div className={css("note-chip-row")} aria-label="个人关键词">
              <span>插画爱好者</span>
              <span>咖啡控</span>
              <span>手账er</span>
            </div>
          </section>

          <section className={css("note-project-card", "project-paper-gallery", "note-animate")} aria-labelledby="project-paper-title">
            <div className={css("project-paper-heading")}>
              <h2 id="project-paper-title">
                项目
                <FolderKanban aria-hidden="true" size={22} />
              </h2>
            </div>
            <div className={css("project-paper-grid")}>
              {projectRows.map((item, index) => {
                const Icon = item.icon;

                return (
                  <Link
                    className={css("project-paper-note", `project-paper-note-${item.tone}`)}
                    href={item.href}
                    key={item.label}
                    style={{ "--project-paper-tilt": `${index % 2 === 0 ? -0.7 : 0.55}deg` }}
                  >
                    <img
                      className={css("project-paper-image")}
                      src={item.image}
                      alt=""
                      width="720"
                      height="480"
                      aria-hidden="true"
                    />
                    <span className={css("project-paper-content")}>
                      <Icon aria-hidden="true" size={19} />
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        </aside>

        <div className={css("note-hero-clear")} aria-hidden="true" />

        <aside className={css("note-stack", "note-stack-right")} aria-label="计划、技能与联系">
          <section className={css("paper-panel", "plan-panel", "note-animate")}>
            <div className={css("note-section-heading")}>
              <h2>
                本周计划
                <Star aria-hidden="true" size={22} />
              </h2>
              <Star aria-hidden="true" size={20} />
            </div>

            <div className={css("plan-list")}>
              {weeklyPlans.map((item) => {
                const Icon = item.icon;

                return (
                  <Link className={css("plan-row", item.done && "is-done")} href="/articles" key={item.label}>
                    <CheckSquare aria-hidden="true" size={18} />
                    <span>{item.label}</span>
                    {item.meta ? <strong>{item.meta}</strong> : <Icon aria-hidden="true" size={22} />}
                  </Link>
                );
              })}
            </div>
          </section>

          <section className={css("paper-panel", "skills-panel", "note-animate")}>
            <div className={css("note-section-heading")}>
              <h2>
                技能标签
                <Heart aria-hidden="true" size={19} />
              </h2>
            </div>
            <div className={css("skill-note-grid")} aria-label="技能标签">
              {skillTags.map((skill) => (
                <Link href="/about" key={skill}>
                  {skill}
                </Link>
              ))}
            </div>
          </section>

          <section className={css("paper-panel", "contact-panel", "note-animate")}>
            <div className={css("note-section-heading")}>
              <h2>
                联系我
                <img
                  className={css("contact-plane-icon")}
                  src="/assets/note-paper-plane.webp"
                  alt=""
                  width="480"
                  height="403"
                  aria-hidden="true"
                />
              </h2>
            </div>

            <div className={css("contact-note-list")}>
              {contactRows.map((item) => {
                const Icon = item.icon;
                const content = (
                  <>
                    <Icon aria-hidden="true" size={19} />
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </>
                );

                return item.external ? (
                  <a href={item.href} key={item.label} rel="noreferrer" target="_blank">
                    {content}
                  </a>
                ) : (
                  <Link href={item.href} key={item.label}>
                    {content}
                  </Link>
                );
              })}
            </div>
          </section>
        </aside>

        <section className={css("note-article-strip")} aria-label="文章便签">
          {featuredNotes.map((note, index) => {
            const Icon = note.icon;

            return (
              <Link
                className={css("sticky-note", "article-sticky", `article-sticky-${note.tone}`, "note-animate")}
                href={note.href}
                key={note.title}
                style={{ "--note-tilt": `${index % 2 === 0 ? -1.1 : 0.9}deg` }}
              >
                <img
                  className={css("article-sticky-image")}
                  src={note.image}
                  alt=""
                  width="720"
                  height="640"
                  aria-hidden="true"
                />
                <div className={css("article-sticky-content")}>
                  <div className={css("article-sticky-head")}>
                    <h2>{note.title}</h2>
                    <Icon aria-hidden="true" size={31} />
                  </div>
                  <p>{note.body}</p>
                  <span>
                    <em>{note.tag}</em>
                    <time>{note.date}</time>
                  </span>
                </div>
              </Link>
            );
          })}

          <Link className={css("sticky-note", "new-note-card", "note-animate")} href="/articles">
            <Plus aria-hidden="true" size={34} />
            <span>新建便签</span>
            <PenLine aria-hidden="true" size={24} />
          </Link>
        </section>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { HomeScene3D } from "./HomeScene3D.jsx";
import styles from "./SceneLanding.module.css";

const destinations = [
  { href: "/articles", title: "文字", description: "学习、思考与随手记" },
  { href: "/projects", title: "作品", description: "把想法慢慢做出来" },
  { href: "/about", title: "关于", description: "很高兴在这里遇见你" },
];

export function LandingNavigation() {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  function closeMenu() {
    dialog.current?.close();
  }
  function openMenu() {
    dialog.current?.showModal();
    setMenuOpen(true);
  }
  return (
    <main className={styles.landing}>
      <div className={styles.world}>
        <HomeScene3D className={styles.scene} />
      </div>
      <div className={styles.edgeShade} aria-hidden="true" />
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="Huang 首页">
          Huang<span>.</span>
        </Link>
        <button
          className={styles.explore}
          ref={trigger}
          onClick={openMenu}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls="home-explore"
        >
          探索 <Plus size={16} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </header>
      <section className={styles.caption} aria-label="欢迎来到我的个人空间">
        <p className={styles.eyebrow}>一些日常，一些灵感</p>
        <h1>一杯咖啡的时间。</h1>
        <p className={styles.description}>让想法，在这里慢慢生长。</p>
      </section>
      <dialog
        ref={dialog}
        id="home-explore"
        className={styles.dialog}
        aria-labelledby="explore-title"
        onClose={() => {
          setMenuOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            closeMenu();
        }}
      >
        <div className={styles.dialogHeading}>
          <p id="explore-title">从这里，去看看</p>
          <button autoFocus onClick={closeMenu} aria-label="关闭探索菜单">
            <X size={18} strokeWidth={1.4} />
          </button>
        </div>
        <nav aria-label="网站导航">
          {destinations.map((item, index) => (
            <Link
              className={styles.destination}
              href={item.href}
              key={item.href}
              onClick={closeMenu}
            >
              <span className={styles.index}>0{index + 1}</span>
              <span className={styles.destinationText}>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
              <ArrowUpRight size={18} strokeWidth={1.2} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <p className={styles.dialogFooter}>不着急，慢慢来。</p>
      </dialog>
    </main>
  );
}

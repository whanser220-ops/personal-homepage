import Link from "next/link";
import { BookOpen, FolderKanban, Home, UserRound } from "lucide-react";

import { ThemeToggle } from "./ThemeToggle.jsx";
import styles from "./LandingNavigation.module.css";

const navigationItems = [
  { href: "/", key: "home", label: "首页", icon: Home },
  { href: "/articles", key: "articles", label: "文章", icon: BookOpen },
  { href: "/projects", key: "projects", label: "项目", icon: FolderKanban },
  { href: "/about", key: "about", label: "关于", icon: UserRound },
];

export function IdentityCard() {
  return (
    <Link aria-label="返回首页" className={styles.identityCard} href="/">
      <span className={styles.identityCopy}>
        <strong>Hi，Huang</strong>
        <small>脑海中天马行空</small>
        <small>把想法慢慢做出来～</small>
      </span>
      <span aria-hidden="true" className={styles.identityAvatar} />
    </Link>
  );
}

export function PortfolioNavigation({ active }) {
  return (
    <nav aria-label="主要导航" className={styles.portfolioNavigation}>
      {navigationItems.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            aria-current={active === item.key ? "page" : undefined}
            className={active === item.key ? styles.isActive : undefined}
            href={item.href}
            key={item.key}
          >
            <Icon aria-hidden="true" size={18} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <ThemeToggle className={styles.portfolioThemeToggle} />
    </nav>
  );
}

export function IllustratedPageFrame({ active, eyebrow, title, description, children }) {
  return (
    <main className={styles.illustratedPage}>
      <img
        alt=""
        aria-hidden="true"
        className={styles.archiveWallImage}
        height="1271"
        src="/assets/hero-character-wall.png"
        width="1672"
      />
      <div aria-hidden="true" className={styles.archiveScrim} />

      <header className={styles.archiveTopbar}>
        <IdentityCard />
        <PortfolioNavigation active={active} />
      </header>

      <div className={styles.archiveBody}>
        <header className={styles.archiveHero}>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <span>{description}</span>
        </header>
        {children}
      </div>
    </main>
  );
}

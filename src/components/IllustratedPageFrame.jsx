import Link from "next/link";
import styles from "./LandingNavigation.module.css";

export function IdentityCard() {
  return (
    <Link aria-label="查看关于我" className={styles.identityCard} href="/about">
      <img
        alt=""
        aria-hidden="true"
        className={styles.identityArt}
        height="340"
        src="/assets/identity-card-art-v2.webp"
        width="1040"
      />
      <span className={styles.identityCopy}>
        <strong>Hi，Huang</strong>
        <small>脑海中天马行空</small>
        <small>把想法慢慢做出来～</small>
      </span>
    </Link>
  );
}

export function IllustratedPageFrame({ eyebrow, title, description, children, showHero = true }) {
  return (
    <main className={`${styles.illustratedPage} ${showHero ? "" : styles.articlePage}`}>
      <header className={styles.archiveTopbar}>
        <IdentityCard />
      </header>

      <div className={styles.archiveBody}>
        {showHero ? (
          <header className={styles.archiveHero}>
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <span>{description}</span>
          </header>
        ) : null}
        {children}
      </div>
    </main>
  );
}

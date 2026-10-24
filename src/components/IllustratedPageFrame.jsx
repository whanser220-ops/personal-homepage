import styles from "./LandingNavigation.module.css";

export function IllustratedPageFrame({ eyebrow, title, description, children, showHero = true }) {
  return (
    <main className={`${styles.illustratedPage} ${showHero ? "" : styles.articlePage}`}>
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

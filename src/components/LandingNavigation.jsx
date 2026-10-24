"use client";

import { HomeScene3D } from "./HomeScene3D.jsx";
import styles from "./SceneLanding.module.css";

export function LandingNavigation() {
  return (
    <main className={styles.landing}>
      <div className={styles.world}>
        <HomeScene3D className={styles.scene} />
      </div>
      <div className={styles.edgeShade} aria-hidden="true" />
      <section className={styles.caption} aria-label="欢迎来到我的个人空间">
        <p className={styles.eyebrow}>一些日常，一些灵感</p>
        <h1>一杯咖啡的时间。</h1>
        <p className={styles.description}>让想法，在这里慢慢生长。</p>
      </section>
    </main>
  );
}

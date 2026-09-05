import Link from "next/link";
import { ArrowRight, FolderKanban } from "lucide-react";

import { projects } from "../data/homepage.js";
import styles from "./LandingNavigation.module.css";

export function Projects() {
  return (
    <section aria-label="项目列表" className={styles.archiveSection}>
      <div className={`${styles.archiveSectionHeading} ${styles.archiveProjectHeading}`}>
        <FolderKanban aria-hidden="true" size={25} />
        <span>BUILT AND RUNNING</span>
      </div>

      <div className={styles.projectArchiveList}>
        {projects.map((project, index) => (
          <Link className={styles.archiveProjectCard} href={project.links[0].href} key={project.title}>
            <div className={styles.archiveProjectIllustration}>
              <img alt="Unity6 自动构建流水线的手绘拓扑" src={project.image} />
            </div>
            <div className={styles.archiveProjectContent}>
              <div className={styles.projectMeta}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <em>{project.status}</em>
              </div>
              <p className={styles.projectEyebrow}>{project.subtitle}</p>
              <h2>{project.title}</h2>
              <p>{project.summary}</p>
              <div className={styles.projectTags}>
                {project.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <strong className={styles.projectCta}>
                打开构建监控
                <ArrowRight aria-hidden="true" size={19} />
              </strong>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

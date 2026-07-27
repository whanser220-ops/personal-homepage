import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { projects } from "../data/homepage.js";

function ProjectLink({ href, children }) {
  const isExternal = href.startsWith("http");
  const className = "project-card-link";

  if (isExternal) {
    return (
      <a className={className} href={href} rel="noreferrer" target="_blank">
        {children}
        <ArrowUpRight aria-hidden="true" size={15} strokeWidth={2} />
      </a>
    );
  }

  return (
    <Link className={className} href={href}>
      {children}
      <ArrowUpRight aria-hidden="true" size={15} strokeWidth={2} />
    </Link>
  );
}

export function Projects() {
  return (
    <section id="projects" className="projects-showcase page-animate" aria-label="项目展示">
      <div className="projects-grid">
        {projects.map((project, index) => (
          <article className={`project-card${index > 1 ? " project-card-compact" : ""}`} key={project.title}>
            <div className="project-card-header">
              <span className="project-card-icon" aria-hidden="true">
                {project.icon}
              </span>
              <div className="project-card-heading">
                <h2>
                  {project.title}
                  <span>{project.year}</span>
                </h2>
                <p>{project.subtitle}</p>
              </div>
            </div>

            <p className="project-card-summary">{project.summary}</p>

            <div className="project-card-tags" aria-label={`${project.title} 技术标签`}>
              {project.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>

            <div className="project-card-actions">
              {project.links.map((link) => (
                <ProjectLink href={link.href} key={`${project.title}-${link.href}`}>
                  {link.label}
                </ProjectLink>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

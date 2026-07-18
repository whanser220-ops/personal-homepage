import { projects } from "../data/homepage.js";
import { Badge } from "./ui/badge.jsx";

export function Projects() {
  return (
    <section id="projects" className="section prose-section page-animate">
      <h2>项目作品</h2>
      <div className="timeline" aria-label="项目作品">
        {projects.map((project) => (
          <article className="timeline-item" key={project.title}>
            <Badge>{project.status}</Badge>
            <h3>{project.title}</h3>
            <p>{project.body}</p>
            {project.href && (
              <a className="inline-link" href={project.href}>
                {project.linkLabel}
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

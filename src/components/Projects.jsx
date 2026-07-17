import { projects } from "../data/homepage.js";
import { SectionHeading } from "./SectionHeading.jsx";
import { Badge } from "./ui/badge.jsx";

export function Projects() {
  return (
    <section id="projects" className="section">
      <SectionHeading eyebrow="Projects" title="项目作品" />
      <div className="timeline" aria-label="项目作品">
        {projects.map((project) => (
          <div className="timeline-item" key={project.title}>
            <Badge>{project.status}</Badge>
            <h3>{project.title}</h3>
            <p>{project.body}</p>
            {project.href && (
              <a className="inline-link" href={project.href}>
                {project.linkLabel}
              </a>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

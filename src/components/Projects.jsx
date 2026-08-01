import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { projects } from "../data/homepage.js";
import Magnet from "./Magnet.jsx";
import { Badge } from "./ui/badge.jsx";
import { Button } from "./ui/button.jsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card.jsx";

function ProjectLink({ href, children, primary = false }) {
  const isExternal = href.startsWith("http");
  const content = (
    <>
      {children}
      <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
    </>
  );

  if (isExternal) {
    return (
      <Magnet magnetStrength={9} padding={28} wrapperClassName="project-action-magnet">
        <Button asChild className="project-card-link" size="sm" variant={primary ? "default" : "outline"}>
          <a href={href} rel="noreferrer" target="_blank">
            {content}
          </a>
        </Button>
      </Magnet>
    );
  }

  return (
    <Magnet magnetStrength={9} padding={28} wrapperClassName="project-action-magnet">
      <Button asChild className="project-card-link" size="sm" variant={primary ? "default" : "outline"}>
        <Link href={href}>{content}</Link>
      </Button>
    </Magnet>
  );
}

export function Projects() {
  return (
    <section id="projects" className="projects-showcase page-animate" aria-label="项目展示">
      <div className="projects-grid">
        {projects.map((project, index) => (
          <Card
            asChild
            className={`project-card${index > 1 ? " project-card-compact" : ""}`}
            key={project.title}
          >
            <article>
              <CardHeader className="project-card-header">
                <span className="project-card-icon" aria-hidden="true">
                  {project.icon}
                </span>
                <div className="project-card-heading">
                  <CardTitle>
                    {project.title}
                    <Badge variant="outline">{project.year}</Badge>
                  </CardTitle>
                  <CardDescription>{project.subtitle}</CardDescription>
                </div>
              </CardHeader>

              <CardContent>
                <p className="project-card-summary">{project.summary}</p>

                <div className="project-card-tags" aria-label={`${project.title} 技术标签`}>
                  {project.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>

              <CardFooter className="project-card-actions">
                {project.links.map((link) => (
                  <ProjectLink href={link.href} key={`${project.title}-${link.href}`} primary={index === 0}>
                    {link.label}
                  </ProjectLink>
                ))}
              </CardFooter>
            </article>
          </Card>
        ))}
      </div>
    </section>
  );
}

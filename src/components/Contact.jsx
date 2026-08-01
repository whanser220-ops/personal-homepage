import { GitBranch } from "lucide-react";
import Magnet from "./Magnet.jsx";
import { Button } from "./ui/button.jsx";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card.jsx";

export function Contact() {
  return (
    <Card asChild className="section prose-section contact-section page-animate">
      <section id="contact">
        <CardHeader>
          <CardTitle>联系</CardTitle>
          <CardDescription>如果你想交流项目、合作机会或作品反馈，可以先通过 GitHub 找到我。</CardDescription>
        </CardHeader>
        <CardFooter>
          <Magnet magnetStrength={9} padding={24} wrapperClassName="contact-action-magnet">
            <Button asChild className="inline-link" variant="outline">
              <a href="https://github.com/whanser220-ops" rel="noreferrer" target="_blank">
                <GitBranch aria-hidden="true" data-icon="inline-start" />
                访问 GitHub
              </a>
            </Button>
          </Magnet>
        </CardFooter>
      </section>
    </Card>
  );
}

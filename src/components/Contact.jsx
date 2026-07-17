import { GitBranch } from "lucide-react";

import { Button } from "./ui/button.jsx";

export function Contact() {
  return (
    <section id="contact" className="section contact-section">
      <div>
        <p className="eyebrow">Contact</p>
        <h2>保持联系</h2>
        <p>如果你想交流项目、合作机会或作品反馈，可以先通过 GitHub 找到我。</p>
      </div>
      <Button asChild>
        <a href="https://github.com/whanser220-ops" rel="noreferrer" target="_blank">
          <GitBranch aria-hidden="true" size={18} />
          <span>访问 GitHub</span>
        </a>
      </Button>
    </section>
  );
}

import { GitBranch } from "lucide-react";

export function Contact() {
  return (
    <section id="contact" className="section prose-section contact-section page-animate">
      <h2>联系</h2>
      <p>如果你想交流项目、合作机会或作品反馈，可以先通过 GitHub 找到我。</p>
      <a className="inline-link" href="https://github.com/whanser220-ops" rel="noreferrer" target="_blank">
        <GitBranch aria-hidden="true" size={18} />
        访问 GitHub
      </a>
    </section>
  );
}

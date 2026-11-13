import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUpRight, GitPullRequest, PackageCheck, Server } from "lucide-react";

import { IllustratedPageFrame } from "../../../src/components/IllustratedPageFrame.jsx";
import styles from "./page.module.css";

export const metadata = {
  title: "CI/CD 自动化交付 · 部署结构 | Huang",
  description: "GitHub、Codex Code Review、Jenkins 与 Harbor 组成的自动化交付系统：PR 隔离测试、本地 WSL 构建和云端部署结构。",
};

const locations = [
  {
    number: "01",
    title: "外部服务",
    subtitle: "GitHub / OpenAI",
    description: "GitHub 保存代码、PR 和检查结果。官方 Codex Code Review 在 OpenAI 侧执行，审查意见回到 PR；Jenkins 另行回写 pr-ci 测试结果。",
  },
  {
    number: "02",
    title: "本地构建环境",
    subtitle: "Windows / WSL Docker Engine",
    description: "Jenkins 主控与 Harbor 镜像仓库运行在本地 WSL。Jenkins 按需启动容器执行任务，完成后回收；桌面安装包另由原生 Windows 环境做安装与升级验收。",
  },
  {
    number: "03",
    title: "云端运行环境",
    subtitle: "Nginx / Docker / systemd",
    description: "Nginx 提供 HTTPS 入口，连接个人主页、学习白板和私有 Agent 服务，也提供 Windows 安装包下载。PostgreSQL 在云端保存网站相关数据。",
  },
];

const releaseSteps = [
  { title: "合入 main", description: "所有者核对当前审查意见、CI 结果与冲突后合并。main 的变更进入各自的发布流水线。" },
  { title: "构建并发布产物", description: "主页和白板生成带提交版本的 Docker 镜像，推送 Harbor；Agent 后端和 Windows 客户端分别生成发布包。" },
  { title: "部署到云端", description: "云端拉取镜像更新容器；后端程序与安装包通过 SSH 发布到对应服务和下载目录。" },
  { title: "检查运行结果", description: "主页部署检查 /api/health，白板检查 /whiteboard/health；容器启动健康检查失败时，部署脚本恢复上一镜像。" },
];

export default function CicdProjectPage() {
  return (
    <IllustratedPageFrame showHero={false}>
      <article className={styles.project}>
        <Link className={styles.backLink} href="/projects">
          <ArrowLeft aria-hidden="true" size={17} />
          返回项目
        </Link>

        <header className={styles.hero}>
          <p className={styles.eyebrow}>ENGINEERING / 持续交付</p>
          <h1>CI/CD 自动化交付</h1>
          <p className={styles.lead}>从一次代码提交，到云端服务的下一次更新。</p>
          <p className={styles.intro}>
            为 Study Agent 和个人网站搭建的交付系统。GitHub 管理代码，Codex Code Review 审查变更，
            Jenkins 独立测试并调度发布，Harbor 保存镜像。构建放在本地 WSL，业务运行在云服务器。
          </p>
          <nav aria-label="项目内容" className={styles.sectionLinks}>
            <a href="#deployment">部署结构 <ArrowDown aria-hidden="true" size={15} /></a>
            <a href="#delivery">交付流程 <ArrowDown aria-hidden="true" size={15} /></a>
          </nav>
        </header>

        <section aria-labelledby="deployment" className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>01 / DEPLOYMENT</p>
              <h2 id="deployment">三处环境，各自承担一段工作</h2>
            </div>
            <Server aria-hidden="true" size={28} />
          </div>
          <p className={styles.sectionIntro}>
            公网事件经云端和 SSH 隧道转发到本地 Jenkins。检查结果回到 GitHub，发布产物进入云端，用户通过 HTTPS 访问业务。
          </p>

          <figure aria-describedby="diagram-caption" className={styles.diagram}>
            <div aria-label="部署结构图，可横向滚动查看" className={styles.diagramViewport} role="region" tabIndex={0}>
              <img
                alt="CI/CD 部署结构：GitHub PR 分别进入 OpenAI 的 Codex 审查和本地 WSL 的 Jenkins 隔离测试；main 发布任务构建镜像到 Harbor，云服务器拉取镜像，并通过 SSH 接收后端与安装包。云端 Nginx 连接主页、白板、私有 Agent 和下载目录。"
                className={styles.diagramImage}
                height={1018}
                src="/assets/cicd-deployment.svg"
                width={1302}
              />
            </div>
            <figcaption id="diagram-caption">
              <span>部署结构 · 根据 2026 年 11 月 13 日的部署核对记录整理。窄屏可横向滚动。</span>
              <a href="/assets/cicd-deployment.svg" rel="noopener noreferrer" target="_blank">
                打开完整图 <ArrowUpRight aria-hidden="true" size={15} />
              </a>
            </figcaption>
          </figure>

          <dl className={styles.locations}>
            {locations.map((location) => (
              <div className={styles.location} key={location.number}>
                <dt>
                  <span className={styles.locationNumber}>{location.number}</span>
                  {location.title}
                  <small>{location.subtitle}</small>
                </dt>
                <dd>{location.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="delivery" className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>02 / DELIVERY</p>
              <h2 id="delivery">PR 检查与 main 发布</h2>
            </div>
            <GitPullRequest aria-hidden="true" size={28} />
          </div>
          <div className={styles.reviewFlow}>
            <div className={styles.flowOrigin}>
              <span>提交 / 更新 PR</span>
              <p>同一份代码变更，进入两条独立的检查路径。</p>
            </div>
            <div className={styles.reviewBranches}>
              <section>
                <h3>Codex Code Review</h3>
                <p>官方托管审查，按仓库规则分析代码；每次推送后复审，将问题和意见写回 PR。</p>
              </section>
              <section>
                <h3>Jenkins PR CI</h3>
                <p>对所有者创建、同仓库、以 main 为目标的非 Draft PR，临时合并后在一次性容器中测试和构建，回写 <code>pr-ci</code>。</p>
              </section>
            </div>
            <p className={styles.flowBoundary}>PR 测试容器不持有发布凭据，也不挂载 Docker socket；只有 main 发布流水线负责发布。</p>
          </div>

          <ol className={styles.releaseSteps}>
            {releaseSteps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="decisions" className={`${styles.section} ${styles.decisions}`}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>03 / OPERATING NOTES</p>
              <h2 id="decisions">这套结构的取舍</h2>
            </div>
            <PackageCheck aria-hidden="true" size={28} />
          </div>
          <ul>
            <li><strong>构建与业务分开。</strong>本地承担构建负载，云端接收完成的产物，集中运行业务服务。</li>
            <li><strong>审查与测试分别给证据。</strong>审查完成和测试通过各有结果，合并前由所有者核对；旧自建门禁已退役。</li>
            <li><strong>本地在线是发布前提。</strong>Windows 电脑或 WSL 离线会影响 Jenkins 构建与发布；官方 Codex 审查独立运行。</li>
          </ul>
          <a
            className={styles.sourceLink}
            href="https://github.com/whanser220-ops/personal-homepage/blob/5ceeb37ab3ecbdacdbba9b9de1e6653621a59cae/Jenkinsfile"
            rel="noopener noreferrer"
            target="_blank"
          >
            查看个人网站发布流水线 <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </section>
      </article>
    </IllustratedPageFrame>
  );
}

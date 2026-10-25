"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Code2, Copy, FilePenLine, FileText, Globe2, Info, Layers3, Menu, Search, Server, Terminal, Undo2, Workflow, X } from "lucide-react";
import styles from "./StudyAgentDocs.module.css";

const icons = { read: FileText, bash: Terminal, edit: FilePenLine, write: Code2, whiteboard_read: BookOpen, whiteboard_edit: Workflow, whiteboard_undo: Undo2 };
const basePath = "/projects/study-agent";
const toolHref = (id) => `${basePath}?tool=${encodeURIComponent(id)}`;
const iconFor = (tool) => Object.hasOwn(icons, tool.id) ? icons[tool.id] : tool.kind === "provider-hosted" ? Globe2 : Layers3;
const executionLabel = (tool) => tool.execution === "provider" ? "模型提供方执行" : "云端执行";
const kindLabel = (tool) => tool.kind === "provider-hosted" ? "提供方托管工具" : "函数工具";
const shortRevision = (revision) => revision.slice(0, 12);

function formatTime(value) {
  if (!value) return "未记录";
  if (!value.includes("T")) return `${value}（北京时间）`;
  return `${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value))}（北京时间）`;
}

function CodeExample({ tool }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const providerHosted = tool.kind === "provider-hosted";
  const code = JSON.stringify(providerHosted ? tool.example : { tool: tool.id, arguments: tool.example }, null, 2);
  useEffect(() => { setCopied(false); setCopyError(false); }, [tool.id, code]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError(false);
    } catch { setCopyError(true); }
  }
  return <div className={styles.codeBlock}>
    <div className={styles.codeHeader}>
      <span>{providerHosted ? "提供方工具配置示例" : "工具调用示例"} <span aria-hidden="true">/</span> JSON</span>
      <button className={styles.copyButton} onClick={copy} type="button" aria-label="复制工具调用示例">
        {copied ? <Check size={14} /> : <Copy size={14} />}<span aria-live="polite">{copyError ? "复制失败，请手动选择" : copied ? "已复制" : "复制"}</span>
      </button>
    </div>
    <pre className={styles.codeContent}><code>{code}</code></pre>
  </div>;
}

function DocumentSource({ docs }) {
  if (docs.source.kind === "fallback") {
    return <div className={styles.notice} role="status">
      <Info size={18} className={styles.noticeIcon} />
      <div className={styles.noticeBody}><strong>正在显示静态回退快照</strong><p>{docs.source.reason === "invalid-document" ? "自动文档未通过格式、版本或内容范围检查。" : "当前无法读取有效的自动文档。"}以下内容保留自 {docs.deployment.verifiedAt.slice(0, 10)} 的静态快照，不能代表当前云端部署。</p></div>
    </div>;
  }
  return <p className={styles.verifiedNote}>由 Study Agent 模型生成 · {formatTime(docs.generatedAt)} · {docs.generator.model}。对应部署版本 {shortRevision(docs.deployment.revision)}。</p>;
}

function Overview({ docs }) {
  const { overview, tools, deployment } = docs;
  const generated = docs.source.kind === "generated";
  const functionCount = tools.filter((tool) => tool.kind === "function").length;
  const hostedCount = tools.filter((tool) => tool.kind === "provider-hosted").length;
  return <>
    <div className={styles.eyebrow}>PROJECT DOCUMENTATION</div>
    <h1 className={styles.title}>Study Agent</h1>
    <p className={styles.lead}>{overview.lead}</p>
    <div className={styles.badges}>
      <span className={styles.badge}><span className={styles.badgeDot} />{generated ? "模型生成文档" : "静态快照"}</span>
      <span className={styles.mutedBadge}>{deployment.runtime} · {deployment.mode}</span>
      <span className={styles.mutedBadge}>{functionCount} 个函数工具</span>
      <span className={styles.mutedBadge}>{hostedCount} 个托管工具</span>
    </div>

    <section className={styles.section} id="status">
      <h2 className={styles.sectionHeading}>{generated ? "对应部署版本" : "快照记录的部署"}</h2>
      <p className={styles.sectionIntro}>{overview.introduction}</p>
      <div className={styles.statusStrip}>
        <div className={styles.statusItem}><span className={styles.statusLabel}><Server size={15} />运行环境</span><span className={styles.statusValue}>{deployment.runtime}</span></div>
        <div className={styles.statusItem}><span className={styles.statusLabel}><Globe2 size={15} />运行模式</span><span className={styles.statusValue}>{deployment.mode === "remote" ? "远程 Agent" : deployment.mode}</span></div>
        <div className={styles.statusItem}><span className={styles.statusLabel}><Layers3 size={15} />部署版本</span><span className={styles.statusValue}><code title={deployment.revision}>{shortRevision(deployment.revision)}</code></span></div>
      </div>
      <p className={styles.verifiedNote}>部署核验时间 · {formatTime(deployment.verifiedAt)}。本页是部署文档，不查询用户会话或执行工具。</p>
    </section>

    <section className={styles.section} id="tools">
      <h2 className={styles.sectionHeading}>可用工具</h2>
      <p className={styles.sectionIntro}>文档记录 {functionCount} 个函数工具与 {hostedCount} 个提供方托管工具。点击查看工具类别、使用条件、参数与执行范围。</p>
      <div className={styles.toolGrid}>{tools.map((tool) => {
        const Icon = iconFor(tool);
        return <Link className={styles.toolCard} href={toolHref(tool.id)} key={tool.id}>
          <div className={styles.toolCardTop}><span className={styles.toolCardIcon}><Icon size={19} strokeWidth={1.6} /></span><ArrowRight size={16} className={styles.cardArrow} /></div>
          <span className={styles.toolCardName}>{tool.title}</span><code className={styles.toolCardCode}>{tool.id} · {kindLabel(tool)}</code><p className={styles.toolCardDesc}>{tool.summary}</p>
        </Link>;
      })}</div>
    </section>

    <section className={styles.section} id="workflow">
      <h2 className={styles.sectionHeading}>一次任务怎样运行</h2>
      <div className={styles.steps}>{overview.workflow.map((step, index) => <div className={styles.step} key={`${index}-${step.title}`}><span className={styles.stepIndex}>{index + 1}</span><div><h3 className={styles.stepTitle}>{step.title}</h3><p className={styles.stepText}>{step.body}</p></div></div>)}</div>
    </section>

    <section className={styles.section} id="boundaries">
      <h2 className={styles.sectionHeading}>能力与执行范围</h2>
      {overview.boundaries.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>能力</th><th>当前文档说明</th></tr></thead><tbody>{overview.boundaries.map((item, index) => <tr key={`${index}-${item.title}`}><td>{item.title}</td><td>{item.body}</td></tr>)}</tbody></table></div> : <p>这份文档没有补充执行范围说明。</p>}
    </section>

    <section className={styles.section} id="about">
      <h2 className={styles.sectionHeading}>关于这份文档</h2>
      <p>{generated ? "模型依据部署资料生成公开说明，发布流程在对应远程版本部署成功后发布文档。" : "自动文档暂不可用，当前保留此前人工整理的静态快照。"}工具示例仅说明输入结构，浏览此页不会执行。</p>
      <p>部署版本：<code className={styles.inlineCode}>{deployment.revision}</code></p>
      {generated && <p className={styles.verifiedNote}>生成引擎：{docs.generator.engine} · 模型：{docs.generator.model} · 生成时间：{formatTime(docs.generatedAt)}</p>}
      {overview.notes.length > 0 && <ul>{overview.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    </section>
  </>;
}

function ToolArticle({ tool, docs }) {
  const Icon = iconFor(tool);
  const group = docs.toolGroups.find((entry) => entry.id === tool.group);
  const providerHosted = tool.kind === "provider-hosted";
  return <>
    <div className={styles.eyebrow}>{group.title}</div>
    <h1 className={styles.title}>{tool.title}</h1>
    <p className={styles.lead}>{tool.summary}</p>
    <div className={styles.badges}><span className={styles.badge}><Icon size={14} />{kindLabel(tool)}</span><span className={styles.mutedBadge}><code>{tool.id}</code></span><span className={styles.mutedBadge}>{executionLabel(tool)}</span></div>
    <section className={styles.section} id="usage">
      <h2 className={styles.sectionHeading}>使用方式</h2><p>{tool.description}</p>
      <div className={styles.notice}><Info size={18} className={styles.noticeIcon} /><div className={styles.noticeBody}><strong>可用条件</strong><p>{tool.availability}</p></div></div>
      <p className={styles.verifiedNote}>{providerHosted ? "由模型提供方托管执行；其配置与调用结构由提供方接口决定。" : "在对话中描述需求，由 Agent 决定是否调用。以下是 Agent 工具参数，不是公开 HTTP API。"}</p>
    </section>
    <section className={styles.section} id="parameters">
      <h2 className={styles.sectionHeading}>{providerHosted ? "配置与输入参数" : "输入参数"}</h2>
      {tool.parameters.length ? <div className={styles.definitionList}>{tool.parameters.map((param) => <div className={styles.definitionRow} key={param.name}><div><code className={styles.paramName}>{param.name}</code><span className={styles.paramType}>{param.type} · {param.required ? "必填" : "可选"}</span></div><p className={styles.paramDescription}>{param.description}</p></div>)}</div> : <p>{providerHosted ? "此托管能力未登记 Agent 函数入参，请结合下方配置示例与可用条件阅读。" : "此工具未登记输入参数。"}</p>}
      {tool.notes?.length > 0 && <div className={styles.notice}><Info size={18} className={styles.noticeIcon} /><div className={styles.noticeBody}><strong>补充说明</strong>{tool.notes.map((note, index) => <p key={index}>{note}</p>)}</div></div>}
    </section>
    <section className={styles.section} id="example"><h2 className={styles.sectionHeading}>{providerHosted ? "配置示例" : "调用示例"}</h2><p>{tool.examplePrompt}</p><CodeExample tool={tool} key={tool.id} /><p className={styles.verifiedNote}>示例仅用于说明结构，不会在浏览此页时执行。</p></section>
    <section className={styles.section} id="result"><h2 className={styles.sectionHeading}>返回结果</h2><p>{tool.result}</p></section>
    <section className={styles.section} id="limits"><h2 className={styles.sectionHeading}>执行范围与限制</h2>{tool.limits.length ? <ul>{tool.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul> : <p>这份文档未登记额外限制。</p>}</section>
    <p className={styles.verifiedNote}>文档对应部署版本 {docs.deployment.revision}。{docs.source.kind === "generated" ? `模型生成于 ${formatTime(docs.generatedAt)}。` : "当前为静态回退快照。"}本页不读取用户会话的实时工具列表。</p>
  </>;
}

export function StudyAgentDocs({ selectedTool, docs }) {
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const tool = docs.tools.find((entry) => entry.id === selectedTool);
  const overview = !tool;
  const sections = overview ? [["status", "对应部署版本"], ["tools", "可用工具"], ["workflow", "运行方式"], ["boundaries", "能力与范围"], ["about", "关于文档"]] : [["usage", "使用方式"], ["parameters", "输入参数"], ["example", "调用示例"], ["result", "返回结果"], ["limits", "范围与限制"]];
  const filtered = docs.tools.filter((entry) => `${entry.id} ${entry.title} ${entry.summary} ${entry.kind}`.toLowerCase().includes(query.trim().toLowerCase()));
  const index = tool ? docs.tools.indexOf(tool) : -1;
  const next = docs.tools[index + 1];

  useEffect(() => {
    setMobileOpen(false);
    setActiveSection("");
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView({ behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
  }, [selectedTool]);
  useEffect(() => {
    if (!mobileOpen) return;
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        document.getElementById("agent-menu-button")?.focus();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActiveSection(visible[0].target.id);
    }, { rootMargin: "-90px 0px -55% 0px", threshold: 0 });
    document.querySelectorAll("[data-agent-docs] article section[id]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [selectedTool]);

  return <div className={styles.shell} data-agent-docs>
    <a className={styles.skipLink} href="#agent-content">跳转到内容</a>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/" aria-label="Huang 的个人主页"><span className={styles.brandMark}>H</span><span>Huang<span className={styles.navMeta}> / Projects</span></span></Link>
      <div className={styles.topBreadcrumb}><span>项目文档</span><ChevronRight size={13} /><strong>Study Agent</strong></div>
      <div className={styles.topActions}><Link className={styles.backLink} href="/projects"><ArrowLeft size={14} />项目列表</Link><button className={styles.mobileMenuButton} id="agent-menu-button" type="button" aria-label="切换工具目录" aria-expanded={mobileOpen} aria-controls="agent-navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button></div>
    </header>
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`} id="agent-navigation" aria-label="项目与工具目录">
        <div className={styles.sidebarInner}>
          <div className={styles.projectLabel}><span>STUDY AGENT</span><span className={styles.navMeta}>文档</span></div>
          <div className={styles.searchBox}><Search size={15} className={styles.searchIcon} /><input className={styles.searchInput} type="search" placeholder="搜索工具…" aria-label="搜索工具" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <nav aria-label="工具导航">
            <Link className={`${styles.navItem} ${overview ? styles.navActive : ""}`} href={basePath} aria-current={overview ? "page" : undefined} onClick={() => setMobileOpen(false)}><Layers3 size={16} className={styles.navIcon} /><span>概览</span></Link>
            {docs.toolGroups.map((group) => {
              const items = filtered.filter((entry) => entry.group === group.id);
              if (!items.length) return null;
              return <div className={styles.navGroup} key={group.id}><h2 className={styles.navGroupTitle}>{group.title}</h2>{items.map((entry) => {
                const Icon = iconFor(entry);
                return <Link className={`${styles.navItem} ${tool?.id === entry.id ? styles.navActive : ""}`} href={toolHref(entry.id)} key={entry.id} aria-current={tool?.id === entry.id ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon size={16} className={styles.navIcon} /><span>{entry.title}</span></Link>;
              })}</div>;
            })}
            {!filtered.length && <p className={styles.emptyState}>未找到匹配工具，请尝试其他关键词。</p>}
          </nav>
          <div className={styles.sidebarFooter}><span className={styles.badgeDot} /><span>{docs.source.kind === "generated" ? "部署版本文档" : "静态回退快照"}<br /><span className={styles.navMeta}>{shortRevision(docs.deployment.revision)}</span></span></div>
        </div>
      </aside>
      <main className={styles.main} id="agent-content">
        <noscript><nav aria-label="全部工具" className={styles.summaryLine}><a href={basePath}>概览</a>{docs.tools.map((entry) => <span key={entry.id}> · <a href={toolHref(entry.id)}>{entry.title}</a></span>)}</nav></noscript>
        <div className={styles.breadcrumb}><span>Study Agent</span><ChevronRight size={12} /><span>{overview ? "概览" : tool.title}</span></div>
        <DocumentSource docs={docs} />
        <article className={styles.article} key={selectedTool}>{overview ? <Overview docs={docs} /> : <ToolArticle tool={tool} docs={docs} />}</article>
        <footer className={styles.footer}><span>Study Agent · 项目文档</span>{next ? <Link className={styles.footerNav} href={toolHref(next.id)}>下一页：{next.title}<ArrowRight size={15} /></Link> : <Link className={styles.footerNav} href={basePath}>返回概览<ArrowRight size={15} /></Link>}</footer>
      </main>
      <aside className={styles.toc} aria-label="本页目录"><div className={styles.tocTitle}>本页内容</div>{sections.map(([id, title]) => <a className={`${styles.tocLink} ${activeSection === id ? styles.tocActive : ""}`} href={`#${id}`} key={id}>{title}</a>)}<div className={styles.relatedLinks}><span className={styles.navMeta}>相关内容</span><Link className={styles.subtleLink} href="/articles/tool-execution">工具怎样执行<ArrowRight size={12} /></Link><Link className={styles.subtleLink} href="/articles/knowledge-map">学习知识地图<ArrowRight size={12} /></Link></div></aside>
    </div>
  </div>;
}

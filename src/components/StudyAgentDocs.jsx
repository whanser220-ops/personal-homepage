"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Code2, Copy, FilePenLine, FileText, Globe2, Info, Layers3, Menu, Search, Server, Terminal, Undo2, Workflow, X } from "lucide-react";
import { agentSnapshot, toolGroups, agentTools } from "../data/studyAgent.js";
import styles from "./StudyAgentDocs.module.css";

const icons = { read: FileText, bash: Terminal, edit: FilePenLine, write: Code2, whiteboard_read: BookOpen, whiteboard_edit: Workflow, whiteboard_undo: Undo2 };
const basePath = "/projects/study-agent";
const toolHref = (id) => `${basePath}?tool=${encodeURIComponent(id)}`;

function CodeExample({ tool }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const code = JSON.stringify({ tool: tool.id, arguments: tool.example }, null, 2);
  useEffect(() => { setCopied(false); setCopyError(false); }, [tool.id]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError(false);
    } catch { setCopyError(true); }
  }
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>工具调用示例 <span aria-hidden="true">/</span> JSON</span>
        <button className={styles.copyButton} onClick={copy} type="button" aria-label="复制工具调用示例">
          {copied ? <Check size={14} /> : <Copy size={14} />}<span aria-live="polite">{copyError ? "复制失败，请手动选择" : copied ? "已复制" : "复制"}</span>
        </button>
      </div>
      <pre className={styles.codeContent}><code>{code}</code></pre>
    </div>
  );
}

function Overview() {
  return (
    <>
      <div className={styles.eyebrow}>PROJECT DOCUMENTATION</div>
      <h1 className={styles.title}>Study Agent</h1>
      <p className={styles.lead}>运行在云端的学习 Agent。<br />在这里了解它怎样工作，以及现在能使用哪些工具。</p>
      <div className={styles.badges}><span className={styles.badge}><span className={styles.badgeDot} />云端已部署</span><span className={styles.mutedBadge}>Native Pi runtime</span><span className={styles.mutedBadge}>{agentTools.length} 个默认工具</span></div>

      <section className={styles.section} id="status">
        <h2 className={styles.sectionHeading}>当前部署</h2>
        <p className={styles.sectionIntro}>桌面端负责交互，云端负责运行 Agent、执行工具并保存会话。模型通过服务器的独立网络出口访问。</p>
        <div className={styles.statusStrip}>
          <div className={styles.statusItem}><span className={styles.statusLabel}><Server size={15} />Agent 进程</span><span className={styles.statusValue}>运行中<span>核对时</span></span></div>
          <div className={styles.statusItem}><span className={styles.statusLabel}><Globe2 size={15} />模型出口</span><span className={styles.statusValue}>云端独立出口</span></div>
          <div className={styles.statusItem}><span className={styles.statusLabel}><Layers3 size={15} />部署版本</span><span className={styles.statusValue}><code>{agentSnapshot.revision}</code></span></div>
        </div>
        <p className={styles.verifiedNote}>部署快照 · {agentSnapshot.verifiedAt}（北京时间）核对。进程与出口连通性已核查；本次未执行模型推理或逐项调用工具。</p>
      </section>

      <section className={styles.section} id="tools">
        <h2 className={styles.sectionHeading}>可用工具</h2>
        <p className={styles.sectionIntro}>已部署版本的默认远程会话配置包含 {agentTools.length} 个工具。点击查看用途、输入参数、调用示例和执行范围。</p>
        <div className={styles.toolGrid}>
          {agentTools.map((tool) => {
            const Icon = icons[tool.id];
            return <Link className={styles.toolCard} href={toolHref(tool.id)} key={tool.id}>
              <div className={styles.toolCardTop}><span className={styles.toolCardIcon}><Icon size={19} strokeWidth={1.6} /></span><ArrowRight size={16} className={styles.cardArrow} /></div>
              <span className={styles.toolCardName}>{tool.title}</span><code className={styles.toolCardCode}>{tool.id}</code><p className={styles.toolCardDesc}>{tool.summary}</p>
            </Link>;
          })}
        </div>
      </section>

      <section className={styles.section} id="workflow">
        <h2 className={styles.sectionHeading}>一次任务怎样运行</h2>
        <div className={styles.steps}>
          {[
            ["在桌面端提出问题", "桌面应用连接已配置的云端运行环境，把问题发送给远程 Agent。"],
            ["模型选择工具", "Agent 将当前已启用、可直接调用的工具提供给模型；需要读取资料、执行命令或更新白板时，模型生成工具调用。"],
            ["云端执行并返回结果", "Pi runtime 在服务器执行工具，将结果送回模型，继续生成回答。会话记录保存在云端。"],
          ].map(([title, text], index) => <div className={styles.step} key={title}><span className={styles.stepIndex}>{index + 1}</span><div><h3 className={styles.stepTitle}>{title}</h3><p className={styles.stepText}>{text}</p></div></div>)}
        </div>
      </section>

      <section className={styles.section} id="boundaries">
        <h2 className={styles.sectionHeading}>能力与执行范围</h2>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>能力</th><th>当前情况</th></tr></thead><tbody>
          <tr><td>文件与命令</td><td>读写服务器可访问的文件，在云端执行 Bash 命令；桌面本地文件需要先传入云端。</td></tr>
          <tr><td>学习白板</td><td>读取、编辑及撤销会话绑定的学习白板；编辑使用读取结果中的 readToken，发生冲突时重新读取。</td></tr>
          <tr><td>联网搜索</td><td>未启用专用 Web Search / Tavily 搜索工具。模型联网出口与搜索工具是两件事。</td></tr>
          <tr><td>扩展与 MCP</td><td>本次核对未发现启用的 MCP 配置。可选工具与内置扩展不计入默认工具清单。</td></tr>
          <tr><td>任务恢复</td><td>会话记录保存在云端；断线恢复、长任务自动续跑及跨设备接续尚未在本次核查中验证。</td></tr>
        </tbody></table></div>
        <div className={styles.notice}><Info size={18} className={styles.noticeIcon} /><div className={styles.noticeBody}><strong>关于原来的网页入口</strong><p><a href="https://warmhanser.com/study/" target="_blank" rel="noopener noreferrer">/study/ 网页服务</a>与这里介绍的远程 Agent 是两个运行实例。远程 Agent 通过桌面端连接；本页用于公开展示部署与工具说明。</p></div></div>
      </section>

      <section className={styles.section} id="about">
        <h2 className={styles.sectionHeading}>关于这份文档</h2>
        <p>内容依据云端部署版本 <code className={styles.inlineCode}>{agentSnapshot.revision}</code> 的服务状态、运行配置和工具注册代码整理。工具示例仅说明输入结构，不会在浏览此页时执行。</p>
        <p className={styles.verifiedNote}>部署与工具清单为上述时间的配置核对快照，未读取某个用户当前会话的实时工具列表；后续配置变化需要更新文档。</p>
      </section>
    </>
  );
}

function ToolArticle({ tool }) {
  const Icon = icons[tool.id];
  return <>
    <div className={styles.eyebrow}>{tool.group === "whiteboard" ? "LEARNING WHITEBOARD" : "COMPUTER & FILES"}</div>
    <h1 className={styles.title}>{tool.title}</h1>
    <p className={styles.lead}>{tool.summary}</p>
    <div className={styles.badges}><span className={styles.badge}><Icon size={14} />默认会话工具</span><span className={styles.mutedBadge}><code>{tool.id}</code></span><span className={styles.mutedBadge}>云端执行</span></div>
    <section className={styles.section} id="usage"><h2 className={styles.sectionHeading}>使用方式</h2><p>{tool.description}</p><p className={styles.verifiedNote}>在对话中描述需求，由 Agent 决定是否调用。以下是工具参数说明，不是公开 HTTP API。</p></section>
    <section className={styles.section} id="parameters"><h2 className={styles.sectionHeading}>输入参数</h2><div className={styles.definitionList}>
      {tool.parameters.map((param) => <div className={styles.definitionRow} key={param.name}><div><code className={styles.paramName}>{param.name}</code><span className={styles.paramType}>{param.type} · {param.required ? "必填" : "可选"}</span></div><p className={styles.paramDescription}>{param.description}</p></div>)}
    </div>{tool.notes && <div className={styles.notice}><Info size={18} className={styles.noticeIcon} /><div className={styles.noticeBody}><strong>知识地图补丁结构</strong>{tool.notes.map((note) => <p key={note}>{note}</p>)}</div></div>}</section>
    <section className={styles.section} id="example"><h2 className={styles.sectionHeading}>调用示例</h2><p>{tool.examplePrompt}</p><CodeExample tool={tool} key={tool.id} /><p className={styles.verifiedNote}>示例数据 · 用于说明结构，未在服务器执行。</p></section>
    <section className={styles.section} id="result"><h2 className={styles.sectionHeading}>返回结果</h2><p>{tool.result}</p></section>
    <section className={styles.section} id="limits"><h2 className={styles.sectionHeading}>执行范围与限制</h2><ul>{tool.limits.map((limit) => <li key={limit}>{limit}</li>)}</ul></section>
    <div className={styles.notice}><Info size={18} className={styles.noticeIcon} /><div className={styles.noticeBody}><strong>工具清单的核对范围</strong><p>依据云端 {agentSnapshot.revision} 的默认会话配置整理。白板工具在认证会话创建时加载；本次未读取现有用户会话的实时工具列表或逐项执行工具。</p></div></div>
  </>;
}

export function StudyAgentDocs({ selectedTool }) {
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const tool = agentTools.find((entry) => entry.id === selectedTool);
  const overview = !tool;
  const sections = overview ? [["status", "当前部署"], ["tools", "可用工具"], ["workflow", "运行方式"], ["boundaries", "能力与范围"], ["about", "关于文档"]] : [["usage", "使用方式"], ["parameters", "输入参数"], ["example", "调用示例"], ["result", "返回结果"], ["limits", "范围与限制"]];
  const filtered = agentTools.filter((entry) => `${entry.id} ${entry.title} ${entry.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  const index = tool ? agentTools.indexOf(tool) : -1;
  const next = agentTools[index + 1];

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
            {toolGroups.map((group) => {
              const items = filtered.filter((entry) => entry.group === group.id);
              if (!items.length) return null;
              return <div className={styles.navGroup} key={group.id}><h2 className={styles.navGroupTitle}>{group.title}</h2>{items.map((entry) => {
                const Icon = icons[entry.id];
                return <Link className={`${styles.navItem} ${tool?.id === entry.id ? styles.navActive : ""}`} href={toolHref(entry.id)} key={entry.id} aria-current={tool?.id === entry.id ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon size={16} className={styles.navIcon} /><span>{entry.title}</span></Link>;
              })}</div>;
            })}
            {!filtered.length && <p className={styles.emptyState}>未找到匹配工具。试试“白板”或“read”。</p>}
          </nav>
          <div className={styles.sidebarFooter}><span className={styles.badgeDot} /><span>云端部署快照<br /><span className={styles.navMeta}>{agentSnapshot.verifiedDate} · {agentSnapshot.revision}</span></span></div>
        </div>
      </aside>
      <main className={styles.main} id="agent-content">
        <noscript><nav aria-label="全部工具" className={styles.summaryLine}><a href={basePath}>概览</a>{agentTools.map((entry) => <span key={entry.id}> · <a href={toolHref(entry.id)}>{entry.title}</a></span>)}</nav></noscript>
        <div className={styles.breadcrumb}><span>Study Agent</span><ChevronRight size={12} /><span>{overview ? "概览" : tool.title}</span></div>
        <article className={styles.article} key={selectedTool}>{overview ? <Overview /> : <ToolArticle tool={tool} />}</article>
        <footer className={styles.footer}><span>Study Agent · 项目文档</span>{next ? <Link className={styles.footerNav} href={toolHref(next.id)}>下一页：{next.title}<ArrowRight size={15} /></Link> : <Link className={styles.footerNav} href={basePath}>返回概览<ArrowRight size={15} /></Link>}</footer>
      </main>
      <aside className={styles.toc} aria-label="本页目录"><div className={styles.tocTitle}>本页内容</div>{sections.map(([id, title]) => <a className={`${styles.tocLink} ${activeSection === id ? styles.tocActive : ""}`} href={`#${id}`} key={id}>{title}</a>)}<div className={styles.relatedLinks}><span className={styles.navMeta}>相关内容</span><Link className={styles.subtleLink} href="/articles/tool-execution">工具怎样执行<ArrowRight size={12} /></Link><Link className={styles.subtleLink} href="/articles/knowledge-map">学习知识地图<ArrowRight size={12} /></Link></div></aside>
    </div>
  </div>;
}

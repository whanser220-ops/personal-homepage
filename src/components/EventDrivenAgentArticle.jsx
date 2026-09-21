"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import styles from "./EventDrivenArticle.module.css";

hljs.registerLanguage("javascript", javascript);

const sections = [
  { id: "event-object", label: "告警怎样变成事件" },
  { id: "dispatch", label: "谁真正调用监听器" },
  { id: "directions", label: "两条方向" },
  { id: "agent-loop", label: "告警何时进入 Agent" },
  { id: "contrast", label: "拿掉连接会怎样" },
  { id: "timing", label: "事件不等于异步" },
];

function CodeBlock({ children }) {
  const code = String(children).replace(/^\n/, "").replace(/\n\s*$/, "");
  const highlighted = hljs.highlight(code, { language: "javascript" }).value;
  return <pre className={styles.codeBlock} data-language="javascript"><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>;
}

function TocLinks({ activeId }) {
  return <ul className={styles.tocList}>{sections.map((section, index) => (
    <li key={section.id}><a aria-current={activeId === section.id ? "location" : undefined} className={activeId === section.id ? styles.tocActive : undefined} href={`#${section.id}`}><span>{String(index + 1).padStart(2, "0")}</span>{section.label}</a></li>
  ))}</ul>;
}

function ArticleToc({ activeId }) {
  return <>
    <aside className={styles.toc} aria-label="文章目录"><p className={styles.tocLabel}>ON THIS PAGE</p><TocLinks activeId={activeId} /></aside>
    <details className={styles.mobileToc}><summary>本页目录</summary><nav aria-label="本页目录"><TocLinks activeId={activeId} /></nav></details>
  </>;
}

export function EventDrivenAgentArticle() {
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    const headings = sections.map(({ id }) => document.getElementById(id)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-112px 0px -62% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, []);

  return <article className={styles.articleShell}>
    <Link className={styles.backLink} href="/articles">← 返回文章列表</Link>
    <Link className={styles.mapLink} href="/articles/knowledge-map">查看这篇文章在知识地图中的位置 →</Link>
    <header className={styles.articleHeader}>
      <p className={styles.kicker}>学习文章 · 事件驱动 Agent</p>
      <h1>事件驱动的 Agent：谁在什么时候把什么交给谁？</h1>
      <p className={styles.lead}>一个 Agent 正在分析部署日志，构建系统却突然发来失败告警。我们沿着这条告警追踪：它怎样变成事件对象，谁保存订阅关系，谁调用监听器，以及它何时真正进入 Agent 的下一次决策。</p>
      <div className={styles.meta}><time dateTime="2026-09-21">2026-09-21</time><span>阅读约 12 分钟</span><span>本地 PDF 材料重写 · 无线上检索</span></div>
    </header>
    <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>
    <div className={styles.articleLayout}>
      <div className={styles.articleBody}>
        <p>Agent 已经开始读取日志，结果还没回来。这时，构建系统发来：“构建 #42 失败：缺少配置文件。”同时，界面显示“正在读取日志”。这两个现象都像是消息带来了变化，但方向不同：进度信息从 Agent 发往界面；构建告警从外部进入应用，接下来才可能影响 Agent。</p>
        <p className={styles.takeaway}><strong>本文只把本地 PDF 第 4.7 节当作材料，重新解释一个问题：谁产生事实，谁传递，谁处理？</strong></p>

        <h2 id="event-object">1. 告警怎样变成可以传递的数据？</h2>
        <p>构建系统知道“构建失败”，不意味着 Agent 已经知道。应用入口接收请求、解析请求体，再把它整理成一个事件对象：</p>
        <CodeBlock>{`const event = {
  type: "build.failed",
  source: "build-system",
  taskId: "analysis-1",
  buildId: 42,
  content: "构建失败：缺少配置文件"
};`}</CodeBlock>
        <p>它记录了发生了什么、谁报告的、哪次构建受到影响，以及对应哪个分析任务。字段需要入口代码填写；对象不会自行知道来源，也不会自行找到所属任务。</p>
        <p>Agent 的运行情况也能用事件表达：准备调用日志工具时产生 <code>tool.started</code>，工具返回后产生 <code>tool.finished</code>。但<strong>构造对象只产生了数据，还没有让任何处理函数执行</strong>。</p>

        <h2 id="dispatch">2. 订阅之后，谁真正调用监听器？</h2>
        <p>应用需要先保存“事件类型与处理函数之间的对应关系”。下面的 <code>EventBus</code> 用一个 <code>Map</code> 保存它：</p>
        <CodeBlock>{`class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(event) {
    for (const fn of this.listeners.get(event.type) ?? []) {
      fn(event);
    }
  }
}`}</CodeBlock>
        <p><code>on</code> 只把函数保存进 <code>listeners</code>，此时不会执行。业务代码调用 <code>emit(event)</code> 后，<code>emit</code> 读取 <code>event.type</code>、查表、再执行 <code>fn(event)</code>。</p>
        <p className={styles.takeaway}><strong>“事件触发了回调”展开之后，就是：生产代码调用分发入口 → 分发器查表 → 分发器调用已注册函数。</strong>事件对象是数据，不是会自己执行的函数。</p>
        <pre className={styles.flowBlock}>{`emit(event)
  → 读取 event.type
  → 从 listeners 找到函数
  → 执行 fn(event)`}</pre>

        <h2 id="directions">3. Agent 与外部世界，事件方向相反</h2>
        <p>第一条方向是 Agent 报告自己的运行进展：</p>
        <pre className={styles.flowBlock}>{`Agent 执行程序
  → 构造 tool.started
  → bus.emit(event)
  → 分发器调用界面 / 日志监听器
  → 显示“正在读取日志”

方向：Agent → 观察者`}</pre>
        <p>第二条方向是外部告警进入 Agent：</p>
        <pre className={styles.flowBlock}>{`构建系统报告失败
  → 应用 HTTP 入口
  → 校验、关联任务、构造 build.failed
  → 分发器调用告警监听器
  → inbox 保存告警
  → Agent 取出并加入历史
  → 下一次决策读取告警

方向：外部事件 → 应用入口 → Agent`}</pre>
        <figure className={styles.diagram}>
          <img alt="事件驱动 Agent 的两条方向：Agent 运行事实发往观察者，外部事件经过应用入口进入 Agent" src="/assets/articles/event-driven-agent-directions.png" />
          <figcaption>图：左侧是 Agent 向观察者发送运行通知，右侧是外部输入经应用入口进入 Agent；两者必须落到明确的调用和数据边界。</figcaption>
        </figure>
        <p>因此，<code>subscribe</code> Agent 运行事件并不等于 Agent 已经订阅了 Webhook。前者是外部代码观察 Agent；后者需要应用入口接收外部事件，再决定如何把它接回 Agent。</p>
        <CodeBlock>{`const inbox = [];

bus.on("tool.started", event => {
  console.log("界面：开始", event.tool);
});

bus.on("build.failed", event => {
  inbox.push(event);
  console.log("应用：告警已入队");
});

function onBuildWebhook(body) {
  bus.emit({
    type: "build.failed",
    source: "build-system",
    taskId: "analysis-1",
    buildId: body.buildId,
    content: body.message
  });
}`}</CodeBlock>

        <h2 id="agent-loop">4. 告警在哪一行进入 Agent 的分析？</h2>
        <p>本例选择一个处理边界：先等日志工具返回，再把积累的告警加入历史，然后进行下一次决策。队列本身没有调用模型，Agent 循环必须明确取走它：</p>
        <CodeBlock>{`async function runAgent() {
  const history = [{ kind: "task", content: "分析部署日志" }];

  while (true) {
    const batch = inbox.splice(0);      // ① 取出事件
    history.push(...batch.map(event => ({
      kind: "external_event", event
    })));                                // ② 加入历史

    const decision = fakeModel(history); // ③ 下一次决策
    if (decision.answer) return decision.answer;

    bus.emit({ type: "tool.started", tool: decision.tool });
    const result = await readLogs();
    history.push({ kind: "tool_result", content: result });
    bus.emit({ type: "tool.finished", tool: decision.tool });
  }
}`}</CodeBlock>
        <p><strong>进入队列、加入历史、被下一次决策读取，是三个不同的时刻。</strong>只把信息打印出来，模型不会知道；只修改本地历史，但不把它放入后续请求，也不会改变已经发送出去的请求。</p>
        <p>如果 Agent 已经结束，<code>inbox.push(event)</code> 仍然不够。应用还需要明确启动新的运行，或者通知一个正在等待输入的长期循环继续处理。“唤醒 Agent”必须落实成这样的调用或通知机制。</p>

        <h2 id="contrast">5. 拿掉一条连接，看看哪些行为会消失</h2>
        <p>把告警监听器改成只打印，不再执行 <code>inbox.push(event)</code>：</p>
        <CodeBlock>{`bus.on("build.failed", event => {
  console.log("收到告警：", event.content);
  // 没有 inbox.push(event)
});`}</CodeBlock>
        <p>入口仍被调用，事件对象仍被构造，<code>emit</code> 仍找到监听器，控制台也能显示告警；但下一次 Agent 决策的历史里没有告警。监听器执行，只能证明分发链走到了监听器，不能证明事件影响了 Agent。</p>
        <p>反过来，移除 <code>tool.started</code> 的界面监听器，Agent 仍会调用 <code>readLogs()</code>，只是进度不再显示。运行通知和 Agent 的实际决策是两条不同连接。</p>

        <h2 id="timing">6. 事件驱动、await、事件循环和队列各管什么？</h2>
        <table><thead><tr><th>概念</th><th>本例中的位置</th><th>它回答的问题</th></tr></thead><tbody>
          <tr><td>事件对象</td><td><code>build.failed</code>、<code>tool.started</code></td><td>发生了什么，需要传递哪些信息？</td></tr>
          <tr><td>事件驱动</td><td>根据事件类型分发到处理函数</td><td>哪个事实到达后，要安排哪些响应？</td></tr>
          <tr><td>队列</td><td><code>inbox</code> 保存告警</td><td>当前不能处理的信息先放在哪里？</td></tr>
          <tr><td>异步 <code>await</code></td><td>等待日志结果后从原位置继续</td><td>结果没准备好时，这段函数如何等待？</td></tr>
          <tr><td>JavaScript 事件循环</td><td>运行时安排回调和 Promise 后续执行</td><td>让出执行机会后，哪些代码何时继续？</td></tr>
          <tr><td>Agent 循环</td><td>取输入、决策、工具、结果、下一轮</td><td>Agent 的工作怎样推进？</td></tr>
        </tbody></table>
        <p>这些机制可以组合，但不能互相替代。本文的 <code>emit</code> 直接执行 <code>fn(event)</code>，所以是同步分发；事件驱动并不自动等于异步。</p>
        <p>给监听器加上 <code>async</code> 也不会让它自动跑到后台线程。当前分发器若写的是 <code>fn(event)</code>，就不会等待它返回的 Promise；若写成 <code>await fn(event)</code>，等待关系才改变。是否异步、是否排队、是否并行，都要看具体实现。</p>
        <p><code>await readLogs()</code> 负责当前异步函数的等待与恢复，不负责创建事件、保存订阅关系或把告警加入历史。JavaScript 事件循环负责运行时调度，而 <code>runAgent</code> 的 <code>while</code> 才是应用自己定义的工作流程。</p>

        <h2>回到那条构建失败告警</h2>
        <p>应用入口把通知字段整理成事件对象，显式调用 <code>emit</code>；分发器查找订阅关系，调用告警监听器；监听器把告警放进队列。日志工具返回后，Agent 在下一次决策前取出告警，加入历史，再把更新后的信息交给决策步骤。</p>
        <p>与此同时，Agent 在工具开始、工具完成和分析结束的位置发布运行事件，界面监听器据此更新进度。这是 Agent 向观察者报告进展的另一条路径。</p>
        <p className={styles.closing}><strong>所谓事件驱动的 Agent，就在这些可追踪的连接中运行：</strong>有人记录发生的事，有人保存接收关系，有人显式分发，有人接住信息，而 Agent 的执行程序在明确的位置把它纳入下一步判断。</p>
      </div>
      <ArticleToc activeId={activeId} />
    </div>
  </article>;
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";

import styles from "./EventDrivenArticle.module.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);

const sections = [
  { id: "scene", label: "subscribe 只是登记" },
  { id: "chain", label: "prompt 怎样走到 listener" },
  { id: "event", label: "text_delta 怎样变成 message_update" },
  { id: "boundary", label: "事件、异步和事件循环" },
  { id: "direction", label: "两个方向的事件" },
  { id: "architecture", label: "回到开头：驱动在哪里" },
];

function SourceLink({ href, children }) {
  return <a href={href} rel="noreferrer" target="_blank">{children}</a>;
}

function CodeBlock({ children, language = "javascript" }) {
  const code = String(children).replace(/^\n/, "").replace(/\n\s*$/, "");
  const highlighted = language === "text"
    ? code
    : hljs.highlight(code, { language }).value;

  return (
    <pre className={styles.codeBlock} data-language={language}>
      <code dangerouslySetInnerHTML={{ __html: highlighted }} />
    </pre>
  );
}

function TocLinks({ activeId }) {
  return (
    <ul className={styles.tocList}>
      {sections.map((section, index) => (
        <li key={section.id}>
          <a
            aria-current={activeId === section.id ? "location" : undefined}
            className={activeId === section.id ? styles.tocActive : undefined}
            href={`#${section.id}`}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {section.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function ArticleToc({ activeId }) {
  return (
    <>
      <aside className={styles.toc} aria-label="文章目录">
        <p className={styles.tocLabel}>ON THIS PAGE</p>
        <TocLinks activeId={activeId} />
      </aside>
      <details className={styles.mobileToc}>
        <summary>本页目录</summary>
        <nav aria-label="本页目录"><TocLinks activeId={activeId} /></nav>
      </details>
    </>
  );
}

function Diagram({ alt, caption, src }) {
  return <figure className={styles.diagram}><img alt={alt} src={src} /><figcaption>{caption}</figcaption></figure>;
}

export function EventDrivenArticle() {
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    const headings = sections.map(({ id }) => document.getElementById(id)).filter(Boolean);
    if (!headings.length) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-112px 0px -62% 0px", threshold: [0, 1] });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, []);

  return (
    <article className={styles.articleShell}>
      <Link className={styles.backLink} href="/articles">← 返回文章列表</Link>
      <Link className={styles.mapLink} href="/articles/knowledge-map">查看这篇文章在知识地图中的位置 →</Link>

      <header className={styles.articleHeader}>
        <p className={styles.kicker}>学习文章 · 事件驱动</p>
        <h1>订阅之后，回调为什么没有立即执行？从一次 Agent 输出看懂事件驱动</h1>
        <p className={styles.lead}>
          事件驱动不是程序自己会动，而是先保存处理函数，运行过程显式发出事件，再由分发代码调用保存下来的函数。沿着 Pi 0.85.1 的一次 Agent 输出，这条链路可以逐步追踪。
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-21">2026-09-21</time>
          <span>阅读约 8 分钟</span>
          <span>基于 Pi 0.85.1 实现观察</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            调用 <code>agent.subscribe(listener)</code> 后，终端没有输出；直到执行 <code>agent.prompt(...)</code>，收到 <code>message_update</code> 事件，回调里的打印代码才开始运行。真正需要解释的是中间三步：谁保存回调，谁发出事件，谁最终调用回调。
          </p>

          <h2 id="scene">subscribe 做的是登记，函数体还没有执行</h2>
          <p>在已经核对的 Pi 0.85.1 实现中，<code>Agent.subscribe</code> 把传入的 <code>listener</code> 保存到一个 <code>Set</code>。可以用下面的简化代码理解它：</p>
          <CodeBlock>{String.raw`const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
}

subscribe(async (event, signal) => {
  console.log(event);
});`}</CodeBlock>
          <p>
            执行 <code>subscribe(...)</code> 时，调用的是登记函数。箭头函数被创建，并作为一个函数值传进去；<code>listeners.add(listener)</code> 保存的是这个函数的引用，并没有执行它的函数体。只有后续代码执行 <code>listener(event, signal)</code>，里面的 <code>console.log</code> 才会运行。
          </p>
          <p>
            订阅完成只能说明“以后分发事件时，可以找到这个函数”。如果后面没有事件被发出并送入分发流程，回调就不会因为时间过去、状态改变或者订阅成功而自动执行。登记监听器和重放历史，也是两项需要分别实现的行为。
          </p>

          <h2 id="chain">prompt 怎样走到 listener</h2>
          <p>
            <code>prompt</code> 启动了一次实际的 Agent 运行。<code>runPromptMessages</code> 会把 <code>event =&gt; this.processEvents(event)</code> 作为 <code>emit</code> 传给 <code>runAgentLoop</code>：循环决定何时产生事件，Agent 负责接收事件、更新状态并通知订阅者。
          </p>
          <CodeBlock>{String.raw`// Agent.runPromptMessages：把事件接收函数交给循环。
await runAgentLoop(
  prompts,
  context,
  config,
  (event) => this.processEvents(event),
  signal,
  streamFn,
);

// runAgentLoop：在相应位置显式发出事件。
await emit(lifecycleEvent);

// processEvents：先更新状态，再通知订阅者。
updateState(event);
for (const listener of listeners) {
  await listener(event, signal);
}`}</CodeBlock>
          <p>
            这里的 <code>emit</code> 首先只是一个普通函数参数。执行 <code>await emit(event)</code>，会进入传入的箭头函数，再调用 <code>this.processEvents(event)</code>；随后，<code>processEvents</code> 先根据事件更新 Agent 的 <code>state</code>，再按订阅顺序逐个执行并等待 <code>listener(event, signal)</code>。
          </p>
          <p className={styles.takeaway}>
            <strong>更新状态和调用回调，是 processEvents 中依次执行的两个动作。</strong>回调不是看到状态变化后自己醒来；没有继续调用分发代码，就不会仅凭“发生了变化”触发监听器。
          </p>

          <h2 id="event">text_delta 为什么会变成 message_update</h2>
          <p>
            模型生成文本时，底层 <code>pi-ai</code> 会提供 <code>text_delta</code>，表示本次新产生的一小段文本。Agent 循环收到这种流式更新后，将它包装为 <code>message_update</code> 事件，再通过上面的 <code>emit</code> 路径向外发送。
          </p>
          <p>
            外层 <code>message_update</code> 表示“一条消息正在更新”；内部的 <code>text_delta</code> 表示“这次更新具体是新增文本”。当前最小项目的 <code>index.ts</code> 会检查这两层类型，条件满足后才输出 <code>delta</code>：
          </p>
          <CodeBlock>{String.raw`agent.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("解释一下事件驱动。");`}</CodeBlock>
          <p>
            从提示词到终端文字，实际经过了明确的调用链：<code>prompt</code> 启动运行，底层产生文本增量，循环包装事件并调用 <code>emit</code>，<code>processEvents</code> 更新状态并分发，最后由订阅回调输出文本。看不到文字，不能直接推断回调从未运行，因为其他生命周期事件也可能进入回调，只是没有通过这里的过滤条件。
          </p>

          <h2 id="boundary">事件、回调、分发和事件循环不是同一个东西</h2>
          <table>
            <thead><tr><th>概念</th><th>在这条链路中的含义</th><th>决定了什么</th></tr></thead>
            <tbody>
              <tr><td>事件对象</td><td>带有 <code>type</code>、文本增量等字段的数据</td><td>这次发生了什么</td></tr>
              <tr><td>回调</td><td>订阅时保存的 <code>listener</code> 函数</td><td>收到通知后做什么</td></tr>
              <tr><td>分发</td><td>遍历 <code>Set</code> 并调用监听器</td><td>通知谁、按什么顺序通知</td></tr>
              <tr><td>异步控制流</td><td><code>await emit</code>、<code>await listener</code></td><td>当前流程等待哪项工作完成</td></tr>
              <tr><td>Node.js 事件循环</td><td>运行时调度异步任务的机制</td><td>异步任务何时获得继续执行机会</td></tr>
            </tbody>
          </table>
          <p>
            事件对象是数据，本身不会执行代码；回调是函数，但被保存不等于被调用；分发才是具体的程序逻辑：取出函数，传入事件，执行它。Node.js 事件循环位于更底层，参与网络 I/O、定时器等异步工作的调度，但它不知道 Agent 的 <code>listeners</code> 集合应该通知谁。回答“这个回调为什么此刻运行”，仍然要回到应用代码，找到实际执行的那一行 <code>listener(event, signal)</code>。
          </p>
          <p>
            <code>await</code> 也不意味着“另开一个线程去通知”。由于这里逐个 <code>await listener(...)</code>，后一个监听器要等前一个完成后才会被调用；较慢的监听器会延迟此次分发完成，以及等待它的上游流程继续推进。这是 Pi 当前实现的分发策略，不是所有事件系统的共同规则。Node.js 的 <SourceLink href="https://nodejs.org/api/events.html#asynchronous-vs-synchronous">EventEmitter 文档</SourceLink>也说明，监听器默认按注册顺序同步调用。
          </p>

          <h2 id="direction">Agent 发出事件，与事件触发 Agent，是两个方向</h2>
          <p>
            当前例子的方向是：<strong>Agent → 外部观察者</strong>。Agent 运行时发出消息更新，应用层订阅这些更新，用来打印文字、刷新界面或记录运行过程。订阅者是在观察一次已经启动的运行。
          </p>
          <Diagram
            alt="事件驱动的两个方向：外部事件经应用层启动 Agent，Agent 再向外部观察者发送运行事件"
            caption="图：上方是 Agent 向外通知运行事件，下方是外部输入先到应用层，再由应用层决定是否调用 Agent。"
            src="/assets/articles/event-driven-directions.png"
          />
          <p>
            另一个方向是：<strong>外部事件 → 应用层 → Agent</strong>。例如用户点击发送按钮，应用层的按钮处理函数读取输入，再调用 <code>agent.prompt(...)</code>。按钮事件触发的是应用层逻辑，由应用层决定是否启动 Agent、传入什么内容。订阅 Agent 的消息更新，并没有定义按钮点击后该怎样调用 Agent；调用 <code>prompt</code>，也没有规定消息到来时界面应该怎样显示。
          </p>

          <h2 id="architecture">回到开头：事件驱动的“驱动”在哪里</h2>
          <p>
            在这个最小 Agent 里，<code>runAgentLoop</code> 知道运行到了哪里，<code>processEvents</code> 维护状态并通知观察者，<code>index.ts</code> 决定如何展示文本。事件驱动不是程序自己会动，也不等于用了异步 API，而是控制流从“我现在直接调用谁”变成了“我先登记谁对什么事实感兴趣，事实发生后由分发者调用谁”。
          </p>
          <p className={styles.closing}>
            <strong>所以，subscribe 后没有立即输出是正常的：</strong>它只登记了函数。直到 <code>prompt</code> 启动循环，循环产生 <code>message_update</code>，<code>emit</code> 把事件交给 <code>processEvents</code>，后者才调用 <code>listener</code>；如果 listener 过滤到 <code>text_delta</code>，终端才会出现文字。沿着“谁产生、谁传递、谁处理、何时处理”走完整条链路，事件驱动就从一个架构口号变成了可以追踪的执行过程。
          </p>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

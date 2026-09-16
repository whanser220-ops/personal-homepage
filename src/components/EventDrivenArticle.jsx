"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./EventDrivenArticle.module.css";

const sections = [
  { id: "scene", label: "从 Pi 的一行代码开始" },
  { id: "event", label: "事件是数据，不是函数" },
  { id: "chain", label: "事件到底怎样触发回调" },
  { id: "boundary", label: "事件驱动不等于异步" },
  { id: "architecture", label: "从回调 API 到系统架构" },
  { id: "reliability", label: "跨进程后，可靠性才出现" },
  { id: "decision", label: "什么时候值得使用" },
];

function SourceLink({ href, children }) {
  return <a href={href} rel="noreferrer" target="_blank">{children}</a>;
}

function CodeBlock({ children }) {
  return <pre className={styles.codeBlock}><code>{children}</code></pre>;
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

      <header className={styles.articleHeader}>
        <p className={styles.kicker}>学习文章 · 事件驱动</p>
        <h1>事件驱动：从 Pi Agent 的回调链路看懂“谁在什么时候调用谁”</h1>
        <p className={styles.lead}>
          事件驱动不是“程序自己会动”，而是先把发生的事情变成数据，再由分发者找到已经登记的处理函数。沿着一个最小 Pi Agent 的真实运行链路，这个抽象会变得可以逐步追踪。
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-17">2026-09-17</time>
          <span>阅读约 10 分钟</span>
          <span>基于 Pi 0.85.1 实现观察</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            你在最小 Agent 里可能写过这样的代码：先订阅事件，再调用 <code>prompt</code>。真正难懂的地方不在语法，而在中间那段没有写在你眼前的控制流：谁创建了事件？谁把它送到监听器？监听器为什么是在那个时刻运行？
          </p>

          <h2 id="scene">从 Pi 的一行代码开始</h2>
          <p>当前学习项目里的核心关系可以缩成两行。第一行登记一个观察者，第二行启动一轮 Agent 工作：</p>
          <CodeBlock>{`const unsubscribe = agent.subscribe((event) => {
  if (event.type === "message_update") {
    render(event.assistantMessageEvent);
  }
});

await agent.prompt("用一句话介绍你自己。");`}</CodeBlock>
          <p>
            调用 <code>subscribe</code> 时，模型还没有开始回答，<code>render</code> 也不会被调用。它只保存了一条关系：“以后有事件到达时，把它交给这个函数”。直到 <code>prompt</code> 启动 Agent 循环，系统才会陆续产生 <code>agent_start</code>、<code>message_start</code>、<code>message_update</code> 和 <code>agent_end</code> 等事件。
          </p>
          <Diagram
            alt="Pi Agent 事件链路：prompt 启动 Agent 循环，模型流产生 text_delta，核心包装成 message_update，再由 Agent 分发给 listener"
            caption="图 1：事件对象不会自行触发函数；生产者显式发出事件，分发器才调用已登记的 listener。"
            src="/assets/articles/event-driven-pi-flow.svg"
          />
          <p className={styles.takeaway}>
            先记住这条主线：<strong>登记关系 → 业务开始 → 创建事件 → 分发事件 → 调用回调</strong>。事件驱动的“驱动”，就发生在分发者调用回调的那一刻。
          </p>

          <h2 id="event">事件是数据，不是函数</h2>
          <p>一个事件首先是对“某件事发生了”的描述。例如 Pi 的事件可以是一个带类型的数据对象：</p>
          <CodeBlock>{`{
  "type": "message_update",
  "assistantMessageEvent": {
    "type": "text_delta",
    "delta": "你好"
  }
}`}</CodeBlock>
          <p>
            这个对象不会因为 <code>type</code> 写成 <code>message_update</code> 就自动寻找代码。它只是信封里的内容。真正让流程继续的是某个生产者显式执行了 <code>emit(event)</code>、<code>push(event)</code> 或等价操作；分发器收到它之后，才会把对象作为参数交给处理函数。
          </p>
          <table>
            <thead><tr><th>消息形态</th><th>它在表达什么</th><th>谁通常决定下一步</th></tr></thead>
            <tbody>
              <tr><td>命令 command</td><td>请某个对象执行动作</td><td>明确的接收者</td></tr>
              <tr><td>事件 event</td><td>某个事实已经发生</td><td>对事实感兴趣的消费者</td></tr>
              <tr><td>查询 query</td><td>读取当前状态</td><td>查询处理者</td></tr>
            </tbody>
          </table>
          <p>
            这一区分很实用：如果发布者其实在要求消费者“必须做某件事并返回结果”，那更像命令，不应只因为用了消息通道就改名为事件。Martin Fowler 对事件通知、命令式消息和事件溯源的边界也做了类似区分，见 <SourceLink href="https://martinfowler.com/articles/201701-event-driven.html">What do you mean by “Event-Driven”?</SourceLink>。
          </p>

          <h2 id="chain">事件到底怎样触发回调</h2>
          <p>把事件系统压缩成最小实现，三个动作就足够了。订阅保存函数，发布查找函数，最后由分发器直接调用它：</p>
          <CodeBlock>{`class EventSource {
  listeners = new Set();

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) {
      listener(event); // 这里才真正触发回调
    }
  }
}`}</CodeBlock>
          <p>
            在本机的 Pi 0.85.1 实现里，<code>Agent.subscribe</code> 保存 listener，内部的 <code>_emit</code> 遍历 listeners 并调用它们。Agent loop 会主动发出生命周期事件；模型供应商返回一段文字增量后，核心把它包装成 <code>message_update</code>，再沿同一条分发路径送到你的 listener。也就是说，<code>text_delta</code> 是模型流中的细粒度事件，<code>message_update</code> 是 Agent 对外暴露的更高一层事件。
          </p>
          <p>因此可以把这段运行过程逐步读成：</p>
          <ol>
            <li><code>subscribe</code> 把回调函数放进监听器集合。</li>
            <li><code>prompt</code> 启动 Agent loop，并把用户输入加入上下文。</li>
            <li>Agent loop 发出开始事件；模型流返回 <code>text_delta</code>。</li>
            <li>核心把增量更新包装成 <code>message_update</code>，再执行 <code>_emit(event)</code>。</li>
            <li>你的 listener 收到事件，累加文字、显示界面或记录错误。</li>
          </ol>
          <p>
            这就是“控制反转”的具体含义。普通调用是当前代码写出 <code>target()</code>；事件回调是当前代码先登记 <code>listener</code>，未来由事件源在条件满足时调用它。注册并不等于执行，类型名也不等于触发器。
          </p>

          <h2 id="boundary">事件驱动不等于异步</h2>
          <p>
            这三个词经常同时出现，却回答不同问题：事件驱动问“谁决定调用谁”；异步问“当前函数是否把等待交给 Promise 或其他调度机制”；事件循环问“运行时何时从队列中取出下一项工作”。
          </p>
          <p>事件可以同步分发。Node.js 的 <SourceLink href="https://nodejs.org/api/events.html#asynchronous-vs-synchronous">EventEmitter 文档</SourceLink>明确说明，<code>emit</code> 会按注册顺序同步调用监听器：</p>
          <CodeBlock>{`emitter.on("paid", () => console.log("handler"));
emitter.emit("paid");
console.log("after");

// handler
// after`}</CodeBlock>
          <p>
            Pi 的 <code>await agent.prompt(...)</code> 也不能单独证明它是“异步事件架构”。它表示调用者等待这一轮 Agent 工作完成；在等待期间，Agent 内部仍可产生事件并调用 listener。回调是在什么时刻、由哪个对象调用，和外层是否等待一个 Promise，是两条不同的轴。
          </p>
          <table>
            <thead><tr><th>问题</th><th>它区分的概念</th><th>可能的答案</th></tr></thead>
            <tbody>
              <tr><td>谁调用处理函数？</td><td>事件机制</td><td>EventEmitter、Agent、消息 broker</td></tr>
              <tr><td>现在调用还是以后调用？</td><td>调度时机</td><td>同步栈、定时器、队列</td></tr>
              <tr><td>调用者是否等待结果？</td><td>异步控制流</td><td>直接返回、Promise、轮询</td></tr>
              <tr><td>跨不跨进程？</td><td>系统边界</td><td>同一对象、网络消息、持久化日志</td></tr>
            </tbody>
          </table>

          <h2 id="architecture">从回调 API 到系统架构</h2>
          <p>
            一个对象有 <code>subscribe</code> 方法，只能说明它提供了事件通知接口；还不能说明整个业务采用了事件驱动架构。Pi 的例子主要是在告诉外部观察者“Agent 运行到哪里了”，Agent loop 仍然拥有本轮工作的控制权。
          </p>
          <Diagram
            alt="事件驱动系统架构：生产者发布事实，事件通道转发，多个消费者分别处理通知、统计和索引"
            caption="图 2：系统级事件驱动把生产者与多个消费者隔开，但事件契约和失败处理仍然存在。"
            src="/assets/articles/event-driven-system-boundary.svg"
          />
          <p>
            到了业务架构层，通常要明确三个角色：生产者产生事实，事件通道负责传递，消费者只处理自己关心的类型。生产者不需要知道“通知服务”和“统计服务”的函数名；新增消费者也不必修改生产者。这是解耦发生的地方。
          </p>
          <p>
            但解耦的是直接连接，不是语义契约。生产者和消费者仍然要共同理解事件类型、字段、版本和关联 ID。Microsoft 的 <SourceLink href="https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven">事件驱动架构说明</SourceLink>也把生产者、事件通道和消费者列为基本组成，并同时提醒最终一致性、顺序、重复交付和 schema 演进的成本。
          </p>

          <h2 id="reliability">跨进程后，可靠性才出现</h2>
          <p>
            进程内的 <code>emit</code> 通常只是一次内存调用；跨进程后，事件还要经过网络、broker、消费者进程和各自的存储。此时“事件已经发布”不等于“所有消费者已经成功处理”。
          </p>
          <p>
            最容易出问题的是双写：业务状态已经提交，但发布事件前进程崩溃；或者事件先发出，业务事务随后回滚。常见的 transactional outbox 做法是把“业务状态更新”和“待发送事件”写进同一个数据库事务，再由 relay 转发 outbox 记录。AWS 的 <SourceLink href="https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html">Transactional outbox pattern</SourceLink>同时强调，转发可能重试，因此消费者必须按事件 ID 做幂等处理。
          </p>
          <div className={styles.flow}>
            <span>本地事务</span><b>更新状态 + 写 outbox</b><span>relay</span><b>发布事件</b><span>消费者</span><b>幂等处理</b>
          </div>
          <p>
            这也是为什么系统级事件驱动不是“把函数包进消息就结束”：你还必须能回答丢失、重复、乱序、积压、失败重试和观测如何处理。若这些问题还没有业务答案，直接调用往往更诚实、更容易验证。
          </p>

          <h2 id="decision">什么时候值得使用</h2>
          <p>判断一个边界是否适合事件驱动，可以先问三件事：</p>
          <ol>
            <li>这是一个已经发生的事实，还是必须由接收者完成的命令？</li>
            <li>后续处理是否允许延迟、重复或最终一致？</li>
            <li>除了当前调用者，未来是否还会有多个独立消费者？</li>
          </ol>
          <p>
            如果答案是“事实、允许解耦、多个消费者”，事件通知通常有价值；例如 Agent 把流式更新交给多个界面观察者，或业务状态变化后分别触发通知和统计。如果调用者必须立即知道一个不可分割的结果，直接调用或显式命令更清楚。实际系统往往混合两者：核心决策同步完成，事务提交后再发布非核心反应。
          </p>
          <p className={styles.closing}>
            <strong>回到开头：</strong>事件驱动的核心不是“用了异步 API”，而是控制流从“我现在直接调用谁”变成了“我先登记谁对什么事实感兴趣，事实发生后由分发者调用谁”。只要能沿着“谁产生、谁传递、谁处理、何时处理”走完整条链路，事件驱动就不再是一个模糊的架构口号。
          </p>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

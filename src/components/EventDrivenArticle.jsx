"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";

import styles from "./EventDrivenArticle.module.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);

const sections = [
  { id: "problem", label: "总控直接调用哪里会变难" },
  { id: "fact", label: "先确认发生了什么" },
  { id: "dispatch", label: "谁真正调用函数" },
  { id: "timing", label: "事件不等于异步" },
  { id: "boundary", label: "提案、命令与事实" },
  { id: "pi", label: "最后映射回 Pi" },
];

function SourceLink({ href, children }) {
  return <a href={href} rel="noreferrer" target="_blank">{children}</a>;
}

function CodeBlock({ children, language = "javascript" }) {
  const code = String(children).replace(/^\n/, "").replace(/\n\s*$/, "");
  const highlighted = hljs.highlight(code, { language }).value;
  return <pre className={styles.codeBlock} data-language={language}><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>;
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

function Diagram({ alt, caption, src }) {
  return <figure className={styles.diagram}><img alt={alt} src={src} /><figcaption>{caption}</figcaption></figure>;
}

export function EventDrivenArticle() {
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    const headings = sections.map(({ id }) => document.getElementById(id)).filter(Boolean);
    if (!headings.length) return undefined;
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
      <p className={styles.kicker}>学习文章 · 事件驱动</p>
      <h1>事件驱动：剧情发生变化后，该由谁安排接下来的反应？</h1>
      <p className={styles.lead}>当总控确认一件剧情事实后，界面、日志、线索索引和时间轴都要更新。为什么新增一个模块，总控就要再改一次？从“林遥发现纸条”开始，先解释这个问题，再看事件如何被登记、发布、分发和处理，最后映射回 Pi Agent。</p>
      <div className={styles.meta}><time dateTime="2026-09-21">2026-09-21</time><span>阅读约 9 分钟</span><span>问题导向重写 · Pi 0.85.1 映射</span></div>
    </header>
    <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>
    <div className={styles.articleLayout}>
      <div className={styles.articleBody}>
        <p>你正在做一个剧情 Agent 应用：剧情总控组织场景，人物 Agent 根据各自知道的信息提出台词和行动，总控决定哪些提案进入故事，并生成正文。现在，林遥在书房发现一张纸条。总控确认这件事进入剧情后，要更新阅读界面、记录剧情日志、把纸条加入线索索引。后来你又想增加时间轴展示。</p>
        <p className={styles.takeaway}><strong>问题是：能不能让总控专心确认剧情变化，让其他模块自己声明如何反应？</strong></p>

        <h2 id="problem">1. 总控直接调用所有模块，哪里会变难？</h2>
        <p>最初的实现很自然：总控确认发现纸条，接着调用界面更新、日志记录和线索索引函数。每一步写在一个地方，排查起来很容易。</p>
        <p>变化发生在需求增加时。新增时间轴要改总控，替换界面要检查总控，增加另一种剧情观察功能还是要回到总控。决定剧情的规则没有变，它却承担了越来越多外围模块的连接工作。</p>
        <p>直接调用本身很有用，尤其适合明确的步骤依赖。这里需要改变的是：<strong>确认一件事发生的代码，是否必须同时知道所有对它感兴趣的模块？</strong>事件驱动提供另一种安排：总控确认事实，其他模块把自己的反应登记到事实上。</p>

        <h2 id="fact">2. 先确认发生了什么，再决定谁来反应</h2>
        <p>总控确认剧情变化并写入状态后，可以产生一份数据：</p>
        <CodeBlock>{String.raw`const event = {
  type: "StoryFactCommitted",
  eventId: "event-17",
  sceneId: "study-1",
  fact: "林遥在书房发现纸条",
  visibleTo: ["林遥"],
};`}</CodeBlock>
        <p>这个事件描述的是一件已经被应用接受、写入剧情状态的事实。它没有宣称纸条上的约定一定真实，也没有宣称其他人物已经知道内容。人物 Agent 提议“让林遥发现纸条”，与总控确认“林遥已经发现纸条”处在不同阶段；模型生成的一句话不会自动成为世界事实。</p>
        <p>于是角色变得清楚：总控是事实生产者，事件通道负责传递，界面、日志和线索索引是消费者。消费者可以各自订阅 <code>StoryFactCommitted</code>，按自己的规则处理，不需要事件数据告诉它们“必须按某个顺序做什么”。生产者—通道—消费者的划分可与 <SourceLink href="https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/event-driven">Microsoft 的事件驱动架构说明</SourceLink>对照。</p>
        <p>信息边界仍由输入构造决定。林遥可以获得她观察到的纸条，场外人物不能因为应用发布了事件就自动获得秘密。订阅关系负责通知谁，不负责替你筛选谁有权知道。</p>

        <h2 id="dispatch">3. 订阅以后，到底是谁把函数叫起来？</h2>
        <p>初始化时，通道保存一张关系表：</p>
        <table><thead><tr><th>事实类型</th><th>已登记的处理函数</th></tr></thead><tbody><tr><td><code>StoryFactCommitted</code></td><td>更新界面、记录日志、更新线索索引</td></tr></tbody></table>
        <p>此时没有新剧情发生，三个函数也没有执行。表里保存的是“之后要调用的函数”。总控发布事件后，通道读取事件类型，查表取得函数，再把事件交给它们；这个动作叫分发。</p>
        <p className={styles.takeaway}><strong>处理函数开始运行有一个具体原因：分发代码执行了 <code>handler(event)</code>。</strong>事件数据提供信息，订阅关系提供函数，分发器完成调用；事件对象不会自己触发代码。</p>
        <CodeBlock>{String.raw`const subscriptions = new Map();

function subscribe(type, handler) {
  const handlers = subscriptions.get(type) ?? [];
  handlers.push(handler);               // 保存函数，尚未调用
  subscriptions.set(type, handlers);
}

function publish(event) {
  const handlers = subscriptions.get(event.type) ?? [];
  for (const handler of handlers) {
    handler(event);                      // 这里才真正调用
  }
}`}</CodeBlock>
        <p><code>subscribe("StoryFactCommitted", recordLog)</code> 只是保存日志函数；<code>publish(event)</code> 才让分发器取得它并调用 <code>recordLog(event)</code>。只创建事件对象、没有发布，日志不会自动增加；删掉日志订阅，其他处理函数仍可运行。</p>
        <Diagram alt="剧情事实发生后总控直接调用与发布事件分发的对照：左侧总控直接调用界面、日志、线索索引；右侧先登记 StoryFactCommitted 处理函数，再由分发器调用三个消费者" caption="图：两种安排处理同一件已确认的剧情事实。虚线表示事先登记，实线表示本次执行；右侧也可以同步执行。" src="/assets/articles/event-driven-story-fact-vs-direct.png" />
        <p>增加时间轴时，直接调用要修改总控；发布事件则可以增加时间轴处理函数并登记订阅。在事件含义稳定的前提下，新增消费者不必让生产者认识它的函数名。控制流从“总控现在调用谁”变成“总控宣告发生了什么，再由关系表选择调用谁”。</p>

        <h2 id="timing">4. 换成事件，处理就自动异步了吗？</h2>
        <p>不一定。上面的 <code>publish</code> 在循环里直接调用函数，因此同步分发的顺序是：发布 → 界面更新返回 → 日志记录返回 → 线索索引返回 → 发布返回。某个处理函数慢，后面的函数就还没开始；它抛错而分发器没有捕获，后续处理也可能中断。</p>
        <p>真实的 <SourceLink href="https://nodejs.org/api/events.html#asynchronous-vs-synchronous">Node.js EventEmitter 文档</SourceLink>同样说明监听器默认按注册顺序同步调用。事件机制可以不借助队列。</p>
        <p>如果希望处理稍后发生、不拖住当前流程，就要改变传递方式：把事件交给消息系统或队列，消费者之后再取得并调用函数。此时“消息系统接收”不等于“所有消费者处理完成”。队列还带来投递失败、积压、重试和重复处理等新责任。</p>
        <table><thead><tr><th>概念</th><th>它回答的问题</th></tr></thead><tbody><tr><td>事件驱动</td><td>事实发生后，依据什么关系找到并调用处理者？</td></tr><tr><td>异步控制流</td><td>当前函数如何等待，后续工作何时继续？</td></tr><tr><td>事件循环</td><td>运行环境何时给待执行工作继续机会？</td></tr><tr><td>消息队列</td><td>消息如何留待消费者稍后取得和处理？</td></tr></tbody></table>
        <p>给监听器加上 <code>async</code> 也不会让它自动跑到后台线程；是否等待 Promise，取决于分发器写的是 <code>handler(event)</code> 还是 <code>await handler(event)</code>。这些概念可以同时出现，但不是同义词。</p>

        <h2 id="boundary">5. 人物提案、命令和已确认事实，能都用广播吗？</h2>
        <p>发现纸条后，总控还要决定下一段情节。假设它必须先得到林遥的反应，再决定是否安排她前往钟楼。这里总控是在请求一个人物 Agent 提出反应，并要检查结果是否符合人物认知和当前剧情。</p>
        <p>“请提出林遥发现纸条后的反应”是一个请求；“林遥决定烧掉纸条”在总控审核前只是提案；只有总控接受并更新状态后，才可以发布“纸条已被烧毁”这一事实。</p>
        <table><thead><tr><th>表达</th><th>它意味着什么</th><th>下一步</th></tr></thead><tbody><tr><td>请提出林遥的反应</td><td>请求一个指定对象完成生成</td><td>人物 Agent 返回提案，总控决定是否采用</td></tr><tr><td>林遥发现纸条已确认</td><td>事实已进入剧情状态</td><td>有权接收的模块据此更新自己的内容</td></tr></tbody></table>
        <p>这就是为什么应用会混用两种方式：总控明确安排必需的人物生成和结果审核；确认剧情事实后，再发布事件，让界面、日志、索引和时间轴各自反应。事件通知改变的是后续反应的连接，不会替总控完成需要结果的决策。</p>
        <p className={styles.closing}><strong>判断边界：</strong>必须取得接收者结果才能继续的动作，保留明确调用或命令；已经确认的事实，如果有多个独立模块各自反应，再考虑事件。是否使用事件，和是否把工作排到稍后，是两个决定。</p>

        <h2 id="pi">6. 最后映射回 Pi：subscribe 和 prompt 分别在哪一环？</h2>
        <p>现在再看熟悉的 Pi 操作：Agent 运行过程中产生消息更新，输出函数观察这些更新；外部代码调用 <code>prompt</code> 启动一轮工作。</p>
        <CodeBlock language="typescript">{String.raw`agent.subscribe((event) => {
  if (event.type === "message_update") {
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta") {
      process.stdout.write(update.delta);
    }
  }
});

await agent.prompt("让人物提出下一步反应。");`}</CodeBlock>
        <p><code>subscribe</code> 保存观察者，尚未启动模型；<code>prompt</code> 启动 Agent。运行代码取得文字增量，包装成 <code>message_update</code>，再由内部事件处理路径更新状态并调用监听器。这里的方向是 <strong>Agent → 外部观察者</strong>，不是 Agent 自动订阅 Webhook 或剧情事实。</p>
        <p>本机核对的 <code>@earendil-works/pi-agent-core</code> 0.85.1 中，必要链路可以压缩成：保存 listener → prompt 启动运行 → 产生并包装消息更新 → 分发器调用 listener。Pi 的事件通知说明运行进展，不会自动完成“调用人物、审核提案、更新剧情状态”的应用流程。</p>
        <p>回到开头：增加时间轴时，理想的修改位置是新增处理函数和订阅关系。总控仍负责确认剧情事实，人物 Agent 仍返回待审核的提案，分发器则负责把已确认的变化交给关心它的模块。事件驱动解决的，是这些职责怎样通过真实的调用连接起来。</p>
      </div>
      <ArticleToc activeId={activeId} />
    </div>
  </article>;
}

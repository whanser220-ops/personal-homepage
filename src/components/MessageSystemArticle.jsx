"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./EventDrivenArticle.module.css";

const sections = [
  { id: "input", label: "一条输入为什么会变成很多条消息" },
  { id: "formats", label: "消息不是只有一种格式" },
  { id: "conversion", label: "真正发给模型前，Pi 做一次翻译" },
  { id: "events", label: "消息和事件：一个是事实，一个是通知" },
  { id: "queues", label: "队列决定消息什么时候送达" },
  { id: "trace", label: "从输入到模型的完整追踪" },
  { id: "session", label: "会话保存的是历史，Agent 运行的是当前状态" },
  { id: "boundaries", label: "最后只记住四个边界" },
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

export function MessageSystemArticle() {
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
        <p className={styles.kicker}>学习文章 · 消息系统</p>
        <h1>消息系统：Pi Agent 怎样把“发生了什么”传给模型和界面</h1>
        <p className={styles.lead}>
          消息不是一串被动的文字，而是 Agent 在持续工作中留下的结构化事实。Pi 还把内部消息、发给模型的消息、运行时事件和排队输入分开，让每一种数据在自己的边界里发挥作用。
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-17">2026-09-17</time>
          <span>阅读约 12 分钟</span>
          <span>基于 Pi 0.85.1 实现观察</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            前一篇<a href="/articles/computer-state">“状态”</a>讨论了 Agent 如何记住可继续的事实；<a href="/articles/event-driven">“事件驱动”</a>讨论了运行时如何把变化通知给外部代码。本篇把两条线接起来：<strong>消息是 Agent 状态里可继续的记录，事件是这条记录正在变化时发出的通知。</strong>
          </p>
          <Diagram
            alt="Pi Agent 消息系统：从用户输入、Agent Loop、事件观察到模型调用，并展示 AgentMessage 到 Message 的转换边界"
            caption="图 1：Pi 把“内部如何完整记录”和“外部模型能接受什么”分成两层；事件在运行过程中观察消息变化，但不等于消息本身。"
            src="/assets/articles/pi-message-system.png"
          />
          <p className={styles.takeaway}>
            本文的实现依据是本机 <code>pi-minimal-agent</code> 锁定的 <code>@earendil-works/pi-agent-core@0.85.1</code>。Pi 的 SDK 和 Agent Core 会继续变化，示例中的 API 名称应以你正在使用的版本为准。
          </p>

          <h2 id="input">一条输入为什么会变成很多条消息</h2>
          <p>假设你输入：</p>
          <CodeBlock>{`帮我看看 auth.ts，告诉我它负责什么。`}</CodeBlock>
          <p>表面上这是一次问答，但 Agent 可能经历这样的过程：</p>
          <ol>
            <li>输入被包装成一条 <code>UserMessage</code>。</li>
            <li>模型返回一条包含 <code>ToolCall</code> 的 <code>AssistantMessage</code>。</li>
            <li>工具执行后产生一条 <code>ToolResultMessage</code>。</li>
            <li>Agent 把助手消息和工具结果一起交给下一轮模型请求。</li>
            <li>模型最后返回一条只含文本的 <code>AssistantMessage</code>。</li>
          </ol>
          <p>
            因此，<code>messages</code> 不是“用户和 AI 各说一句话”的字符串列表，而是<strong>一条持续工作在每个阶段留下的结构化记录</strong>。工具调用之所以能接回正确的结果，是因为 <code>ToolResultMessage.toolCallId</code> 会对应助手消息里的工具调用 ID。
          </p>
          <CodeBlock>{`UserMessage
  → AssistantMessage { toolCall: read(auth.ts) }
  → ToolResultMessage { toolCallId: 同一个 ID, 内容: 文件内容 }
  → AssistantMessage { text: 分析结果 }`}</CodeBlock>
          <p>这里先区分一个词：消息记录“谁在什么时候产生了什么内容”；调用模型、执行工具是动作。动作的结果可以再被记录成消息，但动作本身不等于消息。</p>

          <h2 id="formats">消息不是只有一种格式</h2>
          <p>模型 API 通常只需要三种标准角色：</p>
          <table>
            <thead><tr><th>标准消息</th><th>表达什么</th><th>关键内容</th></tr></thead>
            <tbody>
              <tr><td><code>UserMessage</code></td><td>用户或外部输入</td><td>文本、图片等内容块</td></tr>
              <tr><td><code>AssistantMessage</code></td><td>模型输出</td><td>文本、思考块、工具调用</td></tr>
              <tr><td><code>ToolResultMessage</code></td><td>工具执行结果</td><td>调用 ID、结果内容、错误标记</td></tr>
            </tbody>
          </table>
          <p>
            这三种是 LLM 边界上的 <code>Message</code>。但 Agent 内部还要服务界面、日志、会话恢复和应用扩展。例如 coding agent 可以记录一次 Bash 执行的命令、输出、退出码和是否被截断；这些字段对 UI 很有用，却不是模型 API 的标准角色。
          </p>
          <p>所以 Pi Core 使用更宽的 <code>AgentMessage</code>：</p>
          <CodeBlock>{`type AgentMessage =
  Message | CustomAgentMessages[keyof CustomAgentMessages];`}</CodeBlock>
          <p>
            在本机 0.85.1 的 Core 中，<code>CustomAgentMessages</code> 默认是扩展插槽。应用可以加入自己的消息类型，保留自己的结构化字段。于是内部的 <code>context.messages</code> 可以混合标准消息和应用自定义消息，这就是“内层丰富”。
          </p>

          <h2 id="conversion">真正发给模型前，Pi 做一次翻译</h2>
          <p>LLM 不认识所有 <code>AgentMessage</code>。因此每次请求模型前，Pi Core 都会经过两个边界：</p>
          <CodeBlock>{`AgentMessage[]
  → transformContext（可选：裁剪或注入，仍是 AgentMessage[]）
  → convertToLlm（必须：过滤或转换）
  → Message[]
  → streamFn / LLM`}</CodeBlock>
          <p>
            <code>transformContext</code> 处理“Agent 内部消息如何整理”，适合做上下文裁剪、注入外部上下文或其他仍然理解自定义消息的操作。<code>convertToLlm</code> 处理“模型最终能理解什么”，把消息变成 <code>user</code>、<code>assistant</code>、<code>toolResult</code> 三种标准形式；只用于 UI 的消息可以被过滤，自定义消息也可以被格式化成一段 <code>user</code> 文本。
          </p>
          <p>
            因此，<strong>保存下来的历史和本次真正发送的上下文不是同一个数组</strong>。历史要保留恢复所需的结构；发送时才根据当前模型、上下文窗口和应用规则选择、转换它们。
          </p>

          <h2 id="events">消息和事件：一个是事实，一个是通知</h2>
          <p>这是 Pi 消息系统里最容易混淆的两条线：</p>
          <table>
            <thead><tr><th>对象</th><th>回答的问题</th><th>是否是历史记录</th></tr></thead>
            <tbody>
              <tr><td><code>AgentMessage</code></td><td>当前工作留下了什么内容？</td><td>通常会进入 Agent 状态</td></tr>
              <tr><td><code>AgentEvent</code></td><td>这条内容现在发生到哪一步？</td><td>主要是运行时通知</td></tr>
              <tr><td><code>message_update</code></td><td>当前 assistant 消息又多了一段什么？</td><td>不是独立追加的一条消息</td></tr>
            </tbody>
          </table>
          <p>
            在本机 Core 的低层循环里，模型流开始时先把一个 partial assistant message 放进当前上下文；后续每个文本增量到达时，核心用新的 partial message 替换数组最后一项，并发出 <code>message_update</code>。模型结束时，再用最终 <code>AssistantMessage</code> 替换这一项，并发出 <code>message_end</code>。
          </p>
          <CodeBlock>{`message_start → message_update → message_update → message_end
    开始一条消息    文本增量通知       文本增量通知       最终消息`}</CodeBlock>
          <p>
            外部 UI 可以订阅 <code>message_update</code>，把 <code>delta</code> 立刻显示出来；但它不应该把每个事件都当成一条永久历史消息保存，否则同一段回答会被重复记录。真正的状态边界仍然是 <code>agent.state.messages</code> 里的最终消息。
          </p>
          <p>这和<a href="/articles/event-driven">事件驱动</a>的关系是：<code>subscribe</code> 让你观察 Agent 的运行变化；消息数组让 Agent 在下一轮继续工作。一个是观察面，一个是状态面。</p>

          <h2 id="queues">队列决定消息什么时候送达</h2>
          <p>
            调用 <code>prompt</code> 时，Agent 必须处于空闲状态；如果正在处理上一轮，Core 会拒绝再次直接调用 <code>prompt</code>。这时不是把第二次输入硬塞进当前数组，而是根据意图选择队列：
          </p>
          <table>
            <thead><tr><th>API</th><th>含义</th><th>什么时候进入下一次模型请求</th></tr></thead>
            <tbody>
              <tr><td><code>prompt</code></td><td>开始一轮新的工作</td><td>立即启动 Agent Loop</td></tr>
              <tr><td><code>steer</code></td><td>改变当前正在进行的工作方向</td><td>当前 assistant turn 和工具批次完成后</td></tr>
              <tr><td><code>followUp</code></td><td>等当前工作自然结束后再追加任务</td><td>Agent 本来要停止时</td></tr>
            </tbody>
          </table>
          <p>这两个队列仍然由同一个 Agent Loop 在明确的 drain point 读取：先处理 steering；当前轮没有更多工具和 steering 时，再检查 follow-up。</p>
          <CodeBlock>{`现在空闲：prompt 直接加入本轮输入
正在工作：steer 等当前 turn 收尾后注入
即将结束：followUp 等 Agent 本来要停下时注入`}</CodeBlock>
          <p>格式回答“消息长什么样”；队列回答“它何时能影响下一次决策”。</p>

          <h2 id="trace">从输入到模型的完整追踪</h2>
          <p>把前面的概念合并，一次带工具调用的 Pi Core 运行可以这样读：</p>
          <CodeBlock>{`1. prompt(text)
   → 创建 UserMessage → message_start / message_end
2. 每次模型请求前
   → transformContext → convertToLlm → streamFn
3. 模型流返回
   → message_start → 多次 message_update → message_end
4. 有 ToolCall 时
   → tool_execution_start → 执行工具 → tool_execution_end
   → 创建 ToolResultMessage → 加回 AgentMessage[]
5. turn_end
   → 检查 steering → 检查 follow-up → agent_end`}</CodeBlock>
          <p>
            注意第 2 步会在每一次新的模型请求前重新执行。工具结果加入上下文后，下一轮还要重新经过 <code>transformContext</code> 和 <code>convertToLlm</code>；这正是上下文窗口管理和自定义消息可见性能够介入的位置。
          </p>

          <h2 id="session">会话保存的是历史，Agent 运行的是当前状态</h2>
          <p>
            低层 <code>Agent</code> 主要管理内存中的状态：当前模型、系统提示词、工具、消息列表、流式消息和待处理队列。它本身不因为有 <code>sessionId</code> 就自动获得永久记忆。
          </p>
          <p>
            更高层的 <code>AgentSession</code> 才把 Agent 生命周期、消息历史、模型状态、压缩、事件流和会话文件组织到一起。选择内存会话，进程结束后历史自然消失；使用持久化会话管理器，下一次启动才能从存储恢复，再把历史重建为当前 Agent 可用的上下文。
          </p>
          <p className={styles.takeaway}>
            “Pi 记得上一轮”至少包含两个动作：把上一轮产生的消息保存到可恢复的位置；下一轮请求前，把恢复的内容重新整理、转换并发送给模型。只有保存没有重新组装，模型收不到；只有重新组装没有持久化，进程重启后又找不回来。
          </p>

          <h2 id="boundaries">最后只记住四个边界</h2>
          <p><strong>消息</strong>是持续工作的结构化事实；<strong>事件</strong>是运行时告诉外部“事实正在如何变化”的通知；<strong>队列</strong>决定新消息何时影响 Agent；<strong>转换器</strong>决定内部记录的哪一部分、以什么标准格式被模型看到。</p>
          <CodeBlock>{`AgentMessage[]（内部状态）
  → transformContext（同层整理）
  → convertToLlm（跨层翻译）
  → Message[]（模型上下文）
  → 模型流
  → AgentEvent（运行时观察）
  → 最终消息与工具结果回到 AgentMessage[]`}</CodeBlock>
          <p className={styles.closing}>
            这条路径把“记忆”“流式输出”“工具调用”和“事件通知”放到了各自的位置：它们相互配合，但不是同一个概念。
          </p>
          <p>
            文中核验来源：<SourceLink href="https://pi.dev/docs/latest/sdk">Pi SDK 文档</SourceLink>、<SourceLink href="https://github.com/earendil-works/pi/blob/main/packages/agent/README.md">Pi Agent Core README</SourceLink>、<SourceLink href="https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts">类型定义</SourceLink> 和 <SourceLink href="https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts">Agent Loop 实现</SourceLink>。
          </p>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

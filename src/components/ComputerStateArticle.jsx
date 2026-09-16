"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./ComputerStateArticle.module.css";

const sections = [
  { id: "scene", label: "先看一个 Agent 请求" },
  { id: "definition", label: "状态到底是什么" },
  { id: "boundary", label: "状态的边界在哪里" },
  { id: "pi", label: "Pi Agent 怎样实战状态" },
  { id: "loops", label: "运行状态和业务状态" },
  { id: "recovery", label: "HTTP 无状态，服务仍可有状态" },
  { id: "design", label: "设计状态时要问什么" },
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

function Keyword({ children }) {
  return <span className={styles.keyword}>{children}</span>;
}

function StringToken({ children }) {
  return <span className={styles.string}>{children}</span>;
}

function Comment({ children }) {
  return <span className={styles.comment}>{children}</span>;
}

export function ComputerStateArticle() {
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
        <p className={styles.kicker}>学习文章 · 状态</p>
        <h1>状态：计算机如何记住“现在是什么”</h1>
        <p className={styles.lead}>
          从进程的一块内存，到 Pi Agent 的消息历史、工具结果和运行队列，状态一直在回答同一个问题：这个对象此刻是什么，下一步应该依据什么继续变化？
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-17">2026-09-17</time>
          <span>阅读约 12 分钟</span>
          <span>基于 Pi SDK / Agent Core 文档</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            你调用一个 Agent：<code>session.prompt("继续处理这个任务")</code>。它回答了一半，调用了工具，工具返回结果，最后给出结论。几秒后你再次发送“那现在怎么办？”，它为什么能接着上文？
          </p>
          <p>
            直觉上，我们会说“因为它记住了”。但这句话还没有告诉我们：记住的到底是什么，放在哪里，谁在什么时候读取，又是谁把新结果写回去。把这些问题拆开，就是理解计算机状态的入口。
          </p>

          <h2 id="scene">先看一个 Agent 请求</h2>
          <p>
            先不把 Agent 想成一个神秘的“会思考的人”。把一次请求看成一个小型状态变换：输入带着会话标识进入，系统读取旧信息，运行一轮决策与工具调用，再把新结果写回可恢复的位置。
          </p>
          <CodeBlock>
            <Comment>{`// 应用把“属于哪一次持续工作”说清楚`}</Comment>{"\n"}
            <Keyword>const</Keyword>{` request = { sessionId: `}<StringToken>{`"s-42"`}</StringToken>{`, prompt: `}<StringToken>{`"继续处理"`}</StringToken>{` };`}{"\n"}
            <Keyword>const</Keyword>{` previous = `}<Keyword>await</Keyword>{` store.load(request.sessionId);`}{"\n"}
            <Keyword>const</Keyword>{` context = buildContext(previous, request.prompt);`}{"\n"}
            <Keyword>const</Keyword>{` result = `}<Keyword>await</Keyword>{` agent.run(context);`}{"\n"}
            <Keyword>await</Keyword>{` store.append(request.sessionId, result);`}
          </CodeBlock>
          <p>
            这里至少有五种不同的东西：请求本身、会话 ID、以前的记录、正在运行的 Agent、以及已经产生的新结果。它们都可能是“数据”，但只有放到某个对象和时间边界里，我们才能说它们构成了哪个对象的状态。
          </p>
          <p className={styles.takeaway}>
            <strong>本篇的核心：</strong>状态不是“参数比较多”，而是“某个对象在某个时刻的可继续事实”。下一步会读取它，并依据规则把它变成新状态。
          </p>

          <h2 id="definition">状态到底是什么</h2>
          <p>
            一个实用定义是：<strong>状态 = 对象 + 时间点 + 能影响下一步行为的当前事实</strong>。例如，一个进程的当前工作目录是进程状态；一个游戏角色的生命值是对局状态；一个 Agent 的消息列表、当前模型、待处理工具调用和流式输出，是 Agent 运行状态。
          </p>
          <p>
            同一个值既可以是普通数据，也可以是状态。数据库里保存的 <code>health: 10</code> 是数据；对“角色当前生命值”这个对象来说，它又是会决定下一次攻击是否致死的状态。区别不在它是数字还是 JSON，也不在它放在内存还是数据库，而在它是否位于某个对象的变化链上。
          </p>
          <div className={styles.formula}>
            <span>当前状态</span><b>+</b><span>输入事件 / 命令</span><b>+</b><span>规则</span><b>→</b><strong>下一状态</strong>
          </div>
          <p>
            这条式子还揭示了一个边界：客户端发来的“我要攻击”只是操作请求，不是“对方已经掉血”的事实。服务端要先读取权威状态、校验规则、执行变更，再记录新的生命值。Agent 产生的“我准备调用工具”也不是工具已经成功执行；成功结果必须由工具系统返回并写入状态。
          </p>

          <h2 id="boundary">状态的边界在哪里</h2>
          <p>
            “这个系统有状态吗？”通常问得太宽。更准确的问法是：“对谁来说、跨多长时间、由谁保存、下一步由谁读取？”同一台机器上，HTTP 层可以按无状态方式处理请求，业务层却仍然维护订单；同一个 Agent 进程里，持久化消息和本轮的临时队列也不是同一种状态。
          </p>
          <table>
            <thead><tr><th>边界</th><th>它记住什么</th><th>何时消失或恢复</th></tr></thead>
            <tbody>
              <tr><td>函数调用</td><td>局部变量、调用栈</td><td>函数返回后通常消失</td></tr>
              <tr><td>进程</td><td>堆、全局对象、打开的资源</td><td>进程退出后消失，除非写到外部</td></tr>
              <tr><td>会话</td><td>多次操作属于哪条持续交互</td><td>依靠 session ID 找回关联状态</td></tr>
              <tr><td>业务对象</td><td>订单、对局、角色、任务的当前事实</td><td>按业务规则变更，可持久化</td></tr>
              <tr><td>请求</td><td>本次输入和本次处理上下文</td><td>响应结束后通常不自动保留</td></tr>
            </tbody>
          </table>
          <p>
            所以“数据”“存储”“状态”“会话”不是同义词：数据是被记录的内容，存储是放置它的介质，状态是它在变化系统中的语义，会话是把后续操作关联到哪份状态的线索。
          </p>

          <h2 id="pi">Pi Agent 怎样实战状态</h2>
          <p>
            Pi 的 SDK 把状态放在可观察、可操作的对象上。官方文档将 <code>AgentSession</code> 描述为管理 Agent 生命周期、消息历史、模型状态、压缩和事件流的会话对象；底层 <code>agent.state</code> 暴露模型、工具、消息、是否正在流式处理、待处理工具调用和错误信息等字段。详见 <SourceLink href="https://pi.dev/docs/latest/sdk">Pi SDK 文档</SourceLink>。
          </p>
          <Diagram
            alt="一次 Pi Agent 请求的状态流动：可持久化状态、本轮运行状态、送给模型的上下文、模型输出以及结果回写"
            caption="图 1：一次 Agent 请求不是把所有历史原样塞给模型，而是读取状态、组装上下文、运行、再把结果写回。"
            src="/assets/articles/computer-state-pi-flow.png"
          />
          <p>
            沿着图从左上到右下看，关键步骤是：应用用会话 ID 找到历史；当前 prompt 触发 Agent loop；运行时把历史、系统提示词、工具和本轮输入整理成模型上下文；模型输出或工具结果再成为新的消息和事实。下一次请求重新走一遍，因此“继续”不是模型凭空记得，而是系统恢复并重建了可用上下文。
          </p>
          <p>
            Pi Agent Core 的消息路径可以压缩为：<code>AgentMessage[] → transformContext() → convertToLlm() → LLM</code>。前者允许在调用模型前裁剪旧消息或注入外部上下文，后者把 Agent 内部消息转换成模型能理解的消息。这个过程很重要，因为<strong>持久化历史不等于本次发送的上下文</strong>：历史可能要被筛选、压缩、转换，工具定义也要在请求前提供给模型。
          </p>
          <p>
            Pi 还区分 <code>SessionManager.inMemory()</code>、创建持久化会话、继续最近会话和从指定 JSONL 打开会话等方式。选择内存会话时，状态只在当前运行中存在；选择持久化管理器时，应用才有机会在进程重启后恢复。这是“状态存在”和“状态可恢复”的区别。
          </p>

          <h2 id="loops">运行状态和业务状态</h2>
          <p>
            如果你要做的只是一个能调用工具的 Agent，Pi 的运行时已经覆盖了很大一部分内层循环。但如果你要做多个角色、对局、剧情世界或自动化业务，就不能让模型输出直接成为世界事实。
          </p>
          <div className={styles.twoLoops}>
            <div><span>外层：业务 / 世界循环</span><p>接收事件，决定谁该思考，提供可见信息，校验并执行动作，拥有权威业务状态。</p></div>
            <div><span>内层：Pi Agent 循环</span><p>读取上下文，调用模型与工具，产生消息、工具结果和动作意图，拥有本轮运行状态。</p></div>
          </div>
          <p>
            例如守卫 NPC 看到偷窃事件：世界系统先生成 <code>WorldEvent</code>，感知层依据守卫的位置和视野形成 <code>Observation</code>，应用把它和角色记忆组成 <code>NpcContext</code>，Pi 返回 <code>ActionIntent</code>，最后由动作系统检查距离、权限、冷却和当前版本，再执行并产生 <code>ActionResult</code>。只有结果被世界系统接受后，才会成为新的世界状态。
          </p>
          <p className={styles.takeaway}>
            <strong>职责边界：</strong>Pi 可以是决策适配器，但不应自动拥有你的世界规则、角色可见范围、动作执行权和最终事实。模型提出“打算做什么”，业务系统决定“是否真的发生”。
          </p>

          <h2 id="recovery">HTTP 无状态，服务仍可有状态</h2>
          <p>
            RFC 9110 对 HTTP 的“无状态”定义是：每个请求消息的语义可以独立理解，连接与消息之间的关系不影响解释；这是一条协议语义，不是“服务器禁止保存数据”。可以查阅 <SourceLink href="https://www.rfc-editor.org/rfc/rfc9110.html#name-statelessness">RFC 9110 关于 statelessness 的说明</SourceLink>。
          </p>
          <p>
            因此，一个 Agent 服务完全可以这样工作：每个 HTTP 请求都携带 <code>sessionId</code>，服务根据它从共享存储读取历史和任务状态，调用 Agent，再保存新结果。负责处理请求的节点本身不必依赖自己的私有内存；换一个节点，只要它能读取同一份状态，就可以继续处理。
          </p>
          <table>
            <thead><tr><th>说法</th><th>更准确的理解</th></tr></thead>
            <tbody>
              <tr><td>HTTP 无状态</td><td>请求语义不自动依赖此前请求所在的连接</td></tr>
              <tr><td>Agent 会话有状态</td><td>应用用 ID 关联历史、任务和工具结果</td></tr>
              <tr><td>服务节点无状态</td><td>节点不把跨请求唯一真相放在自己的私有内存里</td></tr>
              <tr><td>业务系统有状态</td><td>订单、任务或对局仍然有权威的当前事实</td></tr>
            </tbody>
          </table>
          <p>
            这里还要区分连接、会话和业务状态。连接断了，不代表任务消失；重新连接时，应用要用会话 ID 找回“这是哪一个任务、哪个角色、哪一局”，然后同步所需状态。真正困难的不是给状态加一个数据库，而是处理并发、重复请求、版本冲突、超时、重试和部分成功。
          </p>

          <h2 id="design">设计状态时要问什么</h2>
          <p>
            面对一个 Agent 产品或普通业务系统，可以用六个问题把“状态”落到实现上：
          </p>
          <ol>
            <li><strong>对象是谁？</strong> 是一次请求、一个 Agent 会话、一个任务、一个角色，还是整个世界？</li>
            <li><strong>事实是什么？</strong> 哪些字段会影响下一步，而不是仅供日志展示？</li>
            <li><strong>谁拥有它？</strong> 谁是唯一可以确认变更成功的权威组件？</li>
            <li><strong>活多久？</strong> 只活在函数、进程、本轮任务，还是要跨重启保留？</li>
            <li><strong>什么触发变更？</strong> 用户输入、工具结果、定时器、外部事件，还是另一个服务的命令？</li>
            <li><strong>失败后如何恢复？</strong> 重试会不会重复扣款、重复行动或把未执行的意图误记成事实？</li>
          </ol>
          <p>
            以多角色剧情 Agent 为例，角色的长期性格、关系和记忆可以由角色状态服务保存；当前场景的可见事件由世界系统决定；Pi 只接收被允许看到的上下文并返回结构化意图；执行结果回到世界系统后，再写入新的事实和角色记忆。隐藏事实不能只靠提示词提醒“不要说”，而应在组装上下文时物理省略。
          </p>
          <p className={styles.closing}>
            <strong>回到开头：</strong>Agent 之所以能“接着做”，不是因为模型拥有一块神秘的永久记忆，而是因为系统把会话、历史、任务、工具结果和本轮运行状态放在明确的边界里；下一次请求按标识恢复，再根据当前规则组装上下文。理解状态，就是理解“谁保存了什么、谁在什么时候读取、哪一次变化才算真的发生”。
          </p>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

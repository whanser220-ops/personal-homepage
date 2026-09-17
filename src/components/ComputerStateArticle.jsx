"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "./ComputerStateArticle.module.css";

const sections = [
  { id: "continue", label: "先看“继续”怎么发生" },
  { id: "meaning", label: "状态不是数据，而是变化中的事实" },
  { id: "boundary", label: "状态先要划边界" },
  { id: "pi", label: "Pi Agent 把状态放在哪里" },
  { id: "context", label: "历史不等于上下文" },
  { id: "product", label: "产品真正需要两层状态" },
  { id: "http", label: "HTTP 无状态，Agent 服务仍可有状态" },
  { id: "questions", label: "设计状态时要问什么" },
];

function SourceLink({ href, children }) {
  return <a href={href} rel="noreferrer" target="_blank">{children}</a>;
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

function RequestTrace() {
  return (
    <div className={styles.requestTrace} aria-label="一次 Agent 请求的状态变化">
      <div><span>输入</span><strong>sessionId + 新消息</strong></div>
      <b>→</b>
      <div><span>读取</span><strong>历史 / 任务 / 工具结果</strong></div>
      <b>→</b>
      <div><span>运行</span><strong>模型循环与工具调用</strong></div>
      <b>→</b>
      <div><span>写回</span><strong>新消息 / 结果 / 进度</strong></div>
    </div>
  );
}

function StateBoundary({ title, children, tone = "plain" }) {
  return <div className={`${styles.stateBoundary} ${tone === "peach" ? styles.stateBoundaryPeach : ""}`}><span>{title}</span><p>{children}</p></div>;
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
        <p className={styles.kicker}>学习文章 · 计算机基础 / Agent 架构</p>
        <h1>计算机中的状态：谁保存了“现在”，谁决定下一步？</h1>
        <p className={styles.lead}>
          从一个变量、一条 HTTP 请求，到 Pi Agent 的会话、工具结果和业务事实，状态都在回答同一个问题：这个对象此刻是什么，下一步要依据什么继续变化？
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-17">2026-09-17</time>
          <span>阅读约 14 分钟</span>
          <span>以 Pi SDK / Agent Core 为例</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            你在一个 Agent 产品里说：“继续处理刚才的任务。”它能接着读取上一轮的工具结果，知道自己做到哪一步；即使界面重新连接，产品也可能恢复进度。我们常把这件事说成“模型记住了”，但这句话把几个完全不同的东西揉在了一起。
          </p>
          <p>
            你现在在文章地图的“状态”节点。已有的<a href="/articles/message-system">消息系统文章</a>讨论 Agent 如何组织可继续的消息，<a href="/articles/event-driven">事件驱动文章</a>讨论运行时如何把变化通知给外部代码。本篇先把地基铺好：先判断什么算状态，再看 Pi 怎样保存、恢复、裁剪和更新它。
          </p>

          <h2 id="continue">先看“继续”怎么发生</h2>
          <p>
            假设用户第一次提交“检查这次构建为什么失败”。Agent 读取日志，调用查询工具，得到一个中间结论，然后因为等待外部服务而暂时停下。用户稍后发送“现在有结果了吗？”，系统要想继续，至少需要知道这条新消息属于哪个任务、上轮留下了什么、当前有没有正在执行的调用，以及哪些事实已经被外部系统确认。
          </p>
          <RequestTrace />
          <p>
            这里的“状态”不是一个神秘的大对象，而是几份有不同寿命和所有者的事实：会话记录可以跨进程保存；正在流式输出的标记只在本轮运行中有意义；构建是否真的失败由构建系统确认，而不是由模型的一句话确认。下一次请求只是用标识找回这些事实，再重新决定下一步。
          </p>
          <p className={styles.takeaway}>
            <strong>本篇的主线：</strong>状态 = 某个对象在某个时间点、会影响下一步行为的事实。理解状态，关键不是先问“放在内存还是数据库”，而是先问“谁拥有它、活多久、谁会读取它”。
          </p>

          <h2 id="meaning">状态不是数据，而是变化中的事实</h2>
          <p>
            “数据”强调内容被记录下来；“状态”强调这个内容属于哪个对象、处在什么时刻，并会参与下一次变化。同一个 <code>health: 10</code>，在数据库里是一个字段值；对“这场对局中的角色”来说，它是会影响下一次攻击结果的当前状态。状态的语义不由 JSON、内存或数据库单独决定。
          </p>
          <div className={styles.formula} aria-label="状态变换公式">
            <span>当前状态</span><b>+</b><span>输入 / 事件</span><b>+</b><span>规则</span><b>→</b><strong>下一状态</strong>
          </div>
          <p>
            这条式子还帮我们识别“意图”和“事实”的区别。客户端发来“我要攻击”是操作请求，不等于对方已经掉血；Agent 返回“我准备调用退款工具”是动作意图，不等于退款已经成功。只有权威执行者校验并完成变更后，结果才进入业务状态。
          </p>
          <table>
            <thead><tr><th>概念</th><th>它回答什么</th><th>例子</th></tr></thead>
            <tbody>
              <tr><td>数据</td><td>被记录的内容是什么？</td><td>一条消息、一段日志、一个金额</td></tr>
              <tr><td>存储</td><td>内容放在哪里？</td><td>堆内存、文件、数据库、缓存</td></tr>
              <tr><td>状态</td><td>对象现在是什么，下一步依据什么？</td><td>任务当前阶段、角色生命值、Agent 是否正在流式处理</td></tr>
              <tr><td>会话</td><td>后续操作属于哪条持续工作？</td><td><code>sessionId</code>、任务 ID、对局 ID</td></tr>
            </tbody>
          </table>

          <h2 id="boundary">状态先要划边界</h2>
          <p>
            “这个系统有状态吗？”通常问得太宽。更可靠的问法是：“对谁来说？跨多长时间？由谁保存？下一步由谁读取？”同一台机器上，HTTP 请求可以按无状态方式解释，业务订单却仍然有权威状态；同一个 Agent 进程里，持久化消息和当前等待中的工具调用也不是同一类东西。
          </p>
          <div className={styles.boundaryGrid}>
            <StateBoundary title="函数边界">局部变量和调用栈服务于一次调用；函数返回后通常就失去继续使用它们的入口。</StateBoundary>
            <StateBoundary title="进程边界">堆、全局对象、连接和队列属于进程；进程退出后，除非写到外部，否则它们一起消失。</StateBoundary>
            <StateBoundary title="会话边界">多次请求通过标识归到同一条持续工作；标识只负责关联，不自动等于用户身份。</StateBoundary>
            <StateBoundary title="业务对象边界" tone="peach">订单、对局、角色、构建任务都有自己的当前事实；它们的权威变更应由业务规则确认。</StateBoundary>
          </div>
          <p>
            于是，“重启后还能不能继续”就变成一个可回答的问题：哪些状态只在进程里，哪些状态被持久化；恢复时是直接读回快照，还是从事件、消息或 JSONL 记录重建；恢复以后是否还要重新校验外部事实。
          </p>

          <h2 id="pi">Pi Agent 把状态放在哪里</h2>
          <p>
            Pi 的 SDK 把“正在运行的 Agent”和“可以继续的会话”分成可观察的对象。官方 SDK 文档把 <code>AgentSession</code> 定义为管理 Agent 生命周期、消息历史、模型状态、压缩和事件流的会话对象；通过 <code>session.agent.state</code> 可以看到消息、模型、工具、流式状态、当前部分消息、待处理工具调用和错误等运行信息。可核对 <SourceLink href="https://pi.dev/docs/latest/sdk">Pi SDK 文档</SourceLink> 与 <SourceLink href="https://github.com/badlogic/pi-mono/blob/main/packages/agent/README.md">Pi Agent Core 的状态接口</SourceLink>。
          </p>
          <Diagram
            alt="业务输入经过状态读取与更新、上下文组装、模型与工具循环，输出意图再回写状态的闭环"
            caption="图 1：Agent 的“继续”不是模型凭空记得，而是应用重新读取状态、组装本轮上下文，再把已确认的结果写回。"
            src="/assets/articles/computer-state-state-flow.png"
          />
          <p>
            读图时注意四个边界：会话记录是“以前发生过什么”的持久化候选；运行中队列是“当前还在处理什么”；上下文是“这一次实际交给模型什么”；业务事实是“系统确认真的发生了什么”。它们可能互相引用，却不应因为都叫“上下文”就混成一个列表。
          </p>
          <p>
            Pi 的 coding-agent 还提供会话管理：内存会话适合一次运行或测试，持久化会话可以在进程重启后继续。官方会话文档说明，Pi 的会话以按行追加的 JSONL 文件保存，并支持继续、浏览和从历史分支。这里的关键区别是：<strong>状态在内存中存在，不代表它已经可恢复；写到持久化介质，也不代表恢复后可以跳过业务校验。</strong>详见 <SourceLink href="https://pi.dev/docs/latest/sessions">Pi Sessions 文档</SourceLink>。
          </p>

          <h2 id="context">历史不等于上下文</h2>
          <p>
            很多 Agent 产品的第一个误解是：“既然会话里有全部历史，模型每次就会看到全部历史。”实际请求通常会经过一个选择和转换边界。Pi Agent Core 的主路径可以压缩成：
          </p>
          <div className={styles.pipeline} aria-label="Pi Agent 上下文转换管道">
            <span><code>AgentMessage[]</code><small>内部历史</small></span>
            <b>→</b>
            <span className={styles.pipelinePeach}><code>transformContext()</code><small>裁剪 / 压缩 / 注入</small></span>
            <b>→</b>
            <span><code>convertToLlm()</code><small>翻译成模型消息</small></span>
            <b>→</b>
            <span><strong>LLM</strong><small>本次请求</small></span>
          </div>
          <p>
            <code>transformContext()</code> 仍在 Agent 消息层工作，可以删掉太旧的内容、加入外部上下文或形成摘要；<code>convertToLlm()</code> 则跨过类型边界，把内部消息变成模型协议能理解的消息。工具定义、系统提示词、本轮用户输入也要在请求前进入合适的位置。于是“保存了历史”和“本轮发送了什么”是两个问题。
          </p>
          <p className={styles.takeaway}>
            <strong>一个实用判断：</strong>如果 Agent 说“我记得”，先追问它记得的来源：是持久化会话、当前进程内存、产品自己注入的摘要，还是模型根据本轮上下文推断出来的？只有前面的链路能回答，才算可解释的状态恢复。
          </p>

          <h2 id="product">产品真正需要两层状态</h2>
          <p>
            Pi 能很好地承担模型调用、消息循环、工具调用和事件通知，但一个 Agent 产品通常还有更外层的业务世界。做多角色剧情、自动化任务或对局系统时，不能把模型输出直接当成世界事实。
          </p>
          <div className={styles.twoLoops}>
            <div><span>内层：Pi Agent 运行状态</span><p>当前消息、模型、工具、流式输出、待处理调用和本轮队列。它回答“Agent 现在跑到哪一步”。</p></div>
            <div><span>外层：产品业务状态</span><p>任务阶段、角色关系、权限、库存、对局世界和外部服务结果。它回答“世界现在到底是什么”。</p></div>
          </div>
          <p>
            以多角色剧情产品为例，外层可以沿着这样的契约运行：<code>WorldEvent → Observation → NpcContext → ActionIntent → ActionResult</code>。世界系统决定发生了什么、角色能看到什么；Pi 根据被允许看到的 <code>NpcContext</code> 返回动作意图；动作系统检查距离、权限、冷却、版本和冲突后才执行；执行结果再成为新的世界状态。
          </p>
          <p>
            这条边界同时保护了可控性和信息隔离：隐藏事实不应只靠提示词提醒“不要说”，而应在上下文组装时物理省略；模型提出“准备做什么”，不能自行确认“事情已经发生”。
          </p>

          <h2 id="http">HTTP 无状态，Agent 服务仍可有状态</h2>
          <p>
            RFC 9110 所说的 HTTP 无状态，是指每个请求消息的语义可以独立理解，连接与消息之间的关系不影响解释；它不是“服务器禁止保存数据”。原文见 <SourceLink href="https://www.rfc-editor.org/rfc/rfc9110.html#name-statelessness">RFC 9110 Statelessness</SourceLink>。
          </p>
          <p>
            一个 Agent 服务完全可以让每次 HTTP 请求携带 <code>sessionId</code>、用户认证和本次消息；服务从共享存储读取会话与任务状态，创建或恢复运行时，调用 Agent，再把新消息、工具结果和业务进度写回。处理请求的节点不必依赖自己私有内存，换一个节点也能继续，只要状态来源、并发规则和恢复协议一致。
          </p>
          <table>
            <thead><tr><th>说法</th><th>准确含义</th><th>容易漏掉的工程问题</th></tr></thead>
            <tbody>
              <tr><td>HTTP 无状态</td><td>单个请求的语义不自动依赖上一个连接</td><td>应用仍需显式携带标识并读取状态</td></tr>
              <tr><td>Agent 会话有状态</td><td>历史、模型选择和工具结果属于一条持续工作</td><td>会话隔离、生命周期、恢复和并发</td></tr>
              <tr><td>服务节点无状态</td><td>节点不把跨请求唯一真相放在私有内存</td><td>共享存储、超时、重试、幂等</td></tr>
              <tr><td>业务系统有状态</td><td>订单、任务或对局有权威的当前事实</td><td>版本冲突、部分成功、外部确认</td></tr>
            </tbody>
          </table>
          <p>
            连接断开也不等于任务消失；但“恢复”并不只是重新显示旧消息。产品还要判断上一次工具调用究竟执行成功、失败、超时还是未知，重试会不会重复扣款或重复行动，两个请求是否同时修改了同一版本。这些才是状态工程真正难的部分。
          </p>

          <h2 id="questions">设计状态时要问什么</h2>
          <p>面对一个普通业务系统或 Agent 产品，可以按下面六个问题落地检查：</p>
          <ol>
            <li><strong>对象是谁？</strong> 是函数、进程、Agent 会话、一次任务、一个角色，还是整个世界？</li>
            <li><strong>当前事实是什么？</strong> 哪些字段会改变下一步，哪些只是展示、指标或调试日志？</li>
            <li><strong>谁拥有它？</strong> 哪个组件有权确认变更成功，其他组件只能提出意图或读取副本？</li>
            <li><strong>它活多久？</strong> 只活过一次调用、本轮运行、一次进程，还是必须跨重启保存？</li>
            <li><strong>什么触发变化？</strong> 用户输入、工具结果、定时器、外部事件，还是另一个服务的命令？</li>
            <li><strong>失败怎么恢复？</strong> 超时、重复投递、并发写入和部分成功发生时，怎样避免把意图误记成事实？</li>
          </ol>
          <p>
            如果这六个问题答不清，先不要急着决定“用 Redis 还是数据库”。存储只是承载方式；真正需要设计的是对象边界、变更规则、权威来源和恢复路径。对多 Agent 产品尤其如此：角色状态、世界状态、运行时状态和模型上下文应该按职责拆开，再通过明确的数据契约连接。
          </p>
          <p className={styles.closing}>
            <strong>回到开头：</strong>Agent 能“接着做”，不是因为模型拥有一块永久记忆，而是因为产品保存了可继续的事实，用会话标识找回它们，在每次请求前重新组装上下文，并让真正的执行结果回到权威状态。状态的本质，就是“谁保存了什么、谁在什么时候读取、哪一次变化才算真的发生”。
          </p>

          <div className={styles.sourceNotes}>
            <span>文中核验来源</span>
            <a href="https://pi.dev/docs/latest/sdk" rel="noreferrer" target="_blank">Pi SDK</a>
            <a href="https://pi.dev/docs/latest/sessions" rel="noreferrer" target="_blank">Pi Sessions</a>
            <a href="https://www.rfc-editor.org/rfc/rfc9110.html#name-statelessness" rel="noreferrer" target="_blank">RFC 9110</a>
          </div>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

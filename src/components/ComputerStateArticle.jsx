"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import plaintext from "highlight.js/lib/languages/plaintext";

import styles from "./ArticleReading.module.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("text", plaintext);

const sections = [
  { id: "turnstile", label: "先把闸机过程写完整" },
  { id: "data", label: "状态不是某种特殊格式" },
  { id: "code", label: "追到代码：状态怎样参与执行" },
  { id: "boundary", label: "状态一定属于某个边界" },
  { id: "transition", label: "状态转移比状态列表更重要" },
  { id: "http", label: "HTTP 无状态，不等于业务没有状态" },
  { id: "agent", label: "游戏和 Agent：状态边界会更明显" },
];

function CodeBlock({ children, language = "javascript" }) {
  const code = String(children).replace(/^\n/, "").replace(/\n\s*$/, "");
  const highlighted = hljs.highlight(code, { language }).value;
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
  return (
    <figure className={styles.diagram}>
      <img alt={alt} src={src} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
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
      <Link className={styles.mapLink} href="/articles/knowledge-map">查看这篇文章在知识地图中的位置 →</Link>

      <header className={styles.articleHeader}>
        <p className={styles.kicker}>学习文章 · 计算机基础</p>
        <h1>计算机中的状态：同一个输入，为什么会得到不同结果？</h1>
        <p className={styles.lead}>
          从一扇闸机开始，追踪状态如何被保存、读取和更新，再把这条链连接到变量、进程、HTTP 请求、游戏和 Agent。
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-21">2026-09-21</time>
          <span>阅读约 12 分钟</span>
          <span>重新生成版本</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            你推一下地铁闸机。如果闸机已经锁住，结果是不能通过；如果闸机已经解锁，结果是可以通过。你的动作一样，闸机的规则也一样，变化的是动作发生前的情况。
          </p>
          <p>
            这就是计算机里“状态”最重要的入口：程序要想让同一个输入产生不同结果，就必须在输入到来时知道对象当前处于什么状态。
          </p>
          <Diagram
            alt="同一个推输入在关闭与打开两种当前状态下产生不同结果，并进入状态转移闭环"
            caption="图 1：输入本身不会决定全部结果；程序还要读取当前状态，并按照规则得到下一状态。"
            src="/assets/articles/state-transition-turnstile.png"
          />

          <h2 id="turnstile">先把闸机过程写完整</h2>
          <p>闸机需要保存一个当前事实：现在是锁住，还是解锁？然后按照规则处理输入：</p>
          <ul className={styles.bulletList}>
            <li>当前是“锁住”，收到“推”：拒绝通过，仍然锁住。</li>
            <li>当前是“解锁”，收到“推”：允许通过，并可能回到锁住。</li>
          </ul>
          <p>
            同一个输入之所以有两个结果，不是因为“推”这个词有两个含义，而是因为程序在处理输入前读取了不同的当前状态。
          </p>
          <CodeBlock language="text">当前状态 + 输入 + 规则 → 下一状态</CodeBlock>
          <p>
            这四个部分缺一不可。只有输入，没有当前状态，程序不知道从哪里开始；只有当前状态，没有输入，程序不知道为什么现在要变化；只有规则，没有写回的下一状态，下一次处理仍然会回到旧情况。
          </p>

          <h2 id="data">状态不是某种特殊格式</h2>
          <p>
            把闸机的状态写成一个布尔值很容易，但 <code>true</code> 本身并不自动就是“状态”。它只有放进一个具体的对象和变化过程里，才表示“这台闸机此刻锁住”，并影响下一次收到“推”时的结果。
          </p>
          <CodeBlock>let locked = true;</CodeBlock>
          <table>
            <thead><tr><th>问题</th><th>它关心什么</th><th>例子</th></tr></thead>
            <tbody>
              <tr><td>数据</td><td>记录了什么内容？</td><td><code>locked: true</code>、一条日志、一条消息</td></tr>
              <tr><td>存储</td><td>内容放在哪里？</td><td>变量、堆内存、文件、数据库</td></tr>
              <tr><td>状态</td><td>对象当前是什么，下一步依据什么？</td><td>闸机锁住、订单等待支付</td></tr>
            </tbody>
          </table>
          <p>
            同一个值可以同时是数据和状态。数据库里保存 <code>locked: true</code>，它是数据；闸机读取这个值来决定是否放行，它就是闸机状态的一部分。状态不是一种 JSON 格式，也不是只有放在内存里的东西才算状态。
          </p>

          <h2 id="code">追到代码：状态怎样参与执行</h2>
          <p>用一个最小函数表示闸机，可以看到状态真正发挥作用的地方：</p>
          <CodeBlock>{`function pushTurnstile() {
  if (locked) {
    return { passed: false, message: "请先验证" };
  }

  locked = true;
  return { passed: true, message: "通过" };
}`}</CodeBlock>
          <p>执行顺序不是“调用函数，所以状态自动改变”，而是：</p>
          <ol>
            <li>函数读取当前的 <code>locked</code>。</li>
            <li>规则判断它是否为 <code>true</code>。</li>
            <li>如果锁住，返回拒绝，变量保持原值。</li>
            <li>如果没有锁住，返回通过，并把 <code>locked</code> 写回 <code>true</code>。</li>
          </ol>
          <p>
            读取状态和改变状态是两个动作。程序可能读到了正确的值，却没有把变化写回；也可能写回了一个值，但下一次处理的代码根本没有读取它。只有“读取 → 按规则判断 → 写回”连起来，状态才会影响后续行为。
          </p>
          <p className={styles.takeaway}>
            <strong>有区分力的对照：</strong>如果函数永远直接返回“通过”，无论 <code>locked</code> 是什么，输入结果都不再依赖闸机状态。变量仍然存在，但它已经不参与这条行为规则。
          </p>

          <h2 id="boundary">状态一定属于某个边界</h2>
          <p>问“这个程序有没有状态”太宽。应该问：哪个对象有状态？状态跨多长时间？谁有权修改它？</p>
          <div className={styles.boundaryGrid}>
            <div className={styles.stateBoundary}><span>函数</span><p>参数、局部变量和调用栈服务于一次调用；函数返回后，下一次独立调用通常不会自动继承它们。</p></div>
            <div className={styles.stateBoundary}><span>进程</span><p>堆对象、全局变量、连接和队列可以跨多次函数调用存在，但进程退出后通常一起消失。</p></div>
            <div className={styles.stateBoundary}><span>会话</span><p>多个请求通过 <code>sessionId</code> 或 <code>orderId</code> 归到同一条持续工作；标识不自动等于用户身份。</p></div>
            <div className={`${styles.stateBoundary} ${styles.stateBoundaryPeach}`}><span>业务对象</span><p>订单、对局、角色和构建任务都有自己的当前事实，权威变更应由业务规则确认。</p></div>
          </div>
          <p>
            所以“重启后数据没了”并不神秘：之前的状态只属于已经结束的进程，没有被转移到更长寿命的存储中。网页刷新也不一定意味着工作结束，只要应用用标识找回属于这条工作的历史和当前进度。
          </p>

          <h2 id="transition">状态转移比状态列表更重要</h2>
          <p>只列出“订单有待支付、已支付、已取消”还不够。真正决定程序行为的是允许怎样转移：</p>
          <CodeBlock language="text">{`待支付 --支付成功--> 已支付
待支付 --用户取消--> 已取消
已支付 --再次支付--> 拒绝
已取消 --再次支付--> 需要重新创建订单`}</CodeBlock>
          <p>
            同一个“支付”输入，在“待支付”和“已支付”状态下必须得到不同结果，否则系统可能重复扣款。状态不只是当前标签，还隐含了下一步允许什么、不允许什么。
          </p>
          <p>设计一个状态时至少要明确：</p>
          <ul className={styles.bulletList}>
            <li>当前事实由谁确认；</li>
            <li>哪些输入可以触发变化；</li>
            <li>每种当前状态允许哪些变化；</li>
            <li>变化成功后，新的状态写到哪里；</li>
            <li>如果执行结果未知，能否安全恢复和重试。</li>
          </ul>

          <h2 id="http">HTTP 无状态，不等于业务没有状态</h2>
          <p>
            HTTP 的“无状态”描述的是协议语义：一个请求的理解不应依赖上一个请求的连接或消息。它没有说服务器不能把订单、购物车或任务进度保存到数据库。
          </p>
          <CodeBlock language="text">{`请求：cartId + “加入键盘”
       ↓
读取 cartId 对应的购物车状态
       ↓
按库存和购物车规则计算变化
       ↓
保存新购物车状态
       ↓
返回当前购物车`}</CodeBlock>
          <p>
            每个 HTTP 请求都可以独立携带 <code>cartId</code>，但业务系统仍然有状态，因为购物车这个对象跨请求保留了会影响下一步的事实。
          </p>
          <p>
            “请求处理节点无状态”是部署目标：节点不依赖自己私有内存里的唯一真相，换一台节点也能从共享来源继续；“业务系统无状态”则是另一句话，表示订单、购物车或任务没有跨请求的当前事实。前者和后者不能混为一谈。
          </p>

          <h2 id="agent">游戏和 Agent：状态边界会更明显</h2>
          <p>
            在多人游戏里，客户端发来的“我要攻击”不是世界已经改变的事实。服务器要读取当前对局状态，检查角色是否还活着、距离是否足够、技能是否可用，再更新权威生命值，并把结果同步给客户端：
          </p>
          <CodeBlock language="text">当前对局状态 + 玩家操作 + 游戏规则 → 新的对局状态</CodeBlock>
          <p>
            Agent 也一样。模型说“我打算调用退款工具”属于运行中的动作意图；工具真正执行并得到外部系统确认后，结果才可以进入订单或任务的业务状态。模型上下文、工具队列、流式输出属于 Agent 运行时状态；订单是否成功、角色是否受伤属于产品业务状态。两者有关联，但不能互相冒充。
          </p>
          <p>
            一个可靠的 Agent 服务，通常要让每次请求明确携带或找到：会话标识、本次输入、可见的历史、当前运行状态以及业务系统确认过的事实。它不是让模型凭空记住，而是重新读取状态，组装本次需要的信息，执行动作，再把确认结果写回正确的所有者。
          </p>

          <p className={styles.closing}>
            <strong>回到开头：</strong>同一个“推”为什么一次拒绝、一次通过？因为程序在处理输入时读取了不同的当前状态，并依据同一套规则产生不同的下一步。状态就是某个对象在某个边界内、某个时间点上，会影响下一步行为的当前事实。
          </p>
          <div className={styles.sourceNotes}>
            <span>参考</span>
            <a href="https://www.rfc-editor.org/rfc/rfc9110.html#name-statelessness" rel="noreferrer" target="_blank">RFC 9110：HTTP Statelessness</a>
          </div>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

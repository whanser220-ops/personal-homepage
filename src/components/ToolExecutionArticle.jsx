"use client";

import Link from "next/link";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import plaintext from "highlight.js/lib/languages/plaintext";
import typescript from "highlight.js/lib/languages/typescript";
import { useEffect, useState } from "react";

import styles from "./EventDrivenArticle.module.css";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("typescript", typescript);

const sections = [
  { id: "request", label: "先看一个看似简单的请求" },
  { id: "definition", label: "工具是一份可执行定义" },
  { id: "lookup", label: "按名称找到工具" },
  { id: "validate", label: "先准备，再校验参数" },
  { id: "gate", label: "执行前还可以拦截" },
  { id: "execute", label: "execute 才是现实动作" },
  { id: "result", label: "结果回到正确的调用" },
  { id: "loop", label: "为什么还会再调用模型" },
  { id: "parallel", label: "串行和并行不是一回事" },
  { id: "boundaries", label: "最后记住执行链" },
];

function SourceLink({ href, children }) {
  return <a href={href} rel="noreferrer" target="_blank">{children}</a>;
}

function CodeBlock({ code, language = "plaintext" }) {
  const highlighted = hljs.highlight(code, { language }).value;
  return (
    <pre className={styles.codeBlock}>
      <code className={`hljs language-${language}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
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

export function ToolExecutionArticle() {
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
        <p className={styles.kicker}>学习文章 · 工具系统</p>
        <h1>工具系统：模型说“调用工具”后，代码究竟怎么执行</h1>
        <p className={styles.lead}>
          模型只提出结构化的 toolCall，Agent Runtime 才负责查找工具、校验参数、拦截风险、调用真实代码，并把结果送回下一轮模型请求。
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-17">2026-09-17</time>
          <span>阅读约 15 分钟</span>
          <span>基于 Pi 0.85.1 实现观察</span>
        </div>
      </header>

      <div className={styles.mobileTocWrap}><ArticleToc activeId={activeId} /></div>

      <div className={styles.articleLayout}>
        <div className={styles.articleBody}>
          <p>
            前面的<a href="/articles/message-system">“消息系统”</a>已经说明：模型可以返回一个包含 <code>toolCall</code> 的 <code>AssistantMessage</code>；工具完成后，运行时会写入 <code>ToolResultMessage</code>。<a href="/articles/event-driven">“事件驱动”</a>则说明外部代码如何观察这段过程。
          </p>
          <Diagram
            alt="工具执行链：模型只提出 toolCall，Agent 运行时负责查找、校验、拦截、执行并把 ToolResultMessage 回填给下一轮模型"
            caption="图 1：模型只提出请求；运行时才执行代码。参数错误、权限阻止和执行异常，都会沿着工具结果边界回到下一轮模型。"
            src="/assets/articles/tool-execution-flow.png"
          />
          <p className={styles.takeaway}>
            本文的实现依据是本机 <code>pi-minimal-agent</code> 锁定的 <code>@earendil-works/pi-agent-core@0.85.1</code>。版本升级后请重新核对 API 名称，但不要丢掉这条职责边界。
          </p>

          <h2 id="request">先看一个看似简单的请求</h2>
          <p>假设你对 Agent 说：</p>
          <CodeBlock code={"帮我看看 config.json 里有没有 apiBaseUrl。"} />
          <p>如果 Agent 有一个 <code>read_file</code> 工具，模型可能返回这样的结构化内容：</p>
          <CodeBlock language="json" code={`{
  "type": "toolCall",
  "id": "call_42",
  "name": "read_file",
  "arguments": { "path": "config.json" }
}`} />
          <p>
            此时文件还没有被读取。模型输出的只是数据：工具叫什么、这次调用的唯一 ID 是什么、参数是什么。它没有直接运行 Node.js，也没有直接打开 <code>config.json</code>。
          </p>
          <p className={styles.takeaway}><strong>模型输出 toolCall ≠ 工具已经执行。</strong>模型负责决定“我想要一个什么动作”；运行时负责判断“这个动作能不能执行，以及执行它的代码是什么”。</p>

          <h2 id="definition">工具本身不是一句提示词，而是一份可执行定义</h2>
          <p>Agent 要执行工具，内存里至少要有一份工具定义。可以把它压缩成三个部分：</p>
          <table>
            <thead><tr><th>部分</th><th>回答的问题</th><th>典型内容</th></tr></thead>
            <tbody>
              <tr><td><code>name</code></td><td>模型请求的名字对应谁？</td><td><code>read_file</code></td></tr>
              <tr><td><code>parameters</code></td><td>参数怎样才算合法？</td><td><code>path</code> 必须是字符串</td></tr>
              <tr><td><code>execute()</code></td><td>合法请求最终调用哪段代码？</td><td><code>fs.readFile(path)</code></td></tr>
            </tbody>
          </table>
          <p>Pi 的 <code>AgentTool</code> 还可以包含 <code>label</code>、<code>prepareArguments</code>、<code>executionMode</code> 等字段。它们分别服务于界面显示、参数兼容、串行或并行执行。核心是把<strong>可被模型调用的名字、可验证的输入和真实副作用代码</strong>绑在一起。</p>
          <CodeBlock language="typescript" code={`const readFileTool = {
  name: "read_file",
  label: "Read File",
  description: "读取一个文本文件",
  parameters: Type.Object({
    path: Type.String(),
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    const text = await fs.readFile(params.path, "utf-8");
    onUpdate?.({
      content: [{ type: "text", text: "读取完成" }],
      details: { path: params.path },
    });
    return {
      content: [{ type: "text", text }],
      details: { path: params.path },
    };
  },
};`} />
          <p>模型不会跳进这个 <code>execute</code> 函数。Agent 创建时，应用把 <code>readFileTool</code> 放入 <code>context.tools</code>；之后 Agent Loop 才能根据 <code>toolCall.name</code> 找到它。</p>

          <h2 id="lookup">第一步：按名称找到工具</h2>
          <p>模型返回 <code>name: "read_file"</code> 后，Agent Loop 会在当前可用工具集合中查找同名项：</p>
          <CodeBlock code={`toolCall.name
    → currentContext.tools.find(tool => tool.name === toolCall.name)
    → 找到 AgentTool`} />
          <p>找不到时，运行时不会“猜一个相似工具”，也不会执行模型写在参数里的代码。它会构造一个错误工具结果，例如“Tool read_file not found”，然后继续把这个结果交给模型。</p>
          <p>所以，模型可见的工具列表和运行时真正启用的工具列表必须一致。只把工具写进系统提示词，却没有放进 <code>context.tools</code>，模型可以提出请求，但运行时仍然找不到可执行对象。</p>

          <h2 id="validate">第二步：先准备，再校验参数</h2>
          <p>找到工具之后，Pi Core 不会立刻调用 <code>execute()</code>，而是先处理参数。</p>
          <h3><code>prepareArguments</code> 不是执行工具</h3>
          <p>工具可以提供 <code>prepareArguments</code> 做确定性的兼容转换，但它不应该偷偷读取文件、调用网络或产生业务副作用：</p>
          <CodeBlock code={`模型原始 arguments
    → prepareArguments（可选的纯参数整理）
    → validateToolArguments
    → 已验证的 params`} />
          <p>之后 Schema 校验把不可信输入挡在执行门外。如果模型返回 <code>{"{path: 123}"}</code>，校验会失败，<code>execute()</code> 根本不会被调用；错误会被包装成工具结果，交给下一轮模型修正。</p>
          <p className={styles.takeaway}>工具调用不是“模型 JSON → 直接执行”，而是“模型 JSON → 找工具 → 整理参数 → 校验参数 → 才可能执行”。</p>

          <h2 id="gate">第三步：执行前还可以拦截</h2>
          <p>参数通过校验后，Pi Core 还提供 <code>beforeToolCall</code>。它适合做权限、目录范围、人工确认、取消状态和危险操作检查。</p>
          <CodeBlock code={`找到工具
  → 参数准备
  → Schema 校验
  → beforeToolCall
  → tool.execute()`} />
          <p>如果 <code>beforeToolCall</code> 返回阻止结果，运行时会跳过 <code>execute()</code>，生成一个 <code>isError: true</code> 的工具结果。提示词可以告诉模型“不要读密钥”，但真正的权限边界仍应由代码检查。</p>

          <h2 id="execute">第四步：<code>execute()</code> 才是现实世界的动作</h2>
          <p>经过前面的门槛后，Agent Loop 才会调用：</p>
          <CodeBlock language="typescript" code={`await tool.execute(toolCall.id, validatedArgs, signal, onUpdate);`} />
          <table>
            <thead><tr><th><code>execute()</code> 内部可以做什么</th><th>结果</th></tr></thead>
            <tbody>
              <tr><td>读文件、查数据库</td><td>得到真实数据</td></tr>
              <tr><td>发 HTTP 请求</td><td>产生外部服务调用</td></tr>
              <tr><td>修改游戏状态或业务状态</td><td>发生真实副作用</td></tr>
              <tr><td>调用 <code>onUpdate</code></td><td>向 UI 发送执行中的进度</td></tr>
              <tr><td>抛出异常</td><td>被运行时转换成工具错误</td></tr>
            </tbody>
          </table>
          <p>工具函数应该在失败时抛错，而不是把错误伪装成成功文本。Pi 会捕获抛出的异常，把它变成带 <code>isError: true</code> 的工具结果。<code>signal</code> 提供取消边界；<code>onUpdate</code> 是过程通知，不是最终结果。</p>

          <h2 id="result">第五步：结果为什么能回到正确的调用</h2>
          <p>工具完成后，运行时会把 <code>AgentToolResult</code> 转成标准的 <code>ToolResultMessage</code>：</p>
          <CodeBlock language="json" code={`{
  "role": "toolResult",
  "toolCallId": "call_42",
  "toolName": "read_file",
  "content": [{ "type": "text", "text": "...文件内容..." }],
  "isError": false
}`} />
          <p><code>toolCallId</code> 就是连接请求与结果的钥匙：</p>
          <CodeBlock code={`AssistantMessage { toolCall: { id: "call_42" } }
                         │
                         └── tool.execute()
                                │
ToolResultMessage { toolCallId: "call_42" }`} />
          <p>结果被追加回当前 Agent 上下文后，Agent Loop 才会继续下一轮模型请求。模型看到的是一条明确关联到 <code>call_42</code> 的工具结果，于是可以继续判断下一步。</p>

          <h2 id="loop">工具执行结束后，为什么还会再调用模型</h2>
          <p>工具通常只完成一个动作，不知道用户最终想怎样组织答案。运行时把结果加入消息历史后，会再次请求模型：</p>
          <CodeBlock code={`UserMessage
  → AssistantMessage(toolCall)
  → tool.execute()
  → ToolResultMessage
  → 下一轮 AssistantMessage`} />
          <ol>
            <li>模型根据当前上下文提出工具请求。</li>
            <li>运行时执行请求，或返回拒绝/错误结果。</li>
            <li>结果进入消息上下文。</li>
            <li>模型根据新结果决定下一步。</li>
          </ol>
          <p><code>tool_execution_start</code>、<code>tool_execution_update</code>、<code>tool_execution_end</code> 是观察过程的运行时事件；<code>ToolResultMessage</code> 才是会进入下一轮模型上下文的事实记录。</p>

          <h2 id="parallel">多个工具调用：串行和并行不是一回事</h2>
          <p>一次 <code>AssistantMessage</code> 可能包含多个 <code>toolCall</code>。Pi Core 支持两种执行模式：</p>
          <table>
            <thead><tr><th>模式</th><th>怎么执行</th><th>适合什么</th></tr></thead>
            <tbody>
              <tr><td><code>sequential</code></td><td>一个完成后再执行下一个</td><td>有顺序依赖、会修改同一资源</td></tr>
              <tr><td><code>parallel</code></td><td>先逐个准备和校验，再并发执行允许并行的工具</td><td>多个互不依赖的读取任务</td></tr>
            </tbody>
          </table>
          <p>并行时，工具完成事件按实际完成顺序发出，但写入上下文的工具结果仍按助手消息中的调用顺序排列。如果某个工具声明必须串行，整个批次会退回串行处理；<code>executionMode</code> 是运行时调度约束，不是 UI 标签。</p>

          <h2 id="boundaries">错误发生在哪里，结果就在哪里回填</h2>
          <p>工具系统常见的错误不是一种：</p>
          <table>
            <thead><tr><th>阶段</th><th>例子</th><th>是否调用 <code>execute()</code></th></tr></thead>
            <tbody>
              <tr><td>找工具</td><td><code>name</code> 不存在</td><td>否</td></tr>
              <tr><td>参数准备/校验</td><td><code>path</code> 不是字符串</td><td>否</td></tr>
              <tr><td>执行前拦截</td><td>权限不足、用户拒绝</td><td>否</td></tr>
              <tr><td>真实执行</td><td>文件不存在、HTTP 超时</td><td>是，但执行失败</td></tr>
            </tbody>
          </table>
          <p>前三类是“动作尚未发生就被拒绝”，最后一类是“动作已经开始，但执行过程中失败”。不能只看模型最后说了什么来判断真实世界是否发生过副作用。</p>

          <p className={styles.closing}>
            工具系统不是“给模型一个函数，模型自己运行它”，而是一个受运行时控制的请求协议：
          </p>
          <CodeBlock code={`模型输出 toolCall
  → 按 name 查找工具
  → prepareArguments
  → 参数校验
  → beforeToolCall / 权限判断
  → tool.execute()
  → 成功结果或 isError: true
  → ToolResultMessage
  → 下一轮模型请求`} />
          <p>判断一个工具系统是否设计清楚，可以只问：谁把名字映射到函数？参数在哪里校验？谁掌握权限、取消和副作用？结果怎样通过 <code>toolCallId</code> 回到下一轮上下文？</p>

          <p>
            文中核验来源：<SourceLink href="https://github.com/earendil-works/pi/blob/main/packages/agent/README.md">Pi Agent Core README</SourceLink>、<SourceLink href="https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts">Agent Loop 实现</SourceLink>、<SourceLink href="https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts">类型定义</SourceLink>，以及上一篇<a href="/articles/message-system">消息系统</a>和<a href="/articles/event-driven">事件驱动</a>。
          </p>
        </div>
        <ArticleToc activeId={activeId} />
      </div>
    </article>
  );
}

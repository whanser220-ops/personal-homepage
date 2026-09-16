import Link from "next/link";

import styles from "./EventDrivenArticle.module.css";

function SourceLink({ href, children }) {
  return (
    <a href={href} rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

function CodeBlock({ children }) {
  return <pre className={styles.codeBlock}><code>{children}</code></pre>;
}

export function EventDrivenArticle() {
  return (
    <article className={styles.articleShell}>
      <Link className={styles.backLink} href="/articles">
        ← 返回文章列表
      </Link>

      <header className={styles.articleHeader}>
        <p className={styles.kicker}>学习文章 · 事件驱动</p>
        <h1>事件驱动：从“谁来调用函数”理解一套系统</h1>
        <p className={styles.lead}>
          事件驱动不是“程序自己会动”，而是把“发生了什么”变成数据，再让调度者根据这条数据决定调用谁。
        </p>
        <div className={styles.meta}>
          <time dateTime="2026-09-17">2026-09-17</time>
          <span>阅读约 12 分钟</span>
        </div>
      </header>

      <div className={styles.articleBody}>
        <p>
          这篇文章从一个具体的订单场景出发，回答四个问题：事件到底是什么？谁产生、谁传递、谁处理？为什么事件驱动经常和异步混在一起？什么时候它真的能改善系统，什么时候只是增加复杂度？读完后，你应该能看懂一个最小事件总线，也能判断一个系统到底是“使用了事件 API”，还是已经在用事件驱动的架构。
        </p>

        <h2>先看一条完整链路</h2>
        <p>
          假设用户点击“支付”。支付成功后，系统还要扣库存、发通知、更新积分、记录统计。最直接的写法是：
        </p>
        <CodeBlock>{`async function payOrder(orderId) {
  const payment = await paymentService.pay(orderId);
  await inventoryService.reserve(orderId);
  await notificationService.sendPaymentSuccess(orderId);
  await pointsService.award(orderId);
  return payment;
}`}</CodeBlock>
        <p>
          这段代码很容易读，但支付模块知道了太多后续业务：库存、通知、积分。以后每增加一个“支付成功后要做的事”，都要修改 <code>payOrder</code>。如果某个后续动作很慢，支付主流程还会被它拖住。
        </p>
        <p>事件驱动的改写是：支付模块完成自己的职责，并发布一个事实：</p>
        <CodeBlock>{`async function payOrder(orderId) {
  const payment = await paymentService.pay(orderId);

  await eventBus.publish({
    type: "order.paid",
    orderId,
    paymentId: payment.id,
    occurredAt: new Date().toISOString(),
  });

  return payment;
}

eventBus.subscribe("order.paid", (event) => inventoryService.reserve(event.orderId));
eventBus.subscribe("order.paid", (event) => notificationService.sendPaymentSuccess(event.orderId));
eventBus.subscribe("order.paid", (event) => pointsService.award(event.orderId));`}</CodeBlock>
        <p>
          这里发生的变化不是“把函数换了个名字”，而是控制关系变了：支付模块不再直接调用库存、通知和积分模块；它只发布 <code>order.paid</code>。总线或消息系统保存“谁对这个事件感兴趣”，再负责分发。
        </p>
        <div className={styles.flow}>
          支付模块改变状态 → 创建事件数据 → <code>publish / emit</code> → 按事件类型查找处理函数 → <code>handler(event)</code> → 处理者更新状态或产生下一个事件
        </div>
        <p>
          这也解释了学习事件系统时最应该先问的三个问题：<strong>谁存储关系？谁决定执行时间？谁真正调用了函数？</strong>
        </p>

        <h2>一、事件首先是“事实数据”，不是函数</h2>
        <p>
          事件（event）可以理解为：系统观察到某件事已经发生后，对这次发生及其上下文的记录。<code>order.paid</code> 不是“请支付订单”的请求，而是“订单已经支付成功”的事实。
        </p>
        <table>
          <thead><tr><th>形式</th><th>说话方式</th><th>目的</th></tr></thead>
          <tbody>
            <tr><td>命令（command）</td><td>“请把订单支付掉”</td><td>请求某个明确的动作</td></tr>
            <tr><td>事件（event）</td><td>“订单已经支付成功”</td><td>通知一个已经发生的事实</td></tr>
            <tr><td>查询（query）</td><td>“这个订单现在是什么状态？”</td><td>获取信息，不要求改变状态</td></tr>
          </tbody>
        </table>
        <p>
          命令通常有明确的接收者，事件通常面向所有对该事实感兴趣的消费者。事件的生产者不应该把某个消费者的名字写进事件里；否则只是把直接调用藏进了消息格式。
        </p>
        <p>一个可用事件至少需要三层信息：</p>
        <ol>
          <li><strong>发生了什么</strong>：例如订单 <code>orderId</code> 被支付。</li>
          <li><strong>何时、在哪里发生</strong>：时间、来源、主体、关联请求等上下文。</li>
          <li><strong>如何识别和演进</strong>：事件 ID、类型、版本、数据 schema。</li>
        </ol>
        <p>
          <SourceLink href="https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md">CloudEvents 规范</SourceLink>把事件定义为表达一次发生及其上下文的数据记录，并区分事件数据和上下文元数据。它解决的不是“事件该触发哪个函数”，而是让跨服务传递时，生产者和消费者对 <code>id</code>、<code>source</code>、<code>type</code>、<code>time</code> 等字段有共同语言。
        </p>
        <CodeBlock>{`{
  "specversion": "1.0",
  "id": "evt-8f1",
  "source": "payment-service",
  "type": "com.example.order.paid.v1",
  "time": "2026-09-17T10:00:00Z",
  "subject": "order-42",
  "data": { "orderId": "order-42", "paymentId": "pay-9" }
}`}</CodeBlock>
        <p>
          事件名和 payload 是契约。发布—订阅减少了代码层面的直接依赖，却没有消除语义依赖：消费者仍然必须理解事件类型代表什么，仍然必须知道 <code>data.orderId</code> 的含义。
        </p>

        <h2>二、技术上到底怎样触发</h2>
        <p>把事件系统压缩成几十行代码，控制流就不再神秘：</p>
        <CodeBlock>{`class EventBus {
  #listeners = new Map();

  subscribe(type, handler) {
    const handlers = this.#listeners.get(type) ?? [];
    handlers.push(handler);
    this.#listeners.set(type, handlers);
    return () => {
      this.#listeners.set(
        type,
        (this.#listeners.get(type) ?? []).filter((item) => item !== handler),
      );
    };
  }

  publish(event) {
    const handlers = this.#listeners.get(event.type) ?? [];
    for (const handler of handlers) handler(event);
  }
}`}</CodeBlock>
        <p>调用过程可以逐行展开：</p>
        <CodeBlock>{`const bus = new EventBus();
const unsubscribe = bus.subscribe("order.paid", (event) => {
  console.log("给订单增加积分", event.orderId);
});

bus.publish({ type: "order.paid", orderId: "order-42" });
// publish 找到 handlers，然后直接调用 handler(event)
unsubscribe(); // 页面、场景或模块销毁时解除关系`}</CodeBlock>
        <p>
          <code>subscribe</code> 只是在 <code>Map&lt;事件类型, 处理函数列表&gt;</code> 中保存一个函数引用，它本身不会执行处理函数。真正触发发生在 <code>publish</code>：分发器查找列表、遍历列表、调用 <code>handler(event)</code>。
        </p>
        <p>
          这就是“反转控制”（inversion of control）的一个具体版本。普通函数调用是“我现在知道该调用谁”；事件驱动是“我先把处理函数注册好，未来由框架、总线或运行时在条件满足时调用它”。<SourceLink href="https://www.w3.org/TR/DOM-Level-2/events.html">W3C 的 DOM 事件规范</SourceLink>也使用同一组基本动作：注册 listener、派发 event、在派发时按规则调用处理者。
        </p>

        <h2>三、事件驱动不等于异步</h2>
        <p>这是最容易混淆、也最值得现场验证的一点。</p>
        <h3>同步事件</h3>
        <p>
          在上面的 <code>publish</code> 中，<code>handler(event)</code> 在当前调用栈里立刻执行。发布者要等所有处理函数返回后，才会继续往下执行。如果处理函数做了很重的计算，发布者就会被拖慢。
        </p>
        <p>
          Node.js 的 <SourceLink href="https://nodejs.org/api/events.html">EventEmitter 文档</SourceLink>明确说明：事件发出时，监听器会按照注册顺序同步调用；监听器返回的值会被忽略：
        </p>
        <CodeBlock>{`emitter.on("paid", () => console.log("handler"));
emitter.emit("paid");
console.log("after");

// handler
// after`}</CodeBlock>
        <h3>异步事件</h3>
        <p>
          如果分发器把事件放进队列，稍后再交给消费者，或者消费者内部通过定时器、消息队列、网络 broker 继续处理，执行就被延后了。但这是调度策略，不是“事件”这个概念本身带来的属性。
        </p>
        <table>
          <thead><tr><th>维度</th><th>问题</th><th>可能的答案</th></tr></thead>
          <tbody>
            <tr><td>事件机制</td><td>谁发布、谁订阅、谁分发？</td><td>EventEmitter、DOM、消息 broker</td></tr>
            <tr><td>时间调度</td><td>现在执行还是以后执行？</td><td>同步调用、队列、定时器</td></tr>
            <tr><td>并发资源</td><td>是否占用别的执行单元？</td><td>同一线程、线程池、进程、机器</td></tr>
            <tr><td>交付语义</td><td>丢失、重试、重复怎么办？</td><td>at-most-once、at-least-once、幂等处理</td></tr>
          </tbody>
        </table>
        <p>
          <code>await</code> 也不能证明一个系统是事件驱动。它只是让当前异步函数暂停并等待一个 Promise；它不等于后台线程，也不等于消息消费者。判断系统是否事件驱动，要回到控制流：<strong>后续动作是由直接调用某个函数开始，还是由某个事件被发布后，分发器找到处理者开始？</strong>
        </p>

        <h2>四、历史经验：控制权为什么会转移</h2>
        <p>
          事件驱动首先是对现实约束的回应。批处理程序可以自己安排顺序：读入数据、计算、输出。但交互式程序不知道用户什么时候点击鼠标、按键或关闭窗口；网络服务也不知道下一个连接什么时候到达。程序若一直为每个可能的事情写一条顺序流程，就会既僵硬又浪费资源。
        </p>
        <p>
          GUI 因此形成了“主循环等待外部输入，再分派处理函数”的结构。浏览器中的 DOM 事件、桌面 UI 的窗口消息、服务器中的 socket readiness，本质上都在处理同一个问题：<strong>外部世界的发生顺序不由程序完全控制，程序需要把发生封装成可观察的数据，再在合适的时机恢复控制。</strong>
        </p>
        <blockquote>
          当输入的时间和来源不可预测时，把“等待发生”和“处理发生”分离，系统才有机会继续接收其他输入，也更容易增加新的观察者。
        </blockquote>
        <p>
          代价也同样早已出现：控制流不再集中在一个函数里。程序员必须追踪“谁注册了什么、事件何时产生、回调按什么顺序执行、异常由谁处理”。事件驱动带来的不是免费的解耦，而是把显式调用链换成了隐式调度链。
        </p>

        <h2>五、三项经典工作的共同启发</h2>
        <h3>1. Enterprise Integration Patterns：解耦的是连接，不是契约</h3>
        <p>
          Gregor Hohpe 和 Bobby Woolf 的 <SourceLink href="https://www.enterpriseintegrationpatterns.com/">Enterprise Integration Patterns</SourceLink> 把发布—订阅通道、消息通道、路由器、过滤器等整理成可复用的模式语言。它最有用的启发是：在分布式系统中，不要把“消息发出”想成一个函数调用，而要明确通道、路由、消费者、交付和失败处理。
        </p>
        <p>
          但发布—订阅不会让系统“没有依赖”。依赖从“我调用 <code>inventory.reserve()</code>”转成了“我发布 <code>order.paid</code>，并且双方必须长期理解这个事件契约”。因此事件名、字段、版本、兼容策略和观测信息必须被当作 API 设计。
        </p>
        <h3>2. Reactive Manifesto：消息驱动只是整体目标的一部分</h3>
        <p>
          2014 年发布的 <SourceLink href="https://reactivemanifesto.org/">Reactive Manifesto</SourceLink> 把响应性、韧性、弹性和消息驱动放在同一个系统目标中。这里的 message-driven 不只是“用了一个事件总线”，而是利用异步边界、隔离和位置透明性来控制负载与故障传播。
        </p>
        <p>
          因此，“我用了 Kafka，所以系统是响应式的”是错误推论。消息只是机制，响应时间上界、过载策略、隔离、重试和降级才决定系统是否真的具备这些性质。
        </p>
        <h3>3. Event Sourcing：事件驱动和事件溯源不是一回事</h3>
        <p>
          <SourceLink href="https://martinfowler.com/eaaDev/EventSourcing.html">Martin Fowler 对 Event Sourcing 的说明</SourceLink>强调：事件溯源把状态变化本身保存为事件序列，当前状态可以通过重放事件得到。它回答的是“系统用什么作为状态事实来源”。
        </p>
        <p>
          普通事件驱动架构回答的是“状态变化后，哪些组件接着做什么”。一个系统可以使用事件通知但仍把当前状态存在普通数据库里；也可以使用事件溯源，却不一定把所有消费者都做成异步订阅者。两者可以一起使用，但不能互相当定义。
        </p>

        <h2>六、跨进程后，可靠性成为核心问题</h2>
        <p>本地事件总线里，<code>publish</code> 和状态更新可能发生在同一个进程、同一个调用栈里。跨服务后，至少多出数据库、网络、broker、消费者进程几个失败点。</p>
        <p>最典型的危险写法是：</p>
        <div className={styles.flow}>更新订单为 paid → 提交数据库事务 → 发布 order.paid</div>
        <p>
          如果数据库提交成功后进程崩溃，事件就永远没发出去；反过来，如果先发事件再提交数据库，数据库回滚后，消费者却已经看到了一个不应该存在的事实。
        </p>
        <p>
          <SourceLink href="https://microservices.io/patterns/data/transactional-outbox">Transactional Outbox 模式</SourceLink>的基本做法是：在同一个数据库事务中同时写业务状态和 outbox 记录；事务提交后，独立 relay 再把 outbox 记录发送给 broker。这样解决的是“状态提交和消息发送之间的双写间隙”，但它仍然可能重复发送，所以消费者必须幂等，并且事件要有稳定的唯一 ID。
        </p>
        <CodeBlock>{`命令到达
  → 本地事务：更新订单 + 写 outbox
  → 事务提交
  → relay 发布事件
  → broker 保存或转发
  → 消费者取出事件
  → 幂等检查
  → 更新自己的状态
  → 记录成功、失败或重试`}</CodeBlock>
        <p>
          这条链路说明了一个重要边界：<strong>事件表示发生过，但不自动保证每个消费者都处理成功。</strong>可靠性需要另外设计：重试、死信、幂等、顺序、超时、监控、告警和人工补偿都不能靠“发布—订阅”四个字自动获得。
        </p>

        <h2>七、什么时候适合用，什么时候不适合</h2>
        <p>事件驱动通常值得考虑的情况：</p>
        <ul>
          <li>一个事实有多个相互独立的后续反应，而且未来还可能增加消费者。</li>
          <li>生产者和消费者希望独立部署、独立扩容，或允许短暂的最终一致。</li>
          <li>外部输入的到达时间不可预测，例如 UI 操作、Webhook、设备信号、构建完成通知。</li>
          <li>你需要审计、重放、异步削峰，且愿意承担相应的运维成本。</li>
        </ul>
        <p>直接调用通常更合适的情况：</p>
        <ul>
          <li>调用者必须立即知道结果，且后续动作是当前事务不可分割的一部分。</li>
          <li>只有一个稳定的调用关系，增加总线只会让调试更困难。</li>
          <li>业务还没有定义事件语义、幂等策略和失败处理；此时先写清楚同步流程，往往更诚实。</li>
        </ul>
        <p>
          实际工程中经常是混合的：请求入口用命令和同步校验完成核心决策；事务提交后发布领域事件；通知、统计、索引等非核心反应异步消费。关键不是追求“全事件化”，而是明确哪些边界允许延迟、重复和最终一致。
        </p>

        <h2>八、一个适合现在就做的练习</h2>
        <p>不用 Kafka，也不用框架，只写一个本地 <code>EventBus</code>，然后观察日志：</p>
        <ol>
          <li>注册两个 <code>order.paid</code> 处理函数，分别打印“库存”和“通知”。</li>
          <li>发布一次带 <code>id</code> 的事件，记录处理顺序。</li>
          <li>在第一个处理函数里故意抛异常，观察第二个处理函数是否还会执行。</li>
          <li>把处理函数改成 <code>async</code>，观察 <code>publish</code> 是否等待它返回的 Promise。</li>
          <li>发布两次相同 <code>id</code> 的事件，给消费者加 <code>processedIds</code>，实现一次幂等。</li>
          <li>最后增加 <code>unsubscribe</code>，模拟页面或游戏场景销毁，确认旧处理函数不再收到事件。</li>
        </ol>
        <p>做完后，用这五个问题检查自己的理解：</p>
        <ul>
          <li>事件由谁创建？是状态变化的代码，还是分发器凭空产生？</li>
          <li><code>subscribe</code> 做了什么？它是否真的调用了业务函数？</li>
          <li>是谁调用了 <code>handler(event)</code>？调用发生在当前栈，还是队列消费时？</li>
          <li>事件携带的是命令、事实还是查询？消费者能否理解并兼容它？</li>
          <li>如果事件重复、乱序、丢失或处理失败，系统还能恢复吗？</li>
        </ul>
        <p>
          如果你能沿着这条链路解释清楚，事件驱动就已经从一个架构口号变成了可检查的执行过程。
        </p>

        <section className={styles.readingList}>
          <h2>延伸阅读</h2>
          <ul>
            <li><SourceLink href="https://www.w3.org/TR/DOM-Level-2/events.html">W3C，DOM Level 2 Events，2000</SourceLink>：看最基础的事件注册、派发和处理契约。</li>
            <li><SourceLink href="https://nodejs.org/api/events.html">Node.js，Events API 文档</SourceLink>：验证同步 listener、顺序和异常边界。</li>
            <li><SourceLink href="https://www.enterpriseintegrationpatterns.com/">Gregor Hohpe、Bobby Woolf，Enterprise Integration Patterns，2003</SourceLink>：理解消息通道与发布—订阅。</li>
            <li><SourceLink href="https://reactivemanifesto.org/">The Reactive Manifesto，2014</SourceLink>：理解消息驱动如何与响应性、韧性和弹性共同构成系统目标。</li>
            <li><SourceLink href="https://martinfowler.com/eaaDev/EventSourcing.html">Martin Fowler，Event Sourcing，2005</SourceLink>：区分事件通知和把事件作为状态来源。</li>
            <li><SourceLink href="https://microservices.io/patterns/data/transactional-outbox">Chris Richardson，Transactional Outbox</SourceLink>：理解数据库状态与消息发送之间的可靠性间隙。</li>
          </ul>
        </section>

        <p className={styles.closing}><strong>一句话收尾：</strong>事件驱动的核心不是“用了异步 API”，而是让系统围绕“事实发生了什么”组织控制流；理解事件的来源、分发、调用时机和交付边界，比记住任何一个消息中间件的名词更重要。</p>
      </div>
    </article>
  );
}

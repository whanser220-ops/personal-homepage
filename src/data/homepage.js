export const navItems = [
  { href: "/about", label: "关于我" },
  { href: "/articles", label: "文章" },
  { href: "/projects", label: "项目" },
];

export const articles = [
  {
    status: "已发布",
    title: "工具系统：模型说“调用工具”后，代码究竟怎么执行",
    body: "从 toolCall 开始，追踪 Agent Runtime 如何查找工具、校验参数、执行代码并回填结果。",
    date: "09-17",
    href: "/articles/tool-execution",
    tags: ["工具系统", "Pi Agent", "架构"],
  },
  {
    status: "已发布",
    title: "消息系统：Pi Agent 怎样把“发生了什么”传给模型和界面",
    body: "从 AgentMessage、Message 到 message_update、steer 和 followUp，看懂 Pi Agent 的消息系统。",
    date: "09-17",
    href: "/articles/message-system",
    tags: ["消息系统", "Pi Agent", "架构"],
  },
  {
    status: "已发布",
    title: "计算机中的状态：同一个输入，为什么会得到不同结果？",
    body: "从闸机、变量和状态转移，理解进程、HTTP 请求、游戏与 Agent 中的状态边界。",
    date: "09-21",
    href: "/articles/computer-state",
    tags: ["状态", "Pi Agent", "架构"],
  },
  {
    status: "已发布",
    title: "订阅之后，回调为什么没有立即执行？从一次 Agent 输出看懂事件驱动",
    body: "从 subscribe、emit、processEvents 到 message_update，追踪 Pi Agent 中事件产生、分发与回调执行的真实链路。",
    date: "09-21",
    href: "/articles/event-driven",
    tags: ["事件驱动", "Pi Agent", "架构"],
  },
  {
    status: "计划中",
    title: "个人主页的前端结构",
    body: "记录从静态页、Vite、React、Next.js 到组件库接入的项目演进。",
    date: "07-18",
    tags: ["Next.js", "结构", "复盘"],
  },
  {
    status: "计划中",
    title: "部署流水线笔记",
    body: "整理 GitHub PR、Jenkins 自动构建和 Nginx 静态托管的流程。",
    date: "07-20",
    tags: ["Jenkins", "部署", "流水线"],
  },
  {
    status: "计划中",
    title: "交互动画实验",
    body: "沉淀 Anime.js、组件状态和页面动效之间的协作方式。",
    date: "07-22",
    tags: ["交互", "动效", "React"],
  },
];

export const abilityCards = [
  {
    index: "01",
    topic: "interface",
    progress: 30,
    title: "页面表达",
    body: "用清晰的层级、排版和视觉节奏，把信息组织成容易阅读的页面。",
  },
  {
    index: "02",
    topic: "interaction",
    progress: 48,
    title: "交互实现",
    body: "用 React 状态和 Anime.js 动画增强反馈，让页面变化更自然。",
  },
  {
    index: "03",
    topic: "engineering",
    progress: 64,
    title: "工程结构",
    body: "把路由、组件、样式、数据和部署配置拆到合适的位置。",
  },
  {
    index: "04",
    topic: "delivery",
    progress: 82,
    title: "上线交付",
    body: "把代码托管、自动构建、服务器部署和线上验证串起来。",
  },
];

export const metrics = [
  { target: 4, label: "模块" },
  { target: 12, label: "交互点" },
  { target: 100, label: "可访问" },
];

export const focusItems = [
  {
    status: "当前",
    title: "个人简介与视觉风格",
    focus: "正在整理个人介绍",
    progress: 42,
  },
  {
    status: "进行中",
    title: "项目展示与交互反馈",
    focus: "正在补充作品案例",
    progress: 64,
  },
  {
    status: "下一步",
    title: "内容管理后台",
    focus: "准备接入更多内容入口",
    progress: 76,
  },
];

export const projects = [
  {
    title: "Unity6 构建监控",
    year: "2026",
    status: "已上线",
    subtitle: "CI observability",
    summary: "展示 Unity 云构建内部业务打点，关注阶段耗时、Bundle 构建和资源类型占用。",
    icon: "CI",
    image: "/assets/unity-build-pipeline-sketch.webp",
    tags: ["Unity", "Jenkins", "PostgreSQL", "SSE"],
    links: [{ href: "/build-monitor", label: "Monitor" }],
  },
];

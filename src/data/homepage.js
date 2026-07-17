export const navItems = [
  { href: "/about", label: "关于我" },
  { href: "/articles", label: "文章" },
  { href: "/projects", label: "项目" },
];

export const abilityCards = [
  {
    index: "01",
    topic: "interface",
    progress: 30,
    title: "界面表达",
    body: "用清晰的层级、排版和视觉节奏，把信息组织成容易阅读的页面。",
  },
  {
    index: "02",
    topic: "interaction",
    progress: 48,
    title: "交互实现",
    body: "用 JavaScript 和动画增强反馈，让页面状态变化更自然、更可感知。",
  },
  {
    index: "03",
    topic: "engineering",
    progress: 64,
    title: "工程结构",
    body: "把页面、样式、脚本和部署配置分层管理，保持项目容易扩展。",
  },
  {
    index: "04",
    topic: "delivery",
    progress: 82,
    title: "上线交付",
    body: "把代码托管、服务器部署和线上验证串起来，让作品可以被访问。",
  },
];

export const metrics = [
  { target: 4, label: "板块" },
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
    title: "联系表单与内容管理",
    focus: "准备接入更多内容入口",
    progress: 76,
  },
];

export const projects = [
  {
    status: "线上",
    title: "个人主页",
    body: "一个用于展示个人介绍、能力方向和项目入口的响应式网站。",
  },
  {
    status: "已整合",
    title: "YooAsset 构建分析报告",
    body: "把 Unity 构建产物分析整合到同一个个人主页项目中，通过独立路由查看 Bundle 体积、重复资源和依赖深度。",
    href: "/bundle-report",
    linkLabel: "打开报告",
  },
  {
    status: "计划中",
    title: "内容管理后台",
    body: "为作品、文章和联系信息准备一个更容易维护的管理入口。",
  },
];

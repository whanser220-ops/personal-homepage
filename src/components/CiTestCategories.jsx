import { Braces, GitBranch, PackageCheck } from "lucide-react";

import { Badge } from "./ui/badge.jsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card.jsx";
import styles from "./CiTestCategories.module.css";

// Configuration reviewed on 2026-11-15 at Study Agent main@368d93b8e6dc.
// PR scope: deploy/pr-ci/runner.py; checks: package.json.
// Windows acceptance scope: deploy/jenkins/Jenkinsfile.desktop.
const groups = [
  {
    id: "code",
    title: "代码与构建",
    question: "代码能否形成可运行的程序？",
    Icon: Braces,
    tests: [
      {
        id: "static",
        title: "静态检查",
        stage: "PR CI",
        purpose: "检查格式、类型、依赖与导入约定，尽早发现明显的代码问题。",
        example: "只检查、不改写源码；核对依赖锁文件、TypeScript 类型和网页入口。",
        entry: "npm run check:ci",
      },
      {
        id: "build",
        title: "构建检查",
        stage: "PR CI",
        purpose: "验证各个包和资源能否组合成可运行的程序。",
        example: "离线构建工作区各包，检查编译、模块引用和生成产物是否完整。",
        entry: "npm run build:offline",
      },
    ],
  },
  {
    id: "behavior",
    title: "逻辑与协作",
    question: "局部逻辑与组件连接是否正确？",
    Icon: GitBranch,
    tests: [
      {
        id: "unit",
        title: "单元测试",
        stage: "PR CI · 定向集",
        purpose: "用确定的输入和断言，验证一个局部规则是否成立。",
        example: "修改主题或思考级别后，设置管理器仍保留用户在文件中添加的配置。",
        entry: "settings-manager.test.ts",
      },
      {
        id: "integration",
        title: "集成测试",
        stage: "PR CI · 定向集",
        purpose: "连接多个组件，验证协议、状态与数据能否正确传递。",
        example: "启动本地服务，将远程连接、鉴权与会话运行时连起来，使用模拟模型验证协作。",
        entry: "web-remote.test.ts",
      },
    ],
  },
  {
    id: "delivery",
    title: "产物与用户",
    question: "打包与安装后，应用能否使用？",
    Icon: PackageCheck,
    tests: [
      {
        id: "smoke",
        title: "产物冒烟测试",
        stage: "PR CI",
        purpose: "对打包后的程序做最小运行检查，确认产物具备基本可用性。",
        example: "从发布包启动独立进程，检查健康接口，以及未授权 HTTP / WebSocket 访问的拒绝行为。",
        entry: "deploy/smoke-release.mjs",
      },
      {
        id: "end-to-end",
        title: "端到端验收",
        stage: "Windows 发布阶段",
        purpose: "从用户可见的操作出发，验证一段完整的使用路径。",
        example: "配置了原生 Windows UI、全新安装、覆盖升级与数据保留验收；真实模型任务闭环仍需补足。",
        entry: "deploy/desktop/windows-acceptance.mjs",
      },
    ],
  },
];

const coverageGaps = [
  {
    title: "兼容性矩阵",
    question: "声明支持的环境能否得到验证？",
    detail: "这套 PR 配置尚未覆盖最低支持版本与生产 Node 版本的测试组合。",
  },
  {
    title: "依赖安全检查",
    question: "高风险依赖如何判定和处理？",
    detail: "已有依赖版本与锁文件约束；独立的漏洞分级门槛及例外规则仍需补充。",
  },
  {
    title: "Agent 质量评测",
    question: "回答与教学行为是否发生回归？",
    detail: "仓库已有离线评测入口，尚未纳入这套 PR 检查；真实模型任务与教学质量需单独验证。",
  },
];

export function CiTestCategories() {
  return (
    <div className={styles.map}>
      <p className={styles.scope}>
        Study Agent · 配置快照 2026-11-15。阶段标签说明配置范围，具体执行结果由对应的构建记录提供。
      </p>

      <div className={styles.groups}>
        {groups.map(({ id, title, question, Icon, tests }) => (
          <section aria-label={title} className={styles.group} key={id}>
            <header className={styles.groupHeader}>
              <span aria-hidden="true" className={styles.groupIcon}><Icon size={22} /></span>
              <div>
                <p className={styles.groupTitle}>{title}</p>
                <p className={styles.groupQuestion}>{question}</p>
              </div>
            </header>

            <ul className={styles.testStack}>
              {tests.map((test) => (
                <li className={styles.testNode} key={test.id}>
                  <Card asChild className={styles.testCard}>
                    <article aria-labelledby={`ci-test-${test.id}`}>
                      <CardHeader>
                        <div className={styles.stage}><Badge variant="outline">{test.stage}</Badge></div>
                        <CardTitle id={`ci-test-${test.id}`}>{test.title}</CardTitle>
                        <CardDescription>{test.purpose}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className={styles.exampleLabel}>项目中的例子</p>
                        <p className={styles.example}>{test.example}</p>
                      </CardContent>
                      <CardFooter className={styles.testFooter}>
                        <code>{test.entry}</code>
                      </CardFooter>
                    </article>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className={styles.selectionNote}>
        当前 PR CI 使用固定的定向测试清单，新增或修改的用例需要纳入执行范围；这些类别并不表示完整回归集已经覆盖。
      </p>

      <section aria-labelledby="ci-coverage-gaps" className={styles.gaps}>
        <div className={styles.gapsHeading}>
          <h3 id="ci-coverage-gaps">继续补强的检查</h3>
          <Badge variant="secondary">覆盖待补充</Badge>
        </div>
        <dl className={styles.gapList}>
          {coverageGaps.map((gap) => (
            <div key={gap.title}>
              <dt>{gap.title}</dt>
              <dd>
                <p className={styles.gapQuestion}>{gap.question}</p>
                <p>{gap.detail}</p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <details className={styles.evidence}>
        <summary>分类依据与验证边界</summary>
        <div>
          <p>依据 Study Agent <code>368d93b8e6dc</code> 的配置与测试内容整理，核对日期为 2026 年 11 月 15 日。</p>
          <ul>
            <li><code>deploy/pr-ci/runner.py</code>：PR 的构建、定向测试与发布包冒烟。</li>
            <li><code>package.json</code>：静态检查与离线评测入口。</li>
            <li><code>deploy/jenkins/Jenkinsfile.desktop</code>：Windows 客户端发布验收。</li>
          </ul>
          <p>普通集成测试使用模拟模型；安装、升级和启动验收提供各自场景的证据，真实回答与教学质量需要相应的任务评测。</p>
        </div>
      </details>
    </div>
  );
}

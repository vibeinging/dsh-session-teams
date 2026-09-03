# 公开 NPM 发布准备情况报告

[English](2026-09-01_public-npm-readiness.md) | 中文

## 状态

`@vibeinging/dsh-session-teams@0.1.0` 面向官方 DSH `0.1.2-alpha.4` SDK，能够构建精简的公开 tarball，可以安装到本地 `web` profile，并已通过真实 Desktop 消息和团队状态验收。本次工作没有提交、推送或发布这个源码版本。

## 发布候选版契约

| 项目 | 值 |
| --- | --- |
| 包 | `@vibeinging/dsh-session-teams` |
| 版本 | `0.1.0` |
| 注册表 | `https://registry.npmjs.org/` |
| 访问级别 | 公开 |
| DSH 功能 SDK | `0.1.2-alpha.4` |
| Cordis | `4.0.2` |
| Cordis loader | `1.0.3` |
| Schemastery | `3.18.2` |

此包只使用官方 NPM SDK 包。`SessionPersistence` 提供持久对话目录，`AgentRegistry` 提供实时和恢复的 Agent，`SessionTitleService` 为创建出的团队窗口命名，可选 `SystemPrompt` 服务提供数量受限的路由上下文。插件没有私有连接图、自定义 Session 事件类型或第二套持久存储。

## 发布门禁

源码门禁使用仓库固定的 pnpm 版本：

```sh
npx --yes pnpm@11.7.0 run check
```

仓库规则、双语文档配对、lint、严格 TypeScript 检查、聚焦测试套件、Host 与客户端构建，以及包冒烟审计构成发布边界。聚焦覆盖包含 Host 可见的完整目录、按准确标题恢复冷会话、重名拒绝、输入框目标插入、通过 `steer()` 直接投递和回复、通过 `followup()` 排队的团队任务分派、开放式 v4 转发、旧版 v3 解析、跨成员任务图原子创建、唯一同名团队复用，以及副作用前的多重同名拒绝。聚焦覆盖还包含已知 alpha.4 日志专用团队状态记录；针对这些记录，模型表面生成保持稳定，并能重放早期快照。其他覆盖包括依赖任务投递、技术重试、人工转派、官方 Host 收件箱投递、团队优先浏览器视图和重复抑制。

## tarball 证据

通过以下命令禁用脚本并创建了实际 tarball：

```sh
npm pack --json --ignore-scripts
```

| 字段 | 值 |
| --- | --- |
| 文件名 | `vibeinging-dsh-session-teams-0.1.0.tgz` |
| 打包大小 | 72,313 字节 |
| 解包大小 | 289,047 字节 |
| 文件数 | 20 |
| SHA-1 | `7a00d878a8de99f24beee48e75104d0da0f2628b` |
| SHA-256 | `4cb5736aceab144844c25bdd4efec0568ed8549dd08cf6adf4d9018244930ee9` |
| 完整性 | `sha512-CvJCEVF9VOXnqtq1oU9QsjbOw6hth6/fjkneWA/lCNpD877rrDSIzzXm8Hl4Wygxo0XjPvSBjjLjaryikokHiA==` |

tarball 只包含 `package.json`、`LICENSE`、两份 README、`cordis.patch.yml`、Host 与客户端 bundle、客户端 source map 和生成的类型声明。它不包含源文件、测试、项目笔记、内部报告或本地配置。

## DSH alpha 4 profile 证据

tarball 已通过 DSH 插件命令安装到本地 `web` profile。组合包仍为：

```yaml
- id: session-teams
  name: '@vibeinging/dsh-session-teams'
```

开发版 Desktop 使用该 tarball 重启后，Server 和 DSH runtime 都报告已就绪。标题栏注册了**窗口协作**入口，标准对话列表继续作为可访问目录。十条已有转发消息从带标题前缀的普通气泡变为紧凑的来源卡片，同时保持原来的 Chat 节点类型。点击**来自 数数·学生甲**后，页面通过官方 Session Controller 从**两学生窗口数数**准确切换到**数数·学生甲**。在**其他对话**中点击**创建团队状态验收窗口**后，浮层关闭，输入框出现 `跟“创建团队状态验收窗口”说：`，输入框保持焦点，光标位于末尾。人工输入的普通消息仍使用 Chat 原组件。没有修改正式应用或 DSH 源码检出目录。

## Desktop 验收

包含仓库外 `window-team/state` 事件的测试会话在重启后会被官方持久事件目录拒绝。实现不会重写或删除该用户日志，而是跳过无法读取的目录条目。新状态使用带命名空间的记录，其中包含已知 alpha.4 `team/task` 信封，因此重启后仍可加载，且不会进入模型表面。可读取的早期插件来源快照仍是有效的兼容输入。

在**发送验收消息等待回复**中，模型按标题点名 **alpha.4验收接收窗口**，发送“请回复 ALPHA4-ROUNDTRIP-OK”。目标接收消息，完成自己的执行轮次，并通过同一个 `send_window_message` 返回 `ALPHA4-ROUNDTRIP-OK`。来源窗口此时已经空闲；返回的 `steer()` 消息自动开启来源窗口的新一轮，证明 A 到 B 再到 A 的投递不需要回复开关或往返上限。

在**创建团队状态验收窗口**中，`create_window_team` 把 **alpha.4团队状态验收** 创建为普通可见的顶层对话。调度器通过 `followup()` 发送首个任务，成员通过 `send_window_message` 返回 `TEAM-STATE-OK`，并设置 `task_outcome: completed`；负责人在第一次尝试后达到 `1 / 1`。完整重启开发版 App 后，负责人会话仍能正常加载，窗口协作浮层继续显示一个已完成成员、零个执行中任务和 `1 / 1` 进度。

原始数数请求在**两个窗口协作数数到十**中原样重复执行。模型在 15.837 秒后调用了一次 `create_window_team`，在一个跨成员任务图中提交 10 个有序任务。工具复用了现有且名称唯一的**聪明1**和**聪明2**对话，没有创建替代窗口；调度器让 10 个交替任务全部完成，没有失败。负责人日志包含 31 条仅追加、带命名空间的 `team/task` 状态、0 条插件表面快照、0 次表面替换，并且只包含正常的 `initial` 和 `resume` 请求头。最终浏览器状态显示提示词缓存命中率为 89%。

## 剩余验收边界

插件不会在 Host 停止时排队，不跨 Host 投递，不传输完整会话记录，不删除对话，也不从任意文本推断任务完成。队列接受和任务完成仍是两件事。因为没有对这个精确的 `0.1.0` tarball 执行 `npm publish`，从公开 NPM 安装它仍是一项后续发布操作。

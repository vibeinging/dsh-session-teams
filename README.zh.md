# dsh-window-link

[English](README.md) | 中文

`@vibeinging/dsh-window-link` 可让同一 Host 进程中的一个活跃 DSH 会话窗口向另一个活跃会话窗口排队投递任务。它是完全基于官方 NPM SDK 包构建的独立插件；既不是 fork，也不修改 DSH 源码。

## 新增功能

- 在会话标题栏中提供名为**跟另一个窗口对话**的操作，可将当前会话复制为 `dsh://session/<session-id>`。
- 提供面向模型的 `send_window_task` 工具，可将任务排入链接所指窗口的队列。
- 检查当前消息是否授权，并阻止转发、向自身投递和进程内重复投递。
- 返回稳定的 `accepted` 或 `rejected` 回执。接受只表示任务已进入队列，不表示任务已完成。

## 要求

- DSH `0.1.2-alpha.3` 的 `web` profile，或者提供 `tools`、`agents`、Web 客户端运行时、本地化支持和会话 UI 的自定义 profile。
- 开发时需要 Node.js `^22.19.0` 或 `>=24.0.0`，以及 pnpm `11.7.0`。
- 能够从 NPM 访问这个公开包及其官方 `@deepseek-ai/*` SDK 依赖。

## 安装

请将已发布的包安装到需要提供该操作和工具的每个 profile 中。由于 DSH profile 是 pnpm 工作区根目录，必须使用 `-w`：

```sh
dsh plugin --profile web add -w @vibeinging/dsh-window-link@0.0.1
```

启动 profile 前请检查组合后的配置；其中必须包含 `window-link` 条目：

```sh
dsh --profile web --dump-config
dsh --profile web
```

可用以下命令删除插件包及其 profile 依赖：

```sh
dsh plugin --profile web remove -w @vibeinging/dsh-window-link
```

## 使用

1. 在目标窗口中选择会话标题栏里的**跟另一个窗口对话**。该操作会复制 `dsh://session/<session-id>`，并提示你将其粘贴到另一个窗口。
2. 将完整链接粘贴到源窗口的直接消息中，并说明任务内容。
3. 模型调用 `send_window_task`。`accepted` 结果表示目标窗口已将任务排入下一轮次的队列；不表示任务已完成。

源窗口提示词示例：

```text
Send the release-check task to dsh://session/session-example. Ask it to run the focused tests and report the failures.
```

复制的链接是一项指定目标会话的能力。它不是网络端点，也不会暴露会话记录。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---:|---|
| `maxTaskChars` | `20000` | 工具接受的任务文本最大长度。 |
| `maxRememberedMessages` | `1024` | 为抑制重复投递而保留的进程内消息回执数量。 |
| `requestTimeoutMs` | `30000` | 工具执行和取消的毫秒级时间预算。 |

所有值都必须是正安全整数。插件加载时会因配置错误而失败。

## 安全和投递契约

- 目标链接必须出现在当前执行步骤中由用户直接输入的消息里。插件生成的上下文或更早步骤中的链接不授予任何权限。
- 转发消息以 `[dsh-window-link/v1]` 开头。即使转发的任务包含另一个有效链接，该标记也会阻止继续转发。
- 源会话和目标会话都必须是普通会话。系统会拒绝向自身投递，也会拒绝 subagent 会话。
- 投递使用当前运行中的官方 `AgentRegistry` 和 `agent.followup()` 边界。系统会以 `target-not-active` 拒绝非活跃目标；此版本不会恢复冷会话。
- `message_id` 可在单个 Host 进程内抑制内容完全相同的重复投递。系统会拒绝将同一 id 用于不同内容。Host 重启后不会保留回执。
- 结果只报告队列是否接受任务，不报告目标是否执行或完成任务。若要确认完成情况，需要另行设计回复或状态协议。

详细机制和取舍见[设计参考](docs/design/2026-09-01_window-link-design.md)和 [Agent Note](.agents/notes/implemented/feature/2026-09-01-window-link.md)。

## 兼容性与限制

此版本面向 DSH `0.1.2-alpha.3`。DSH 功能 SDK 使用这一精确的 alpha 版本；基础包使用官方兼容版本：`@deepseek-ai/cordis@4.0.2`、`@deepseek-ai/cordis-plugin-loader@1.0.3` 和 `@deepseek-ai/schemastery@3.18.2`。本包不包含源码检出路径或本地依赖协议。

只有同一 Host 进程中的活跃普通会话可以访问。系统会拒绝非活跃会话、冷会话、远程会话、向自身投递和 subagent 会话。队列接受任务并不能证明目标任务已经完成。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` 会运行仓库与双语文档规则、lint、严格类型检查、测试、生产构建、运行时冒烟检查和 `npm pack --dry-run` 内容审计。`npm publish` 会通过 `prepublishOnly` 调用同一门禁。测试覆盖链接解析、当前步骤授权、转发阻断、重复抑制、活跃窗口投递、工具行为和浏览器操作；Loader 组合测试使用真实的 Cordis loader、`ToolRegistry`、`AgentRegistry` 和 `SystemPrompt` 服务。

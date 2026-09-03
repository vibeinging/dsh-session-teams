# dsh-session-teams

[English](README.md) | 中文

在 DSH 对话窗口之间互发消息，并让当前窗口作为负责人，指挥一组带角色的窗口组成小团队。每条消息都是真实的 DSH 消息：在目标窗口可见、可持久保存，还能点击跳回它的来源。

![演示：一个负责人窗口创建两个计数窗口，任务自动投递、自动接力，每次汇报都以真实消息返回](assets/window-team-demo.gif)

*[观看 70 秒演示](https://github.com/vibeinging/dsh-session-teams/blob/main/assets/window-team-demo.mp4)：一个负责人窗口创建两个计数窗口，任务自动投递、自动接力，每次汇报都以真实消息返回。*

插件完全基于官方 NPM SDK 开发，是独立包，不是 fork，也不修改 DSH 源码。

## 能做什么

- **给任意对话窗口发消息。** 说出窗口名字，让某个窗口去检查、实现或解释一件事；模型会把名字解析成该窗口在目录里的链接。接收方看到一张紧凑的消息卡片，并在同一段对话里回复。
- **带一个窗口团队。** 创建带名字的角色窗口，为每个窗口安排任务和依赖，由插件在上游步骤完成后自动派发后续工作。
- **用自然语言跟进和调整。** 成员把进度和最终结果以真实消息汇报回来。追加任务、转派剩余工作都不需要碰 ID。

## 安装

```sh
dsh plugin --profile web add -w @vibeinging/dsh-session-teams@0.1.0
```

DSH profile 是 pnpm 工作区根目录，因此必须带 `-w`。启动前先确认组合后的配置里包含 `session-teams` 条目，再启动 profile：

```sh
dsh --profile web --dump-config
dsh --profile web
```

插件需要 DSH `0.1.2-rc.1` 的 `web` profile（或提供 `tools`、`agents`、`sessionController`、`sessionPersistence`、`sessionProjections`、`workspaceRegistry` 与标准 Web 对话 UI 的自定义 profile）。开发时使用 Node.js `^22.19.0` 或 `>=24.0.0` 与 pnpm `11.7.0`。

移除插件：

```sh
dsh plugin --profile web remove -w @vibeinging/dsh-session-teams
```

移除插件包不会删除任何 DSH 对话。

## 给另一个窗口发消息

打开对话标题栏里的**窗口协作**入口，可以看到所有能接收消息的窗口。点一行，当前草稿前会加上 `跟“窗口名”说：`；也可以直接用标题描述目标：

```text
Ask the test window to check the release and send the result back here.
```

每个窗口都用目录中展示的 `dsh://session/...` 链接寻址，因此改标题或重名都不会把消息发错窗口。直接说要做什么，模型会把它发送到匹配窗口的链接；如果两个对话同名，模型使用目标窗口的链接，而不是猜测。

![让计数窗口计算 1 + 2，并以紧凑卡片收到来自准确来源的回复](assets/cross-window-message.png)

是否回复由接收窗口自己判断。它可以在有疑问、要同步进度或给出结果时回复——回复始终回到准确的来源窗口，而且发送消息不会结束发送方当前这一轮工作。收到卡片后，点击“来自”后面的来源标题，就能打开那个准确的对话。

## 带一个窗口团队

让当前窗口做负责人，创建一组分工窗口：

```text
Create two windows. Name one Development and let it implement the feature. Name the other Testing and let it verify the result. Coordinate the work until the requirement is complete.
```

![负责人打开窗口团队浮层：共同目标、13 / 13 进度、成员角色与全部完成状态](assets/team-panel.png)

- 标题与请求完全一致的已有窗口会被复用；只有缺少对应标题时才创建新的顶层对话。新窗口统一经官方 Session Controller 组装，使用当前的 Workspace、模型和权限。
- 依赖决定派发顺序：如果测试任务依赖开发任务，测试会一直等待，直到开发窗口通过 `send_window_message` 汇报 `task_outcome: completed`，随后自动开始。
- 成员通过 `send_window_message` 在同一段对话中汇报进度和最终结果。负责人可以直接说“让开发窗口修改实现”或“把失败任务转给测试窗口”，不需要处理 ID。
- 失败分成两类：临时技术故障会自动重试，次数受 `maxTaskAttempts` 限制；测试不通过、需求不清或产出不合格会以“需处理”状态交回给负责人。
- 团队状态——共同目标、进度、成员角色与任务状态——保存在负责人会话中，显示在上面的浮层里。

![成员窗口以真实消息向负责人汇报计数和最终结果](assets/member-reports.png)

## 配置

| 配置键 | 默认值 | 含义 |
|---|---:|---|
| `maxTaskChars` | `20000` | 工具接受的单条消息、团队目标或单个任务的最大长度。 |
| `maxRememberedMessages` | `1024` | 为抑制重复投递而保留的进程内回执数量。 |
| `requestTimeoutMs` | `30000` | 工具执行和取消的毫秒级时间预算。 |
| `maxTeamMembers` | `8` | 一次工具调用最多创建的角色窗口数量。 |
| `maxTeamTasks` | `64` | 一个团队最多保留的任务数量。 |
| `maxTaskAttempts` | `2` | 每个任务允许自动重试的技术故障次数。 |
| `taskRetryDelayMs` | `1000` | 临时投递失败后的重试等待毫秒数。 |
| `maxDirectoryEntries` | `32` | 直接写入模型上下文的对话标题数量；列表工具仍返回完整集合。 |

所有值都必须是正安全整数；配置不合法时插件会在加载时失败。

## 安全与限制

- 只有同一 Host 可见的普通持久对话可以寻址。Host 运行期间冷对话会自动恢复；Host 停止时插件不会排队消息，也不跨 Host 投递。
- 插件刻意不提供 `connect_window` 或 `disconnect_window`。对话无法让自己变得不可达；“别跟测试窗口说话”这句话只留在对话上下文中，不会把窗口从目录里移除。
- `accepted` 只表示目标收件箱接收了消息，不表示工作已经完成。可信的转达消息只能回复给准确来源，不能改投给第三个对话。
- 消息与路由契约、人类授权规则，以及对旧版 window-link 转达的迁移兼容性，见[设计参考](docs/design/2026-09-01_session-teams-design.md)与 [Agent Note](.agents/notes/implemented/feature/2026-09-01-session-teams.md)。

## DSH Desktop

本插件面向标准 DSH `web` profile，而运行这个 profile 最友好的方式是我们的 [DSH Desktop](https://github.com/vibeinging/dsh-desktop)：一个社区维护的桌面发行版，在同一 DSH Profile 中运行官方 DeepSeek Harness 运行时，包含对话、文件、Git、终端、任务、Worktree 与插件市场。官网 [dshdesktopstation.com](https://dshdesktopstation.com/) 提供下载与常见问题解答。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` 会执行仓库与双语文档规则、lint、严格类型检查、聚焦测试、生产构建、运行时冒烟检查，以及 `npm pack --dry-run` 内容审计。`npm publish` 会通过 `prepublishOnly` 运行同一门禁。

# dsh-session-teams

[English](README.md) | 中文

`@vibeinging/dsh-session-teams` 让一个 DSH 对话可以直接跟标准对话列表中的其他普通对话沟通。它没有“连接状态”：只要某个对话仍在标准列表里，就能按标题给它投递消息，不管它正在工作、处于空闲、已经关闭，还是需要在 Host 重启后恢复。插件还可以创建多个带名称和角色的窗口，让当前窗口作为负责人指挥它们，组成一个小型 Agent Team。

<video src="assets/window-team-demo.mp4" controls muted></video>

*[观看 70 秒演示](assets/window-team-demo.mp4)：一个负责人窗口创建两个计数窗口，任务自动投递、自动接力，每次汇报都以真实消息返回。*

它完全基于官方 NPM SDK 包开发，是独立插件，不是 fork，也不修改 DSH 源码。

## 新增能力

- 在标题栏中提供紧凑的**窗口协作**入口。点击成员或其他对话后，对方名称会进入当前输入框，可以继续输入。负责人有团队时先显示团队目标、完成进度、成员角色和任务状态；其他普通对话放在可展开的次级列表中。
- 提供 `list_conversation_windows`，让模型刷新可用对话列表。
- 提供 `send_window_message`，按界面上的准确标题发送任务、问题、进度或结果。接收方会看到一张紧凑的消息卡片，点击来源标题可以打开发送方对话。目标对话不活跃时，插件会先自动恢复它。
- 提供 `create_window_team`，创建缺少的顶层对话窗口，复用标题完全匹配且唯一的已有对话，并在一次调用中接受单任务简写或每个成员的完整任务图。
- 提供 `list_window_team`、`add_window_task` 和 `reassign_window_task`，让负责人查看进度、追加任务并人工转派剩余工作。成员仍通过 `send_window_message` 在同一段对话中提交最终结果。
- 依赖满足后自动投递任务。临时投递故障会在较小次数上限内重试；测试不通过、需求不清或产出不合格会交回负责人判断。
- 提供进程内重复抑制、重名检查、固定来源的回复，以及稳定的收件箱回执。

插件故意不提供 `connect_window` 和 `disconnect_window`。任意一边都不能通过删除单边关系让自己变得不可访问。如果用户说“不要再跟测试窗口对话”，这句话会留在对话上下文中，不会把测试窗口从对话目录里删除。

`accepted` 只表示目标收件箱接收了消息，不表示目标已经完成工作。

## 要求

- DSH `0.1.2-rc.1` 的 `web` profile，或者提供 `tools`、`agents`、`sessionController`、`sessionPersistence`、`sessionProjections`、`workspaceRegistry`、可选 `systemPrompt` 和标准 Web 对话 UI 的自定义 profile。
- 开发时需要 Node.js `^22.19.0` 或 `>=24.0.0`，以及 pnpm `11.7.0`。
- 能从 NPM 访问此包及官方 `@deepseek-ai/*` SDK 包。

## 安装

把插件安装到需要显示入口和工具的 profile 中。DSH profile 是 pnpm 工作区根目录，因此必须使用 `-w`：

```sh
dsh plugin --profile web add -w @vibeinging/dsh-session-teams@0.1.0
```

启动前检查组合后的配置，其中必须包含 `session-teams`：

```sh
dsh --profile web --dump-config
dsh --profile web
```

可用下面的命令移除插件：

```sh
dsh plugin --profile web remove -w @vibeinging/dsh-session-teams
```

移除插件不会删除 DSH 对话。

## 使用已有对话

没有团队时，打开标题栏入口就能看到当前可以接收消息的所有对话。显示为“工作中”或“可对话”都不影响投递。点击一行后，浮层会关闭，当前草稿前会加上 `跟“窗口名”说：`，输入框继续保持焦点，可以补充内容并正常发送。团队中的角色窗口也支持同样操作。

直接使用界面上的标题描述目标：

```text
Ask the test window to check the release and send the result back here.
```

模型会调用 `send_window_message`，并传入 `target_name: "test window"`。用户不需要复制链接，也不用提供会话 ID。如果多个对话的标题完全相同，工具会拒绝并要求明确目标，不会自行猜测。`dsh://session/...` 仍可作为内部路由和兼容用途的准确选择器，但它不是权限，也不是连接关系。

每个接收窗口自行判断下一条消息是否有帮助，可以提问、汇报进度、返回结果，也可以直接停止，不需要额外的回复开关或往返计数。回复只能发给准确来源。发送消息不会结束发送方当前这一轮工作。

收到窗口消息后，可以点击“来自”后面的来源标题，直接打开准确的发送方对话。卡片正文只显示消息内容；跳转仍使用持久保存的来源会话 ID，因此标题后来发生变化也不会打开错误对话。如果来源已不在标准列表中，卡片仍保留发送时的标题，但不会显示失效的跳转操作。

![让计数窗口计算 1 + 2，并以紧凑卡片收到来自准确来源的回复](assets/cross-window-message.png)

*点击成员即可把 `跟“窗口名”说：` 前缀放进输入框；回复会以带准确来源的紧凑卡片返回。*

## 创建 Agent Team

让当前窗口做负责人，并创建多个分工窗口：

```text
Create two windows. Name one Development and let it implement the feature. Name the other Testing and let it verify the result. You are the product lead and coordinate the work until the requirement is complete.
```

![负责人打开窗口团队浮层：共同目标、13 / 13 进度、成员角色与全部完成状态](assets/team-panel.png)

模型会在同一次 `create_window_team` 调用中，把已经知道的所有任务写入 `members[].tasks`，让插件能在投递前验证并保存完整依赖图。标题与请求完全匹配且唯一的已有对话会被复用；只有缺少对应标题时才会创建新的普通顶层 DSH 对话。新对话统一经过官方 Session Controller 组装完整 Agent preset，不会复制一份写死的工具名列表；它会使用负责人的 Workspace、当前工作目录、当前选中的 provider、model 和明确设置的推理强度。在 DSH Desktop 中，可选的父进程 ProductHost 会说明负责人属于 App 项目还是普通 DSH。由 App 项目绑定的负责人会让父进程先创建 App 会话和项目授权绑定，插件再解析 DSH Agent；只有 DSH 身份的负责人则直接通过 Session Controller 创建对话。两条路径都会产生使用正常 preset、显示在标准列表中的 DSH 对话，只有产品绑定的对话会获得项目权限。如果测试任务依赖开发任务，它会先显示为“等待中”；开发窗口通过 `send_window_message` 回复并设置 `task_outcome: "completed"` 后，开发窗口持久历史中最新的可信任务派单会提供 task id，即使其后出现普通提醒或进入后续轮次也不受影响，调度器随后自动投递测试任务。进度和提问使用同一个工具，但不设置 `task_outcome`。之后负责人可以直接说“让开发窗口修改实现”或“把失败任务转给测试窗口”，不需要处理 ID。

![成员窗口以真实消息向负责人汇报计数和最终结果](assets/member-reports.png)

团队状态以完整、仅写入日志的 `team/task` 记录保存在负责人 Session 中，并通过官方 Session Projection 显示在标题栏浮层中。每次变更都会追加更高版本的记录，不进入或替换模型可见表面，因此请求序列和提示词缓存前缀保持稳定。旧版插件来源快照仍可读取，且不会被重写。任务有“等待中、待开始、投递中、执行中、已完成、需处理”六种界面状态。负责人 Session 恢复时，插件会幂等地把所有已知团队成员补登记到负责人的 Workspace；处于投递中的任务会恢复为可调度状态。

失败分为两类。超时、进程中断、目标暂时不可用等技术故障可以自动重试，次数由 `maxTaskAttempts` 限制；测试不通过、需求不清或结果不合格属于工作失败，不自动重试。`reassign_window_task` 只响应用户直接要求，而且不能复制仍在执行或已经完成的任务。

团队创建不会在成员之间做破坏性回滚。复用的对话永远不会被重命名或销毁。如果多个已有对话使用同一个请求标题，整个请求会在任何副作用发生前被拒绝。如果某个成员的创建过程失败，工具会返回该项失败并保留已经创建或复用的普通对话，不会尝试删除父进程持有的 App 会话，也不会破坏持久历史。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---:|---|
| `maxTaskChars` | `20000` | 工具接受的单条消息、团队目标或成员首个任务的最大长度。 |
| `maxRememberedMessages` | `1024` | 为抑制重复投递而保留的进程内回执数量。 |
| `requestTimeoutMs` | `30000` | 工具执行和取消的毫秒级时间预算。 |
| `maxTeamMembers` | `8` | 一次工具调用最多创建的角色窗口数量。 |
| `maxTeamTasks` | `64` | 一个团队最多保留的任务数量。 |
| `maxTaskAttempts` | `2` | 每个任务允许的最大技术尝试次数。 |
| `taskRetryDelayMs` | `1000` | 临时投递故障再次尝试前的等待毫秒数。 |
| `maxDirectoryEntries` | `32` | 直接写入模型上下文的对话数量上限。列表工具仍能返回当前完整结果。 |

所有值都必须是正安全整数。配置不合法时，插件会在加载时失败。

## 路由和安全契约

- 官方 `SessionPersistence` 列表是持久对话目录，实时的 `AgentRegistry` 条目提供工作状态。插件不会保存连接图。
- 同一 Host 可见的每个普通顶层对话都会被列出并且可以访问。向自身投递、subagent、不存在的标题和重复标题都会被拒绝。
- 目标对话不活跃时，插件通过官方 Session Controller 恢复它，由控制器重新组装目标自己的完整 preset、工具、系统提示词、权限和已选模型路由。新建成员会先通过同一控制器使用负责人当前准确的 provider、model 和明确设置的推理强度。
- 模型发出的消息会持久保存为一条 `user/message`，来源采用 user 外形，因此标准 Chat 会显示一等公民气泡；当前官方 Chat 会把非 user 的 context 节点折叠进默认收起的 turn-process 区域，那样转发消息就会被隐藏。人类直接授权采用官方人类来源规则：user 形状的 source 只有在字段限于官方词汇表——`kind`、浏览器提问关联字段 `rpcId` 和 Host 校验的 `clientTimeZone`——时才算人类请求，因此本插件的转发消息和其他插件任何携带元数据的 user 外形消息都不会获得人类授权。对人类授权做门控的消费者应当采用相同的人类来源规则。客户端只识别完整合法的插件 `sessionTeams` 元数据，去掉正文中重复的发送方标题，并显示可跳转到准确来源的紧凑标题栏；非任务类投递会附加一段固定的回复契约，教会接收模型用 `send_window_message` 回复且免填 `target_name`；解析器会剥离该契约，卡片也不显示它，可见消息保持原文；其他用户消息继续使用 Chat 原有组件。路由只接受完整合法且与可见归属一致的 source；损坏的声明一律拒绝，不会放行。`agent.steer()` 会让正在工作的目标在最近一步收到消息，让空闲目标开始一轮；自动调度的团队任务使用 `agent.followup()` 开启单独的任务轮次。插件不会增加消息代理、网络监听器、会话记录共享或 DSH 源码补丁。
- 新转发消息继续使用带版本的 `sessionTeams` 来源元数据。解析器也接受 0.1.0 迁移窗口期间写入的已注册 `window-relay` 来源种类、session-teams v3 的插件来源信封，以及旧版 window-link 来源和信封，因此迁移后仍能读取已保存的消息往返。
- 可信的接收消息只能回复给准确来源。模型自行判断下一条消息是否有帮助；没有往返计数，回复也不能改投给第三个对话。
- 最终团队任务结果通过成员持久历史中最新的可信任务派单进行路由。后续普通转发可以改变当前对话的回复目标，但不能清除或替换该任务身份；负责人当前的团队状态仍会在接受结果前核对团队、任务、任务归属和状态。
- `create_window_team`、`add_window_task` 和 `reassign_window_task` 只响应用户直接请求。当请求的团队和任务图已经明确时，模型会直接调用 `create_window_team`，通过 `members[].tasks` 提交全部工作；后续修改使用 `add_window_task` 或 `reassign_window_task`。每个成员都是普通顶层对话，不是内部 subagent。官方 Session Controller 负责完整组装和 Workspace 归属。在 DSH Desktop 中，父进程会说明发起 Session 的创建范围；产品绑定的成员还会获得 App 会话和项目绑定，只有 DSH 身份的成员则保持为普通可见的 DSH 对话。
- 负责人 Session 中使用官方 `team/task` 事件形状、仅写入日志的命名空间记录是团队任务状态的权威来源。每条记录包含完整的更高版本状态，始终处于模型可见表面之外，并供官方 Session Projection 使用；插件没有自定义事件词汇或第二套数据库。折叠过程仍会读取旧版插件来源快照，但不会修改它们。
- 自动调度只启动依赖已经完成的任务。自动重试只处理临时技术故障；工作失败保留为“需处理”，等待负责人决定重试、修改或转派。
- `message_id` 在单个 Host 进程内抑制完全相同的重复投递。同一个 ID 用于不同内容时会被拒绝；Host 重启后不会保留回执。

详细机制见[设计参考](docs/design/2026-09-01_session-teams-design.md)和 [Agent Note](.agents/notes/implemented/feature/2026-09-01-session-teams.md)。

## 限制

此源码版本面向 DSH `0.1.2-rc.1`。只有同一 Host 可见的普通持久对话可以访问。插件能在 Host 运行时恢复冷对话，但不会在 Host 停止时离线排队，不跨 Host 投递，也不传输完整会话记录。成员在最终一次 `send_window_message` 中设置 `task_outcome` 才会推进依赖；最新的可信任务派单会提供 task id，插件不会把普通消息文本自行解释成任务完成，也不会替负责人接受最终结果。

## DSH Desktop

本插件面向标准 DSH `web` profile，运行这个 profile 最友好的方式是我们的 [DSH Desktop](https://github.com/vibeinging/dsh-desktop)：一个社区维护的桌面发行版，在同一 DSH Profile 中运行官方 DeepSeek Harness 运行时，包含对话、文件、Git、终端、任务、Worktree 与插件市场。官网 [dshdesktopstation.com](https://dshdesktopstation.com/) 提供下载与常见问题解答。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` 会执行仓库与双语文档规则、lint、严格类型检查、聚焦测试、生产构建、运行时冒烟检查和 `npm pack --dry-run` 内容审计。`npm publish` 会通过 `prepublishOnly` 调用同一门禁。

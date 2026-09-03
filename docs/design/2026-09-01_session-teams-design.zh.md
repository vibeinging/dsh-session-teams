# DSH session-teams 设计

[English](2026-09-01_session-teams-design.md) | 中文

本文定义 `@vibeinging/dsh-session-teams` 负责的对话目录、路由、回复、团队任务编排和浏览器边界。

## 产品模型

插件把标准 DSH 对话列表当作通讯录，不再建立第二套连接、断开、在线或授权状态。同一 Host 可见的普通对话只要没有被 DSH 自身删除，就一直可以访问。实时活动只影响界面上显示的状态，以及投递前是否需要恢复它。

自然语言偏好留在模型上下文中。“不要再跟测试窗口对话”表示负责人不应再发送消息，不会修改隐藏关系图，也不能让另一边突然无法访问这个窗口。

## 对话目录

`ConversationWindowDirectory` 合并两个官方来源。`SessionPersistence.listSnapshots()` 提供持久顶层会话及其变更版本；`AgentRegistry.list()` 覆盖当前实时会话和工作状态。目录会排除调用方自身、subagent 和 delegation depth 大于零的会话，但不会隐藏标准列表中已经可见的其他工作区。

冷会话的标题和元数据通过 `SessionPersistence.inspect()` 读取，持久版本没有变化时会复用结果。单条无法读取或格式更新的持久会话会被跳过，不会阻塞整个目录；之前读过的缓存条目会保留。最新 `session/title` 事件提供准确的界面标题。实时事件始终覆盖冷缓存。

`target_name` 使用标准化后的准确标题匹配。标题不存在或重复时会拒绝，不会猜测。`target_link` 只用于内部路由和兼容时准确选择目标，不代表权限，也不创建状态。两个选择器都省略时，只有工作区中正好存在一个其他对话才会自动选择。

## 投递和回复

不活跃的持久目标通过 `SessionController.resolveAgent()` 恢复。控制器会恢复目标自己已选的模型，并执行与用户打开普通对话相同的 Agent preset、工具、提示词、权限和生命周期组装。同一个 Session 的并发恢复会共用一个 Promise；如果身份竞争中已有其他调用先完成注册，插件会接受这个已注册结果。

模型编写的每条消息都是一条持久化的 `user/message`，来源采用 user 外形。曾按官方约定实现过注册的非 user `window-relay` 种类并已回退：官方 Chat 会把所有非 user 来源分类为注入的 context 节点，并把这些节点折叠进默认收起的 turn-process 区域，转发消息因此在普通对话窗口中不可见。user 外形 source 保留一等公民的 Chat 气泡，权威代价被显式支付：人类直接授权采用官方人类来源规则，user 形状的 source 只有在字段限于官方词汇表——`kind`、浏览器提问关联字段 `rpcId` 和 Host 校验的 `clientTimeZone`——时才算人类请求，因此本插件的转发消息和任何其他生产者携带元数据的 user 外形消息都按构造被排除。对人类授权做门控的消费者应当采用相同的人类来源规则。保存的文本包含发送窗口的显示标题和原消息，因此没有安装该客户端插件时，记录仍然容易理解。非任务类投递会在该文本后附加一段固定的回复契约，告诉接收模型用 `send_window_message` 回复且免填 `target_name`，与任务派单自带的更严格汇报契约保持一致；协议解析器会剥离这段契约，客户端卡片也不显示它，因此解析出的消息始终是发送方撰写的原文。插件自有的版本化 `sessionTeams` source 元数据记录消息和对话 id、可选 team id 和 task id、来源 Session、目标 Session，以及用于准确回复路由的发送方标题；路由只接受完整合法的 source，并要求可见归属信息匹配。正在工作的目标通过 `agent.steer()` 在最近的步骤接收消息；空闲目标会开始一轮。自动调度的团队任务使用 `agent.followup()` 开启单独的任务轮次。解析器也接受 0.1.0 迁移窗口期间写入的已注册 `window-relay` 来源种类、session-teams v3 的插件来源信封，以及旧版 `@vibeinging/dsh-window-link` 来源和 `[dsh-window-link/message/v3]` 信封，因此持久保存的消息往返仍可读取。

用户直接输入的轮次可以向目录中的任意目标发送消息。可信接收消息只有在目标就是当前会话时才能回复。回复目标固定为原始来源，因此不能把任务改投给第三个对话。

接收方自行判断提问、进度、结果或继续回复是否有帮助。没有回复开关或往返计数，发送消息也不会结束发送方当前这一轮。收件箱接受只证明 `steer()` 或 `followup()` 没有抛错。

`DeliveryLedger` 为每个消息 id 和准确路由内容指纹保留第一个 Promise。完全相同的重试共享首次结果；同一个 id 对应不同内容时会拒绝。已完成记录可以淘汰，活动记录不会被淘汰，插件卸载时会清空账本。

## 窗口团队和任务状态

`create_window_team` 接收一个共同目标、当前负责人的角色，以及一到 `maxTeamMembers` 个带名称的成员请求。每个请求可以使用兼容的单任务简写，也可以提供 `tasks` 数组，其中包含稳定 id、短标题、可选依赖和最大技术尝试次数。工具只在用户直接输入的轮次中可用，并会在任何副作用发生前校验完整的跨成员任务图、标题歧义、任务 id、依赖引用、数量限制和有向无环性。

标题完全一致且唯一的现有对话会被解析并复用。出现多个完全匹配项时，会在创建或重命名任何成员之前拒绝整个请求。只有找不到该标题时，才创建普通顶层对话。在普通 DSH Host 中，插件使用负责人的 Workspace 和 preset 调用 `SessionController.create()`，随后调用 `rename()`、`selectModel()` 和 `resolveAgent()`。模型选择会复制负责人当前请求已经组装出的准确 provider、model 和明确设置的推理强度，不会枚举或复制单个工具。在 DSH Desktop 中，可选的 ProductHost 会先返回发起 Session 的 `product` 或 `dsh` 创建范围。产品绑定的负责人会调用 `productHost.conversationCreate()`，由可信父进程根据已授权身份创建 App 会话、DSH Session、Workspace 归属和项目绑定；只有 DSH 身份的负责人则使用与普通 Host 相同的 Session Controller 路径。为了兼容不提供范围方法的旧 ProductHost，插件仍将它视为产品权威路径。范围查询、产品创建或返回值校验失败时会直接失败，不会切换路径。调度器只投递依赖已经完成的任务；消息说明团队目标、负责人、成员角色、task id、具体任务和尝试次数。成员使用 `send_window_message` 提问、汇报进度和提交最终结果；只有最终结果设置 `task_outcome`，task id 则由可信任务消息在内部提供。

创建出的成员是负责人 Workspace 中界面可见的普通对话，不是 subagent。负责人后续可以通过同一目录访问它们。负责人 Agent 创建或恢复时，插件会折叠其持久团队状态，并将每个已知的持久成员幂等挂接到该 Workspace；这样无需建立第二套分组存储即可修复成员关系。一条采用官方 `team/task` 形状并带插件命名空间 selector 的记录，保存完整的团队、成员、任务、依赖、负责人、状态、尝试次数和最近结果。每次修改都将完整状态以更高 revision 作为仅写入日志的事件追加。该事件既不进入也不替换模型可见界面，因此 `replaceGeneration` 和 request-series 边界保持不变，模型可以复用现有的 prompt-cache 前缀。官方 Session Projection 从同一批记录折叠浏览器视图，不拥有另一份状态。折叠格式变化时，该投影的状态版本只会使派生投影检查点失效。兼容折叠还会读取早期插件来源的 `snapshot` 消息和 `window-team/state` 值，不会重写或删除它们。

任务状态是 `blocked`、`ready`、`queued`、`running`、`completed` 或 `failed`。依赖完成会把等待任务变成可执行任务；调度器先原子地将可执行任务认领为已入队，并在投递接受后标记为执行中。插件重载会将未确认的入队投递恢复为可执行工作；不会静默复制执行中的工作。

技术失败在尝试次数未耗尽时回到可执行状态。自动重试只覆盖目标暂时不可用等投递故障，或成员明确报告的 `technical` 失败；成员报告的 `work` 失败会立即标记为失败。`reassign_window_task` 只接受用户直接请求，只能移动等待、可执行或失败任务，并把尝试次数清零后重新调度。运行中和已完成任务不会被复制。

创建失败不会回滚已经成功的其他成员。复用的对话永远不会被重命名或释放。某个成员创建失败时，工具会返回对应结果；Session Controller 或父进程 ProductHost 已经创建的普通会话会保持持久并可被再次复用。这能避免后续组装步骤失败时删除父进程持有的 App 会话或破坏持久历史。如果后面的成员失败，而前面的成员已经创建或复用，结果会返回 `partial` 并列出每个请求的结果；成功窗口会继续保留。

## 模型上下文和工具

可选 `SystemPrompt` 内容会列出一个有数量限制的目录快照，包含标题、活动状态和准确链接。它会说明每个条目都可直接访问、不存在连接状态，而且自然语言中的停止偏好应通过上下文遵守，不能修改目录。对于用户直接提出的团队请求，它会要求模型直接调用 `create_window_team`，在一次调用中把所有已知的有序工作放入 `members[].tasks`，不要计划日后再连续调用 `add_window_task`。它还会说明标题完全一致且唯一的对话会被复用，标题有歧义时必须先澄清。缓存信息不够时，`list_conversation_windows` 会异步刷新完整列表。

公开给模型的工具是：

- `list_conversation_windows`
- `send_window_message`
- `create_window_team`
- `list_window_team`
- `add_window_task`
- `reassign_window_task`

没有连接或断开工具。

## 浏览器集成

浏览器入口注册在 `conversation.session.header.actions`，读取标准 `useSessions` 快照、`useInput` 草稿、`inputActions` 和官方 `useProjection('windowTeam')`。目录与标准侧边栏的可见性规则保持一致：空白、subagent 路由和已归档的对话通过 `useWorkspaces` 归档基线保持隐藏，其余对话按工作区目录分组（当前工作区置顶），列表变长时提供标题搜索。没有团队时，紧凑的双窗口图标显示其他列表对话数量，浮层显示当前窗口和可对话目录。负责人有团队时，角标改为成员数，浮层先显示目标、完成进度、执行中数量、成员角色和当前任务状态；与团队无关的普通对话折叠在次级区域。点击成员或目录行时，插件通过官方 `InputActions.setDraft()` 在当前草稿前加上对方的界面标题，关闭浮层并把焦点还给输入框；发送时仍是普通用户消息，由模型识别自然语言目标并调用 `send_window_message`。界面不提供邀请、连接、断开或移除操作。

浏览器还会用较低 Slot 优先级覆盖 Chat 自带的 `user`、`steering` 和 `context` 渲染器；context 装饰让迁移窗口期间的 `window-relay` 记录在完整转写视图中仍然可见。包装组件只接受持久转发 source 和可见归属信息都通过协议解析的消息；其他消息全部交回捕获的原组件渲染。合法转发消息显示为靠右的紧凑卡片，来源标题栏和消息正文分开。点击标题栏时，组件先从 `useSessions` 读取来源的当前标题，再调用官方 `sessions.open(sourceSessionId)` 打开准确对话。来源已不存在时，只保留发送时的静态标题。这只是显示层投影，不修改持久消息、Host 投递、模型可见表面或提示词缓存代次。

浮层定位在视口层，避免被侧边栏容器裁剪。点击外部或按 Escape 会关闭浮层；Escape 会恢复触发按钮焦点，减少动画偏好会关闭进入动画。

## SDK 和包边界

此包面向 DSH `0.1.2-alpha.4`，只导入官方 NPM SDK 包。它要求 `tools`、`agents`、`sessionController`、`sessionPersistence`、`sessionProjections` 和 `workspaceRegistry`，`systemPrompt` 和窄范围的 ProductHost 对话创建能力可选。它的团队状态记录使用已知的 alpha.4 `team/task` 信封，并带有插件命名空间 selector 和官方严格任务形状，因此 Agent Teams 投影不拥有该 selector 时会忽略这条记录。它不包含源码检出路径、DSH 源码补丁、写死的工具清单、消息代理、网络监听器、会话记录桥接、自定义 Session 事件类型或第二套持久存储。

## 命名

包和 loader 使用 `@vibeinging/dsh-session-teams` 和 `session-teams`，因为持久 DSH Session 是路由标识，而且一个负责人可以协调多个成员。浏览器仍将此功能称为**窗口协作**，并使用直白的“窗口”和“团队”用语。旧版包和信封标识只作为只读兼容输入；新转发消息使用 session-teams 标识。

## 当前限制

只有同一 Host 可见的普通持久对话可以访问。Host 停止后没有离线队列。跨 Host 路由、会话记录流式传输、从普通文本自动判断完成、自动转派和跨多个负责人会话合并团队看板不在当前设计范围内。

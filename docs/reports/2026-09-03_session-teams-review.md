# dsh-session-teams 插件评审报告

日期：2026-09-03
对象：`@vibeinging/dsh-session-teams@0.1.0`（工作区含 window-link → session-teams 改名的未提交变更）
方式：全量源码阅读（src/ 9 个 Host 模块 + src/client/ 4 个浏览器模块）、10 个测试 spec 抽查、本地完整验证。

## 验证结果

| 检查 | 结果 |
|---|---|
| `pnpm run test`（vitest，10 个文件） | 67 / 67 通过 |
| `pnpm run lint`（oxlint，96 规则） | 0 警告 0 错误 |
| `pnpm run typecheck`（tsc strict + exactOptionalPropertyTypes） | 通过 |
| `pnpm run check:rules` / `check:docs` / `check:package` | 全部通过 |
| `npm pack --dry-run` | 21 个文件，内容符合 `files` 声明 |

## 总体评价

这是一个完成度很高的插件：信任模型经过认真设计，状态管理干净，测试覆盖扎实，工程纪律（双语配对学生、结构签名校验、发布门禁）少见地严格。整体可以发布，下面按严重度列出发现的问题。

### 设计优点

1. **信任模型严谨**。relay 消息采用 user 外形以获得标准 Chat 渲染，但 `sessionTeams` 元数据被明确排除出"直接人类授权"（`authority.ts`）；格式不全的 claim 直接 fail-closed（`protocol.ts:224`）；回复被锁定到精确来源 session；任务分配从持久日志中取"最新可信 assignment"，后续普通 relay 无法覆盖任务身份。
2. **目录无连接态**。以官方 `SessionPersistence` 为持久目录、live `AgentRegistry` 提供工作状态；冷会话经官方 SessionController 恢复，`#pendingResumes` 去重并发唤醒，identity collision 时接受竞态赢家（`directory.ts:224`）。
3. **调度器并发正确**。按 leader Session 合并 drain；claim 先落库再投递，settle 时校验 `attempts` 防止过期写（`team-scheduler.ts:141`）；插件重启后 `queued` 任务恢复为 `ready` 并标注 `recovered after plugin restart`（`index.ts:1124`）。
4. **团队状态存储干净**。完整快照以 log-only `team/task` 记录追加，zod 双端校验 + revision 一致性检查；不进入 model-visible surface，保持 prompt-cache 前缀稳定。
5. **创建流程非破坏性**。完整任务图（环、未知依赖、重复 id、重名成员、歧义标题）在任何副作用之前校验；单成员失败保留已建会话，不尝试删除 parent 拥有的 App Session。
6. **测试质量高**。含真实 cordis Loader 组合测试、真实 AgentRegistry + Inbox 集成测试、jsdom 客户端组件测试；负面路径（歧义、伪造 claim、旧协议 envelope）均有覆盖。

## 发现的问题

### 中等：信任边界偏宽（设计风险）

`currentTurnDirectMessages`（`authority.ts:37`）把任何 `source.kind === 'user'` 且不带本插件 `sessionTeams` claim 的消息都视为"直接人类请求"，从而授予该 turn 完整权限（`create_window_team`、`add_window_task`、`reassign_window_task`、任意目标投递）。如果其他插件或自动化（定时任务、外部注入工具）以 user 外形写入消息，也会获得同等授权——本插件只排除了自己的 claim，对未知来源是 fail-open 的。

建议：维护一个已知非人类 source 的排除清单（例如按 `source` 上的其他插件命名空间字段排除），或在 DSH 提供正向"真实人类输入"标记时改用正向判定。至少在 README 的 Routing and safety contract 中声明该假设。

#### 官方做法调研（2026-09-03 补充）

对照官方 SDK 与官方插件后，该问题比初审判断的更明确——**官方已有完整约定，而本插件的 v4 visible relay 偏离了它**：

1. **source 归属约定**（`@deepseek-ai/dsh-llm` `message.d.ts`）：内建 `user` 是裸 `{ kind: 'user' }`，专属于真实人类输入；插件内容用 `kind: 'plugin'` + 语义化 `form`。`ContextForm` 词汇表里专门有 `'relay'`——"A message another agent addressed to this one"，就是为会话间消息设计的。`MessageSourceMap` 是 merge-extensible，官方 subagent 插件正是注册专属 kind：`kind: 'coordinator'` 与 `kind: 'subagent-report'`，均带 `form: 'relay'` + `senderSessionId`（`packages/subagent/subagent/src/continuation.ts`、`tool-subagent-control/src/index.ts`）。
2. **官方人类判定**：`dsh-agent-budget` 的 `requireDirectHuman`（`dsh-agent-budget/src/index.ts:350`）就是裸的 `event.data.source.kind === 'user'`，注释称为 "host-attested human message"，没有排除清单。官方 DSH 核心代码里不存在任何 human-authority 辅助函数——约定即全部。
3. **Chat 渲染三分法**（`dsh-client-ui-chat` `conversation-nodes/message.d.ts`）：`user`（turn 开启的人类消息）、`steering`（"A **human** message admitted from the next-step inbox while a turn was running"）、`context`（"Non-user context injected into model history"，带 provenance 投影）。非 user-kind 的消息落入 context 节点。
4. **偏离的后果是双向的**：
   - 向内（初审发现）：本插件无法区分其他插件的 user 外形注入，fail-open。
   - 向外（本次新发现）：本插件的 relay 是 `kind: 'user'`，任何按官方裸约定做人类判定的消费者（如 agent-budget 的 `requireDirectHuman`）都会把**来自另一个窗口的机器消息当作真人输入**——跨插件权威泄漏。一个窗口里被提示注入的模型可以向目标窗口投递消息，并在目标窗口通过 budget 等插件的人类授权门。此外 `agent.steer()` 投递的 relay 落在 steering 节点，其官方语义是"人类消息"。
5. **历史对照**：本插件的 v3/legacy 协议用的正是官方约定（`kind: 'plugin', form: 'relay'`，`authority.ts:84` 至今仍在解析）；v4 为了标准用户气泡渲染改成 user 外形，并用 `isWindowMessageSourceClaim` 在自家判定里打补丁——补丁只覆盖自家代码，覆盖不了生态里其他遵循裸约定的消费者。

**按官方约定的修法（推荐方案 A）**：投递时 source 改为 `{ kind: 'plugin', plugin: SESSION_TEAMS_PLUGIN, form: 'relay', ... }`（或注册专属 kind `'session-teams'`）。权威判定回归裸约定——human = `kind === 'user'`，relay = 自己的 kind，无需排除清单、无 fail-open 面，也与 agent-budget 等官方风格插件天然兼容。渲染上把现有的 `WindowRelayMessage` 装饰从 user/steering 节点改挂到 `context` 节点（同一套 slot 装饰机制，`client/index.ts:51`），视觉体验可以保留；模型可见内容不变（仍是 user-role 消息，kind 只影响归属）。方案 B（折中）：保持 user 外形，把 `sessionTeams` claim 排除清单上升为生态共识并同步给 agent-budget 等插件——脆弱但零迁移成本。

### 低：逻辑与健壮性

1. **任务上报先于投递，失败时副作用已发生**（`index.ts:592-619`）。`recordTeamTaskReport`（含后续任务的调度派发）在 `deliverWindowMessage` 之前执行；若随后向 leader 的投递失败，工具返回 `rejected`，但任务已置为 completed、依赖任务可能已派发，成员重试只会得到 `task-completed`。最终状态自洽，但"rejected 却有副作用"对模型有误导。建议调换顺序（先投递成功再落库），或在 rejected 的 message 中说明状态已记录。
2. **不可达防御代码**（`index.ts:555-559`）。reportsTask 分支中 `taskAssignment === undefined` 的检查不可能触发（前面 `targetRelay === undefined` 已拦截）。无害，可删。
3. **同 turn 多个 relay 只有最新来源可回复**（`authority.ts:52`）。`currentWindowRelay` 只扫描当前 turn 且取最新；若一个 turn 内投递了两个不同来源的 relay（steer 在最近 step 插入时可能发生），较早来源在该 turn 及后续 turn 都无法被回复（旧 turn 的 relay 不再可见），直到有直接用户消息。若属有意的严格设计，建议在注释中说明。
4. **relay 回复的标题校验可能误拒**（`index.ts:548`）。冷恢复的无标题会话（`title === undefined`）在模型按 relay 中的历史 sourceName 传入 `target_name` 时被 `relay-target-denied` 拒绝。fail-closed 可接受，但错误信息可以提示"标题已变更，可改用 target_link"。
5. **`tasks` 与 shorthand 同时提供时报错信息误导**（`index.ts:1252-1265`）。member 同时给 `tasks` 和 `task` 等 shorthand 字段时，该成员被归一化为 0 个任务，最终报 `invalid-member`（"needs at least one task"）而非"两种写法互斥"。建议在 normalize 阶段显式拒绝并说明原因。

### 低：工程与仓库卫生

6. **遗留旧包名 tarball**。仓库根目录的 `vibeinging-dsh-window-link-0.1.0.tgz` 是改名前的产物，`.gitignore` 已排除 `*.tgz`，建议直接删除以免误发布或误引用。
7. **declarationMap 未随包发布**。tsconfig 开启 `declarationMap`，但 `package.json` 的 `files` 只含 `lib/types/**/*.d.ts`，`.d.ts.map` 不进 tarball，消费者的"跳转到源码"会断。建议把 map 加入 `files` 或关闭 declarationMap。
8. **`.impeccable.md` 语境过期**。仍是 window-link 时代的设计描述（"Invite another window"、"Show who is connected"），与当前无连接态设计矛盾，建议更新。
9. **改名中间态未定型**。工作区存在大量 window-link → session-teams 的未提交变更（删除旧文档、修改 README/构建产物），且 `lib/` 构建产物被 git 跟踪。建议尽快提交定型；长期看构建产物不入库更干净。
10. **`recordTeamTaskReport` 内 `scheduler.run` 未包裹**。调度器若在此时抛错（如状态损坏导致 zod 校验失败），会以工具异常而非结构化 rejected 结果呈现，属于边缘情况。

### 信息级观察

- `directory.resolve/listFor` 每次都触发全量 `listSnapshots`（revision 缓存复用 inspect 结果），会话数量大时有成本，当前规模可接受。
- 冷会话唤醒失败无负缓存，目标持续不可用时会重复尝试唤醒，节流依赖模型自律。
- `restoreTeam` 只对仍在目录中的成员做 workspace attach（`index.ts:1119`），对已消失成员保守跳过，行为正确。
- DeliveryLedger 为进程内去重，重启后相同 `message_id` 会重复投递——README 已明确声明该限制。

## 结论

代码质量、测试与文档均处于可发布水平。唯一建议在发布前认真考虑的是"直接人类授权"的判定边界（中等问题）；其余均为低优先级的打磨项，不阻塞发布。

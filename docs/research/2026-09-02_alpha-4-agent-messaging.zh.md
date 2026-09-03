# DSH alpha.4 Agent 消息机制调研

[English](2026-09-02_alpha-4-agent-messaging.md) | 中文

本文把官方 `dsh-v0.1.2-alpha.4` 的准确 tag（提交 `4e84901`）与 `@vibeinging/dsh-session-teams` 的消息模型进行对照。依据是该 tag 下的[控制工具源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.4/packages/subagent/tool-subagent-control/src/index.ts)、[继续执行管理器源码](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.4/packages/subagent/subagent/src/continuation.ts)和[设计记录](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.4/.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md)，不是后来 `master` 上的行为。

## 官方行为

- 父级发给直接子级，以及驻留子级回给直接父级，都使用同一个 `send_message`。模型参数只有 `agent_id` 和 `message`。
- 模型发出的消息使用 Steer。目标正在工作时，会在最近一步收到消息；目标空闲时，会开始一轮。Agent 收件箱是唯一队列。
- 投递只返回收件箱接受的 `messageId`，不会等待或收集目标回答。回复就是另一次 `send_message` 调用。
- 子级提示词要求它在结束前发送完整结果，也允许提前发送有用进展，并明确发送消息不会结束当前这一轮。
- 运行时结算与模型消息分开。子级正常结束、被停止、空间耗尽、拒绝或失败后，父级会收到由运行时生成的通知。
- 权限放在服务边界。只有准确在线的 Agent 才能给允许的相邻 Agent 发消息；消息来源字段只记录归属，不授予权限。

官方消息参数没有回复开关、往返计数或最大跳数。是否继续沟通由模型和 Agent 生命周期决定。

## session-teams 已采用

- `send_window_message` 继续作为唯一的消息和结果通道，不再提供单独的任务更新工具。
- 模型发出的窗口消息改用 `agent.steer()`。自动调度的团队任务仍使用 `agent.followup()`，因为每个任务需要单独开启一轮。
- 当前 v4 信封不再包含回复开关或跳数。持久保存的 session-teams v3 和 window-link v3 信封仍能读取，但旧计数不会限制新的回复。
- 每次成功发送只表示收件箱接受，不表示任务完成。成员仍通过同一个工具发送完整最终结果，只有结果需要推进团队依赖时才附带 `task_outcome`。
- 可信回复仍固定到准确的来源会话。持久字段不能把回复改投给另一个窗口。

插件现在面向对应的公开 alpha.4 SDK，使用 `Session.snapshotEvents()`、模型消息的 `agent.steer()` 投递，以及会替换旧内容的插件状态快照。它不导入官方源码，也不依赖私有服务。

## 有意保留的区别

- 会话团队成员是普通顶层对话，彼此平等。因此插件使用可见对话目录，不套用父子相邻限制或子 Agent Activation 所有权。
- 插件不增加 `interrupt_agent`。只要 DSH 没有删除对话，该窗口就保持可用，也没有断开操作。
- 团队依赖状态需要明确的成功或失败结果。`task_outcome` 是 `send_window_message` 上的结构化信息，不是第二条沟通通道。
- 如果成员还没来得及发送结果就失败，插件目前不会自动生成运行时结算通知。当前正常完成依赖任务提示词，自动观察终止状态属于单独的后续工作。

## 结论

alpha.4 的设计支持用户想要的对话模型：消息可以持续、双向、异步，并且只通过一个工具处理。适合普通窗口协作的部分已经采用，没有照搬只适用于子 Agent 的生命周期控制。

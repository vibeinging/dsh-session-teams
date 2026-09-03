# DSH alpha.4 Agent messaging review

English | [中文](2026-09-02_alpha-4-agent-messaging.zh.md)

This review compares the exact official `dsh-v0.1.2-alpha.4` tag at commit `4e84901` with the messaging model in `@vibeinging/dsh-session-teams`. It uses the [tagged control tool](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.4/packages/subagent/tool-subagent-control/src/index.ts), [tagged continuation manager](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.4/packages/subagent/subagent/src/continuation.ts), and [tagged design note](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.4/.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md), rather than later `master` behavior.

## Official behavior

- One `send_message` tool serves both parent-to-direct-child and resident-child-to-direct-parent communication. Its model schema contains only `agent_id` and `message`.
- Model-authored messages use Steer. A working target receives the message at its nearest step boundary; an idle target starts a turn. The Agent inbox remains the only queue.
- Delivery returns only the accepted inbox `messageId`. It does not wait for or collect the target's answer. A reply is another `send_message` call.
- The child prompt asks for a self-contained result before finishing, permits earlier useful updates, and states that sending a message does not end the current turn.
- Runtime settlement is separate from model-authored communication. The parent receives a runtime-owned notice after the child finishes, stops, runs out of room, declines, or fails.
- Authority belongs to the service boundary. The exact live Agent may address only an allowed adjacent Agent; message source fields record attribution but do not grant permission.

The official message schema has no reply switch, round-trip counter, or maximum-hop setting. The model and Agent lifecycle decide whether more communication is useful.

## Adopted in session-teams

- `send_window_message` remains the only message and result channel. There is no separate task-update tool.
- Model-authored window messages now use `agent.steer()`. Automatically scheduled team assignments still use `agent.followup()` because each assignment is a distinct task turn.
- The current v4 envelope has no reply switch or hop fields. Durable session-teams v3 and window-link v3 envelopes remain readable, but their old counters do not limit a new reply.
- Every accepted send reports inbox acceptance, not task completion. A member sends a self-contained final result through the same tool and adds `task_outcome` only when the result settles a team dependency.
- Trusted reply routing remains fixed to the exact source session. Durable fields cannot redirect a reply to another window.

The package now targets the matching public alpha.4 SDK. It uses `Session.snapshotEvents()`, model-authored `agent.steer()` delivery, and plugin-source state snapshots with surface replacement. It does not import official source or depend on a private service.

## Deliberate differences

- Session-team members are ordinary top-level conversations and peers. The plugin therefore uses the visible conversation directory instead of enforcing parent-child adjacency or subagent Activation ownership.
- The plugin does not add `interrupt_agent`. A window remains available until DSH removes the conversation, and there is no disconnect action.
- Team dependency state needs an explicit successful or failed outcome. `task_outcome` is structured metadata on `send_window_message`, not a second communication path.
- The plugin does not yet synthesize a runtime settlement notice when a member fails before it can send a result. The current contract relies on the assignment prompt for normal completion and leaves automatic terminal observation as separate work.

## Result

The alpha.4 design supports the user's desired conversation model: messages are open-ended, bidirectional, asynchronous, and handled through one tool. The parts that improve ordinary window collaboration are adopted without copying subagent-only lifecycle controls.

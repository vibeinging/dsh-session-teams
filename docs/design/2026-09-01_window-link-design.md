# DSH window-link design

English | [中文](2026-09-01_window-link-design.zh.md)

This reference defines the protocol, authority, delivery, and browser boundaries owned by `@vibeinging/dsh-window-link`.

## Scope

The plugin addresses ordinary conversation sessions that are active in one DSH Host process. It exposes one browser action that copies the current session link and one model-facing tool that queues a task in a different active session. It does not create a shared database, broker, remote network service, or DSH source patch.

## Link and envelope protocol

The canonical link is `dsh://session/<percent-encoded-session-id>`. The parser also reads the compatible `?v=1` suffix, but serialization omits it. The parser rejects credentials, extra path segments, fragments, other query strings, control characters, whitespace, path separators, malformed percent encoding, and decoded ids longer than 512 characters.

The target receives one user-role text message beginning with `[dsh-window-link/v1]`. The envelope records `message-id`, `source-link`, `target-link`, the queue-only delivery meaning, the no-relay rule, and the task text. The version marker makes the model-visible input reconstructable from the target session log and gives later protocol versions an explicit discriminator.

## Authority

The tool reads the calling agent's authoritative event log. It finds the newest `step/start` and considers only `user/message` events after that boundary whose `source.kind` is `user`. The requested target session id must match a complete link parsed from those text blocks.

This rule grants one target only for the current step. Older messages, plugin-generated context, partial ids, and links invented by the model do not grant delivery. Any current direct message containing `[dsh-window-link/v1]` denies delivery, which prevents a target agent from using the forwarded envelope as authority to relay the task.

The caller must be an agent-owned ordinary session. The destination must be a different ordinary session. The tool rejects agentless calls, self-targets, subagent sources, and subagent targets.

## Delivery and duplicate suppression

The plugin resolves the destination through the official `AgentRegistry`. A missing entry is a definite `target-not-active` rejection. For an active ordinary target, `agent.followup()` synchronously accepts the identified user message into the target inbox and wakes its driver.

The `accepted` tool result means the queue boundary returned without throwing. It says nothing about when the target turn starts, whether the model succeeds, or whether the requested work completes.

Each call carries `message_id`; the tool creates one when the model omits it. `DeliveryLedger` stores the first promise for each id and exact target-task fingerprint. Exact duplicates share the first result, while changed content under the same id is rejected. The bounded ledger evicts completed receipts and rejects new ids rather than evicting in-flight work. It is process-local and clears on plugin disposal.

## Browser integration

The browser entry registers in `conversation.session.header.actions` and receives `sessionId` from the standard session slot props. Its user-facing action is **Talk to another window**. It serializes the canonical link, writes it through the browser Clipboard API with an `execCommand('copy')` fallback, and then tells the user to paste it into another window. Its CSS and link icon are bundled into `lib/client.js`; the browser artifact imports only React at runtime.

## SDK and package boundary

The package targets DSH `0.1.2-alpha.3`. Its DSH feature peers use that version; Cordis `4.0.2`, Cordis Loader `1.0.3`, and Schemastery `3.18.2` are the official compatible foundation releases. The alpha.3 client entry uses the Cordis client context and `dsh.client` package metadata. No runtime or TypeScript path resolves through a DSH source checkout.

## Current limit

Cold-session delivery is outside this version. Resuming or routing an inactive session needs durable ownership and lifecycle rules beyond the live `AgentRegistry`. The plugin keeps the active-window contract instead of adding a second persistence and routing system.

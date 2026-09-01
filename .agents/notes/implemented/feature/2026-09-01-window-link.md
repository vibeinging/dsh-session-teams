# Agent Note: Consent-gated cross-window task links

Status: implemented

English | [中文](2026-09-01-window-link.zh.md)

## Problem

An ordinary DSH window needs a compact address that a user can copy into another window, so the second window can delegate a task back to the first. A bare session id or model-invented address would make prompt content an unbounded authority, while a separate broker would duplicate the Host's live agent registry and inbox lifecycle.

## Decision

`@vibeinging/dsh-window-link` is an independent plugin packaged for public NPM distribution. The browser action copies `dsh://session/<session-id>`, and the `send_window_task` tool accepts a destination only when that complete link occurs in the current step's direct user message. The plugin uses the official NPM SDK, mounts through `cordis.patch.yml`, and neither forks nor modifies DSH source.

The plugin addresses ordinary sessions active in one Host process. It resolves the destination through `AgentRegistry` and calls `agent.followup()` with a versioned user-role envelope. Tool success means queue acceptance, not execution or completion.

The browser action first tries `navigator.clipboard.writeText()`. An unavailable or rejected Clipboard API falls through to a temporary off-screen textarea and `document.execCommand('copy')`; only both paths failing reports failure. This keeps the action usable when an Electron embedded page denies the modern API but permits document copy.

## Security boundary

Authority comes from current-step session events, not from tool arguments alone. Only direct `source.kind === 'user'` messages after the newest `step/start` count. Plugin context, earlier turns or steps, partial ids, and model-generated links grant nothing.

The forwarded envelope begins with `[dsh-window-link/v1]`. Its presence in the current direct message denies a new delivery, so a receiving agent cannot relay authority from the forwarded task. Agentless calls, self-targets, and subagent sources or targets are also rejected.

## Duplicate contract

Every delivery has a `message_id`. A bounded process-local ledger shares the first promise for an exact duplicate and rejects reuse for changed target-task content. It retains pending entries, evicts completed receipts when capacity is needed, and clears on plugin disposal. The id is an audit and same-process duplicate key; it is not a durable cross-restart receipt.

## Alternatives considered

**Fork an existing link plugin.** Rejected because the plugin must remain independently owned, and the available link-only implementation provides copy and snapshot behavior rather than a DSH tool, current-turn authority, delivery receipts, or Cordis disposal. The public `dsh://session/<session-id>` shape remains compatible without inheriting that codebase.

**Add a broker, SQLite queue, or polling service.** Rejected because active sessions already have an authoritative registry and inbox. A second queue would introduce synchronization, cleanup, and trust boundaries without improving the same-Host use case.

**Accept any target supplied by the model.** Rejected because model context can contain untrusted or stale links. Requiring the complete link in the current direct user message makes each delivery an explicit, narrow grant.

**Resume cold sessions.** Deferred because inactive-session delivery needs durable ownership, resume, and routing rules that the live `AgentRegistry` does not provide. A second queue or source-checkout dependency is not an acceptable substitute for that lifecycle boundary.

## Verification

Focused tests pin strict parsing, current-step authority, plugin-context exclusion, relay denial, ordinary-session checks, queue wording, duplicate sharing and conflicts, browser Clipboard rejection fallback, and final copy failure feedback. A real Cordis Loader composition assembles the DSH `0.1.2-alpha.3` `SystemPrompt`, `ToolRegistry`, `AgentRegistry`, and the plugin, then verifies the registered `send_window_task` schema. The public package runs its full check through `prepublishOnly`; the host and browser builds and the audited package contents contain no DSH source-checkout path or local dependency protocol.

## Consequences

The user gets a short visible flow: copy the target link, paste it with a task, and let the source agent call one tool. The authority is explicit and cannot automatically propagate through forwarded messages.

Only active ordinary sessions in one Host process are reachable. Inactive or remote windows are definitely rejected, receipts reset with the process, and target completion requires a separate reply or status design. A future cold-session implementation needs an official durable ownership and routing seam; it does not require widening the link or authority protocol.

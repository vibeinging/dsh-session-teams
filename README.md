# dsh-window-link

English | [中文](README.zh.md)

`@vibeinging/dsh-window-link` lets one active DSH conversation window queue a task in another active conversation window on the same Host process. It is an independent plugin built only on official NPM SDK packages; it is not a fork and does not modify DSH source.

## What it adds

- A conversation-header action named **Talk to another window** that copies the current session as `dsh://session/<session-id>`.
- A model-facing `send_window_task` tool that queues a task in the linked window.
- Current-message consent checks, relay denial, self-target denial, and process-local duplicate suppression.
- Stable `accepted` and `rejected` receipts. Acceptance means queue admission, not task completion.

## Requirements

- DSH `0.1.2-alpha.3` with the `web` profile, or a custom profile that provides `tools`, `agents`, the Web client runtime, locale support, and the conversation UI.
- Node.js `^22.19.0` or `>=24.0.0` and pnpm `11.7.0` for development.
- NPM access to the public package and its official `@deepseek-ai/*` SDK dependencies.

## Install

Install the published package into each profile that should expose the action and tool. `-w` is required because a DSH profile is a pnpm workspace root:

```sh
dsh plugin --profile web add -w @vibeinging/dsh-window-link@0.0.1
```

Inspect the composed configuration before starting the profile; it must contain the `window-link` entry:

```sh
dsh --profile web --dump-config
dsh --profile web
```

Remove the bundle and its profile dependency with:

```sh
dsh plugin --profile web remove -w @vibeinging/dsh-window-link
```

## Use

1. In the target window, select **Talk to another window** in the conversation header. The action copies `dsh://session/<session-id>` and prompts you to paste it into another window.
2. Paste the complete link into a direct message in the source window and describe the task.
3. The model calls `send_window_task`. An `accepted` result means the target window queued the task for its next turn; it does not mean the task completed.

Example source prompt:

```text
Send the release-check task to dsh://session/session-example. Ask it to run the focused tests and report the failures.
```

The copied link is a capability that names one target session. It is not a network endpoint and does not expose the conversation transcript.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| `maxTaskChars` | `20000` | Largest task text accepted by the tool. |
| `maxRememberedMessages` | `1024` | Process-local message receipts retained for duplicate suppression. |
| `requestTimeoutMs` | `30000` | Tool execution and cancellation budget in milliseconds. |

All values must be positive safe integers. Misconfiguration fails when the plugin loads.

## Security and delivery contract

- The target link must occur in a direct user message entered into the currently executing step. A link from plugin-generated context or an earlier step grants nothing.
- A forwarded message starts with `[dsh-window-link/v1]`. That marker blocks relay, even when the forwarded task contains another valid link.
- Both source and target must be ordinary conversation sessions. Self-targets and subagent sessions are rejected.
- Delivery uses the official live `AgentRegistry` and `agent.followup()` boundary. An inactive target is rejected as `target-not-active`; this version does not resume a cold session.
- `message_id` suppresses an exact duplicate within one Host process. Reusing the id for different content is rejected. Receipts do not survive a Host restart.
- The result reports queue acceptance, never target execution or completion. Completion requires a separate reply or status protocol.

The detailed mechanism and trade-offs live in the [design reference](docs/design/2026-09-01_window-link-design.md) and [Agent Note](.agents/notes/implemented/feature/2026-09-01-window-link.md).

## Compatibility and limits

This release targets DSH `0.1.2-alpha.3`. DSH feature SDKs use that exact alpha version; the foundation packages use their official compatible releases: `@deepseek-ai/cordis@4.0.2`, `@deepseek-ai/cordis-plugin-loader@1.0.3`, and `@deepseek-ai/schemastery@3.18.2`. The package contains no source-checkout path or local dependency protocol.

Only active ordinary sessions in the same Host process are reachable. Inactive, cold, remote, self, and subagent sessions are rejected. Queue acceptance does not prove that the target task completed.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` runs repository and bilingual-document rules, lint, strict type checking, tests, production builds, runtime smoke checks, and an `npm pack --dry-run` content audit. `npm publish` invokes the same gate through `prepublishOnly`. The tests cover link parsing, current-step authorization, relay denial, duplicate suppression, active-window delivery, tool behavior, and the browser action; the Loader composition test uses the real Cordis loader, `ToolRegistry`, `AgentRegistry`, and `SystemPrompt` services.

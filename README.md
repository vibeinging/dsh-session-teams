# dsh-session-teams

English | [中文](README.zh.md)

`@vibeinging/dsh-session-teams` lets one DSH conversation talk to every other ordinary conversation visible in the standard conversation list. There is no connection state: a visible conversation remains addressable by title, whether it is working, idle, closed, or restored after a Host restart. The plugin can also create several named role windows and let the current window lead them as a small Agent Team.

<video src="assets/window-team-demo.mp4" controls muted></video>

*[Watch the 70-second demo](assets/window-team-demo.mp4): one leader window creates two counting windows, tasks dispatch and relay automatically, and every report returns as a real message.*

It is an independent plugin built only on official NPM SDK packages. It is not a fork and does not modify DSH source.

## What it adds

- A compact **Window collaboration** header action. Select a member or another conversation to place its name in the current composer and continue typing. A leader sees the team goal, completion progress, roles, and task states first; other ordinary conversations remain in a secondary expandable list.
- `list_conversation_windows`, which refreshes the model's view of available conversations.
- `send_window_message`, which sends a task, question, progress update, or result by exact displayed title. The receiver sees a compact message card whose source title opens the sending conversation. A cold persisted conversation resumes automatically before delivery.
- `create_window_team`, which creates missing top-level conversation windows, reuses unique exact-title conversations, and accepts either one-task shorthand or a complete per-member task graph in one call.
- `list_window_team`, `add_window_task`, and `reassign_window_task` for progress queries, new work, and manual transfer of remaining work. Members report final results through `send_window_message` as part of the same conversation.
- Automatic dispatch after dependencies complete. Temporary delivery failures retry within a small bound; failed tests, unclear requirements, and unacceptable output return to the leader.
- Process-local duplicate suppression, exact-title ambiguity checks, source-locked replies, and stable inbox receipts.

There are deliberately no `connect_window` or `disconnect_window` tools. A conversation cannot make itself unreachable by removing a one-sided relation. If the user says “do not talk to the test window,” that instruction stays in the conversation context; it does not delete the conversation from the directory.

An `accepted` receipt means the target inbox accepted the message. It does not prove that the target completed the requested work.

## Requirements

- DSH `0.1.2-rc.1` with the `web` profile, or a custom profile that provides `tools`, `agents`, `sessionController`, `sessionPersistence`, `sessionProjections`, `workspaceRegistry`, the optional `systemPrompt`, and the standard Web conversation UI.
- Node.js `^22.19.0` or `>=24.0.0` and pnpm `11.7.0` for development.
- NPM access to this package and the official `@deepseek-ai/*` SDK packages.

## Install

Install the package into each profile that should expose the action and tools. `-w` is required because a DSH profile is a pnpm workspace root:

```sh
dsh plugin --profile web add -w @vibeinging/dsh-session-teams@0.1.0
```

Inspect the composed configuration before starting the profile; it must contain the `session-teams` entry:

```sh
dsh --profile web --dump-config
dsh --profile web
```

Remove the plugin bundle with:

```sh
dsh plugin --profile web remove -w @vibeinging/dsh-session-teams
```

Removing the package does not delete DSH conversations.

## Use existing conversations

Without a team, open the header action to see every conversation that can receive a message. A working window and an available window are equally addressable. Select a row to close the panel and put `Tell “window name”: ` before the current draft; the composer keeps focus so the request can be completed and sent normally. The same interaction is available on role-window rows inside a team.

Ask naturally with the displayed title:

```text
Ask the test window to check the release and send the result back here.
```

The model calls `send_window_message` with `target_name: "test window"`. The user does not need to copy a link or provide a session ID. If more than one conversation has the exact same title, the tool rejects the request instead of guessing. A `dsh://session/...` link remains an optional exact selector for internal routing and compatibility, not a grant or relation.

Each receiving window decides whether another message helps. It can ask a question, report progress, return a result, or stop without a separate reply switch or reply counter. Replies remain locked to the exact source. Sending a message does not end the sender's current turn.

In a received message card, select the source title after **From** to open that exact conversation. The card shows only the message body; routing still uses the durable source session ID, so a renamed title cannot send the click to the wrong conversation. If the source is no longer in the standard list, its saved title remains visible without a broken navigation action.

![Ask the counting window to compute 1 + 2 and receive its reply as a compact card from the exact source](assets/cross-window-message.png)

*Select a member and the composer drafts to that exact window; the reply returns as a compact card that opens the exact source.*

## Create an Agent Team

Ask the current window to act as the leader and create role windows:

```text
Create two windows. Name one Development and let it implement the feature. Name the other Testing and let it verify the result. You are the product lead and coordinate the work until the requirement is complete.
```

![The leader opens the window team panel: shared goal, 13 / 13 progress, member roles, and completed task states](assets/team-panel.png)

The model submits every task it already knows in `members[].tasks` during the same `create_window_team` call, so the plugin can validate and store the complete dependency graph before dispatch. A unique existing conversation with the exact requested title is reused; only missing titles create new ordinary top-level DSH conversations. New conversations go through the official Session Controller, which assembles the complete Agent preset instead of copying a list of tool names. They use the leader's Workspace, current working directory, selected provider, model, and explicit reasoning effort. In DSH Desktop, the optional parent ProductHost reports whether the leader belongs to an App project or ordinary DSH. A product-bound leader asks the parent to create the App Session and authorized project binding before the plugin resolves the DSH Agent; a DSH-only leader creates the conversation through the Session Controller. Both paths produce standard visible DSH conversations with the normal preset, while only product-bound conversations receive project permissions. If Testing depends on Development, its task remains Waiting until Development replies through `send_window_message` with `task_outcome: "completed"`; the newest trusted assignment in Development's durable history supplies the task id, even after ordinary reminders or later turns, and the scheduler dispatches Testing automatically. Progress and questions use the same tool without `task_outcome`. The leader can later say “ask Development to revise the implementation” or “move the failed task to Testing” without handling IDs.

![Member windows report counts and final results back to the leader as real messages](assets/member-reports.png)

Team state is stored as complete log-only `team/task` records in the leader Session and displayed through the official Session Projection. Each mutation appends a higher revision without entering or replacing the model-visible surface, so request-series and prompt-cache prefixes remain stable. Earlier plugin-source snapshots remain readable and are not rewritten. The panel presents Waiting, Ready, Sending, Working, Complete, and Needs help states. When a leader Session resumes, the plugin idempotently restores every known team member to the leader's Workspace; a task interrupted while being sent returns to schedulable work.

Failures have two classes. Technical failures such as timeouts, process interruption, or temporary target unavailability may retry within `maxTaskAttempts`; failed tests, unclear requirements, and unacceptable output are work failures and do not retry automatically. `reassign_window_task` requires a direct user request and does not duplicate running or completed work.

Team creation is intentionally non-destructive across members. A reused conversation is never renamed or disposed. Multiple existing conversations with the same requested title reject the whole request before any side effect. If provisioning one member fails, the tool returns that failure and keeps every ordinary conversation already created or reused, so it never tries to delete a parent-owned App Session or damage persisted history.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| `maxTaskChars` | `20000` | Largest message, team goal, or individual team task accepted by the tools. |
| `maxRememberedMessages` | `1024` | Process-local receipts retained for duplicate suppression. |
| `requestTimeoutMs` | `30000` | Tool execution and cancellation budget in milliseconds. |
| `maxTeamMembers` | `8` | Largest role-window team created by one tool call. |
| `maxTeamTasks` | `64` | Largest number of tasks retained by one team. |
| `maxTaskAttempts` | `2` | Largest number of technical attempts for one task. |
| `taskRetryDelayMs` | `1000` | Delay in milliseconds before retrying a temporary delivery failure. |
| `maxDirectoryEntries` | `32` | Largest conversation list placed directly in model context. The list tool can return the full current set. |

All values must be positive safe integers. Misconfiguration fails when the plugin loads.

## Routing and safety contract

- The official `SessionPersistence` list is the durable directory. Live `AgentRegistry` entries provide current working state. The plugin stores no connection graph.
- Every ordinary top-level conversation visible to the same Host is listed and addressable. Self-targets, subagent sessions, unknown titles, and duplicate titles are rejected.
- A cold persisted target is resumed through the official Session Controller, which rebuilds the target's own complete preset, tools, system prompt, permissions, and selected model route. Newly created members first receive the leader's exact active provider, model, and explicit reasoning effort through the same controller.
- Model-authored messages are one durable `user/message` with a user-shaped source, so the standard Chat shows a first-class bubble; the current official Chat folds non-user context nodes into its collapsed turn-process region, which would hide a relay. Direct-human authorization applies the official human-source rule: a user-kind source counts as a human request only when its fields stay within the official vocabulary of `kind`, the browser prompt correlation `rpcId`, and the Host-validated `clientTimeZone`, so this plugin's relays and any other plugin's metadata-carrying user-shaped messages never grant human authority. Consumers that gate on human authority should apply the same human-source rule. The client recognizes fully valid plugin-owned `sessionTeams` metadata, removes the duplicated title from the visible body, and renders a compact source header that opens the exact source through the official Session Controller. Task-less deliveries append a fixed reply contract that teaches the receiving model to answer through `send_window_message` without `target_name`; the parser strips it and the card hides it, so the visible message stays verbatim. Other user messages retain the built-in Chat renderer. Routing accepts only a fully valid source with matching visible attribution; malformed claims fail closed. `agent.steer()` delivers at the nearest step for a working target or starts a turn for an idle target; automatically scheduled team tasks use `agent.followup()` to open a distinct task turn. The plugin adds no broker, network listener, transcript sharing, or DSH source patch.
- New relays keep the versioned `sessionTeams` source metadata. The parser also accepts the registered `window-relay` source kind written during the 0.1.0 migration window, session-teams v3 plugin-source envelopes, and the legacy window-link source and envelope so saved exchanges remain readable after migration.
- A trusted incoming relay may reply only to its exact source. The model decides whether another message helps; there is no reply counter and a reply cannot be redirected to a third conversation.
- A final team-task result routes through the newest trusted task assignment in the member's durable history. Later ordinary relays can change the current conversation reply target, but cannot erase or replace that task identity; the leader's current team state still validates the team, task, owner, and status before accepting the result.
- `create_window_team`, `add_window_task`, and `reassign_window_task` run only for a direct user request. When the requested team and work graph are already known, the model calls `create_window_team` directly with all work in `members[].tasks`; later revisions use `add_window_task` or `reassign_window_task`. Every member is an ordinary top-level conversation, not an internal subagent. The official Session Controller owns its composition and Workspace membership. In DSH Desktop, the parent reports the initiating Session's creation scope; product-bound members also receive an App Session and project binding, while DSH-only members remain ordinary visible DSH conversations.
- Namespaced records using the official `team/task` event shape in the leader Session own task state. Each record contains the complete higher-revision state, stays outside the model-visible surface, and feeds the official Session Projection; there is no custom event vocabulary or second database. The fold still reads earlier plugin-source snapshots without modifying them.
- Automatic scheduling starts only tasks whose dependencies are complete. Automatic retry covers temporary technical failures only; work failures remain in Needs help until the leader chooses a retry, revision, or transfer.
- `message_id` suppresses exact duplicates within one Host process. Reusing an id for changed content is rejected. Receipts do not survive a Host restart.

The detailed mechanism lives in the [design reference](docs/design/2026-09-01_session-teams-design.md) and [Agent Note](.agents/notes/implemented/feature/2026-09-01-session-teams.md).

## Limits

This source release targets DSH `0.1.2-rc.1`. Only ordinary persisted conversations visible to the same Host are addressable. The plugin can resume a cold conversation while the Host is running, but it does not queue messages while the Host is stopped, cross a Host boundary, or stream a transcript. A member advances dependencies by adding `task_outcome` to its final `send_window_message`; the latest trusted assignment supplies the task id, ordinary message text alone is not interpreted as task completion, and the leader still decides whether the overall result is acceptable.

## DSH Desktop

This plugin targets the standard DSH `web` profile, and the friendliest way to run that profile is our [DSH Desktop](https://github.com/vibeinging/dsh-desktop), a community-maintained desktop distribution that runs the official DeepSeek Harness runtime with conversations, files, Git, terminals, tasks, Worktrees, and a plugin market in one DSH Profile. Its website [dshdesktopstation.com](https://dshdesktopstation.com/) hosts downloads and FAQs.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` runs repository and bilingual-document rules, lint, strict type checking, focused tests, production builds, runtime smoke checks, and an `npm pack --dry-run` content audit. `npm publish` invokes the same gate through `prepublishOnly`.

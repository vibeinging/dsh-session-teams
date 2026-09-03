# DSH session-teams design

English | [中文](2026-09-01_session-teams-design.zh.md)

This reference defines the directory, routing, reply, team-task orchestration, and browser boundaries owned by `@vibeinging/dsh-session-teams`.

## Product model

The plugin treats the standard DSH conversation list as the address book. It does not create a second connect, disconnect, online, or authorization state. An ordinary conversation visible to the same Host is addressable until DSH itself removes it. Live activity changes only its displayed state and whether delivery must resume it first.

Natural-language preferences remain model context. “Do not talk to Testing again” means the leader should not send there; it does not mutate a hidden graph and cannot make the window unreachable from the other side.

## Directory

`ConversationWindowDirectory` merges two official sources. `SessionPersistence.listSnapshots()` supplies durable top-level sessions and change revisions. `AgentRegistry.list()` overlays current sessions and working state. The directory excludes the caller, subagents, and positive delegation depths; it does not hide another workspace that is already visible in the standard list.

Cold title and metadata reads use `SessionPersistence.inspect()`. Revision-equal results are reused. A single unreadable or newer-format persisted session is skipped without blocking the remaining directory, while a previously readable cached entry is retained. The latest `session/title` event provides the exact display title. Live events always override the cold cache.

`target_link` is the primary address: every listed window carries its canonical `dsh://session/...` link, and the model is taught to send to a window's link rather than by title alone, because titles can duplicate or be renamed. `target_name` remains an optional fallback that performs an exact normalized-title match, valid only while exactly one conversation has that title; a duplicate title rejects with a pointer to the target_link of the intended window. When both selectors are present, the link wins. When neither selector is present, omission is accepted only if one other conversation exists.

## Delivery and replies

An inactive persisted target resumes through `SessionController.resolveAgent()`. The controller restores the target's own selected model and performs the same Agent preset, tool, prompt, permission, and lifecycle composition as an ordinary user-opened conversation. Concurrent resumes for the same Session share one promise; a registry winner after an identity race is accepted.

Model-authored messages are one durable `user/message` with a user-shaped source. A registered non-user `window-relay` kind following the official convention was tried and rolled back: the official Chat classifies every non-user source as an injected-context node and folds those nodes into its collapsed turn-process region, so relays became invisible in ordinary conversation windows. The user-shaped source keeps a first-class Chat bubble, and the authority cost is paid explicitly: direct-human authorization applies the official human-source rule, where a user-kind source counts as a human request only when its fields stay within the official vocabulary of `kind`, the browser prompt correlation `rpcId`, and the Host-validated `clientTimeZone`, so this plugin's relays and any other producer's metadata-carrying user-shaped messages are excluded by construction. Consumers that gate on human authority should apply the same human-source rule. Its stored text contains the sending window's displayed title and exact message so the record remains understandable without this client plugin. Task-less deliveries append a fixed reply contract to that text telling the receiving model to answer through `send_window_message` without `target_name`, mirroring the stricter reporting contract task assignments already carry; the parser strips the contract and the client card hides it, so a parsed message stays exactly what the sender wrote. Plugin-owned versioned `sessionTeams` source metadata records the message and conversation ids, optional team and task ids, source and target sessions, and sender title for exact reply routing, while routing accepts only a fully valid source and matching visible attribution. A working target receives `agent.steer()` at its nearest step; an idle target starts a turn. Automatically scheduled team tasks use `agent.followup()` to open a distinct task turn. The parser also accepts the registered `window-relay` source kind written during the 0.1.0 migration window, session-teams v3 plugin-source envelopes, and the legacy `@vibeinging/dsh-window-link` source and `[dsh-window-link/message/v3]` envelope so durable exchanges remain readable.

A direct user turn may send to any directory entry. A trusted incoming relay may reply only when it targets the current session. The reply target is fixed to the original source, so it cannot redirect work to a third conversation.

The receiver decides whether a question, progress update, result, or further reply helps. There is no reply switch or reply counter, and sending a message does not end the sender's current turn. Inbox acceptance proves only that `steer()` or `followup()` returned without throwing.

`DeliveryLedger` retains the first promise for a message id and exact routing-content fingerprint. Exact retries share the first result; changed content under the same id rejects. Completed entries may be evicted, active entries are never evicted, and the ledger clears on plugin disposal.

## Window teams and task state

`create_window_team` accepts one shared goal, the current leader's role, and one to `maxTeamMembers` named member requests. Each request carries either the compatible one-task shorthand or a `tasks` array with stable ids, short titles, optional dependencies, and maximum technical attempts. The tool is available only during a direct user turn and validates the complete cross-member graph, title ambiguity, task ids, dependency references, limits, and directed acyclicity before any side effect.

A unique existing conversation with the exact requested title is resolved and reused. Multiple exact matches reject the whole request before any member is created or renamed. Only a missing title is provisioned as an ordinary top-level conversation. In a plain DSH Host, the plugin calls `SessionController.create()` with the leader's Workspace and preset, then `rename()`, `selectModel()`, and `resolveAgent()`. The selection copies the exact provider, model, and explicit reasoning effort already assembled for the leader's current request; it does not enumerate or copy individual tools. In DSH Desktop, the optional ProductHost first returns the initiating Session's `product` or `dsh` creation scope. Product-bound leaders call `productHost.conversationCreate()` so the trusted parent creates the App Session, DSH Session, Workspace membership, and project binding from its authorized identity. DSH-only leaders use the same Session Controller path as a plain Host. An older ProductHost without the scope method remains product-authoritative for compatibility. A scope error, product creation error, or invalid response fails without changing paths. The scheduler dispatches only tasks whose dependencies are complete. Each relay states the team goal, leader, role, task id, concrete instruction, and attempt count. The member uses `send_window_message` for questions, progress, and the final result; `task_outcome` is present only for a final result, while the trusted relay supplies the task id internally.

Created members are ordinary visible conversations in the leader's Workspace, not subagents. The leader can address them later through the same directory. When a leader Agent is created or resumed, the plugin folds its durable team state and idempotently attaches every known persisted member to that Workspace; this repairs membership without creating a second grouping store. A namespaced record using the official `team/task` shape carries the complete team, members, tasks, dependencies, owners, states, attempt counts, and latest results. Every mutation appends the whole state with a higher revision as a log-only event. It does not enter or replace the model-visible surface, so `replaceGeneration` and the request-series boundary remain unchanged and the model can reuse the existing prompt-cache prefix. The official Session Projection folds the same records for the browser without owning separate state. Its state version invalidates only the derived projection checkpoint when this fold format changes. The compatibility fold also reads earlier plugin-source `snapshot` messages and `window-team/state` values without rewriting or deleting them.

Task states are `blocked`, `ready`, `queued`, `running`, `completed`, and `failed`. Completing dependencies makes waiting work ready. The scheduler atomically claims ready work as queued and marks it running after delivery is accepted. Plugin reload returns an unconfirmed queued delivery to ready work; it does not silently duplicate running work.

A technical failure returns to ready while attempts remain. Automatic retry covers temporary delivery failures or a member's explicit `technical` report only; a `work` failure becomes failed immediately. `reassign_window_task` requires a direct user request, moves only blocked, ready, or failed work, resets attempts, and reschedules. Running and completed work is not duplicated.

Creation does not roll back successful siblings. A reused conversation is never renamed or disposed. A failed provisioning result is reported per member, while any normal conversation already created by the Session Controller or parent ProductHost remains persisted and available for reuse. This avoids deleting parent-owned App Sessions or breaking durable history when a later composition step fails. If a later member fails after earlier members were created or reused, the result is `partial` with one outcome per request and the successful windows remain available.

## Model context and tools

The optional `SystemPrompt` contribution lists a bounded directory snapshot with link, title, and activity. It states that every entry is directly addressable by its `target_link`, that a title is only a display name (never a safe address by itself), and that natural-language stop preferences must be honored without changing the directory. For a direct team request, it tells the model to call `create_window_team` directly, place all already-known ordered work in `members[].tasks`, and avoid planning a sequence of later `add_window_task` calls. It also states that a unique exact-title conversation is reused and an ambiguous title must be clarified. `list_conversation_windows` performs an asynchronous refresh when the cached snapshot is insufficient.

The public model tools are:

- `list_conversation_windows`
- `send_window_message`
- `create_window_team`
- `list_window_team`
- `add_window_task`
- `reassign_window_task`

There are no connect or disconnect tools.

## Browser integration

The browser entry registers in `conversation.session.header.actions` and reads the standard `useSessions` snapshot, `useInput` draft, `inputActions`, and the official `useProjection('windowTeam')`. The directory mirrors the standard sidebar visibility rules: blank, subagent-route, and archived conversations stay hidden through the `useWorkspaces` archive baseline, while the remaining conversations group by workspace directory with the current workspace first and offer title search once the list grows. Without a team, the compact two-window icon counts other listed conversations and the panel shows the current window and addressable directory. For a leader with a team, the badge counts members and the panel shows the goal, completion progress, active count, roles, and current task states first; unrelated ordinary conversations are collapsed into a secondary section. Selecting a member or directory row prefixes the current draft with that displayed title through the official `InputActions.setDraft()` boundary, closes the panel, and restores composer focus; submission remains an ordinary user message whose natural-language target is resolved by the model and `send_window_message`. The interface has no invitation, connect, disconnect, or removal action.

The browser also shadows the shipped `user`, `steering`, and `context` Chat renderers at a lower Slot priority; the context decoration keeps migration-window `window-relay` records present in the full transcript view. A wrapper accepts only a message whose durable relay source and visible attribution both pass the protocol parser; all unrelated messages render through the captured shipped component. A valid relay becomes a compact right-aligned card with a separate source header and message body. The header looks up the current source title in `useSessions` and calls the official `sessions.open(sourceSessionId)` action when selected. An absent source keeps its saved title as static text. This is a presentation-only projection: the durable message, Host delivery, model surface, and prompt-cache generation are unchanged.

The panel is positioned in the viewport layer so surrounding sidebar containers do not clip it. Outside pointer input and Escape close it; Escape restores focus, and reduced-motion preference disables the entrance animation.

## SDK and package boundary

The package targets DSH `0.1.2-alpha.4` and imports only official NPM SDK packages. It requires `tools`, `agents`, `sessionController`, `sessionPersistence`, `sessionProjections`, and `workspaceRegistry`; `systemPrompt` and the narrow ProductHost conversation creation capabilities are optional. Its team-state record uses the known alpha.4 `team/task` envelope with a plugin-namespaced selector and the official strict task shape, so the Agent Teams projection ignores it unless it owns that selector. There is no source-checkout path, DSH source patch, hardcoded tool inventory, broker, network listener, transcript bridge, custom Session event vocabulary, or second persistence store.

## Naming

The package and loader use `@vibeinging/dsh-session-teams` and `session-teams` because persistent DSH Sessions are the routing identity and one leader can coordinate several members. The browser continues to call the feature **Window collaboration** and uses plain window and team language. Legacy package and envelope identifiers are read-only compatibility inputs; new relays carry the session-teams identity.

## Current limits

Only ordinary persisted conversations visible to the same Host are addressable. A stopped Host has no offline queue. Cross-Host routing, transcript streaming, completion inference from ordinary text, automatic reassignment, and a dashboard merged across several leader Sessions remain outside this design.

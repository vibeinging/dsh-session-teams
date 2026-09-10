import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { SessionId } from "@deepseek-ai/dsh-session";
import { foldSessionTitle } from "@deepseek-ai/dsh-session-title";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { z as z$1 } from "zod";
//#region lib/types/protocol.js
/** Current package identity carried by trusted plugin messages and tool metadata. */
const SESSION_TEAMS_PLUGIN = "@vibeinging/dsh-session-teams";
/** Package identity accepted from durable messages written before the package rename. */
const LEGACY_WINDOW_LINK_PLUGIN = "@vibeinging/dsh-window-link";
/** Compatibility export for callers using the original public symbol. */
const WINDOW_LINK_PLUGIN = SESSION_TEAMS_PLUGIN;
/** Current session-team relay protocol version. */
const SESSION_TEAMS_PROTOCOL_VERSION = 4;
/** Version of the durable source metadata used by visible conversation-window messages. */
const SESSION_TEAMS_VISIBLE_RELAY_VERSION = 1;
/** Compatibility export for callers using the original public symbol. */
const WINDOW_LINK_PROTOCOL_VERSION = 4;
/** Prefix of every message sent between conversation windows. */
const SESSION_TEAMS_MESSAGE_PREFIX = "[dsh-session-teams/message/v4]";
/** Prefix accepted from durable messages written before model-directed replies. */
const LEGACY_SESSION_TEAMS_MESSAGE_PREFIX = "[dsh-session-teams/message/v3]";
/** Prefix accepted from durable messages written before the package rename. */
const LEGACY_WINDOW_MESSAGE_PREFIX = "[dsh-window-link/message/v3]";
/** Compatibility export for callers using the original public symbol. */
const WINDOW_MESSAGE_PREFIX = SESSION_TEAMS_MESSAGE_PREFIX;
/** Compatibility export for consumers of the task-only prototype. */
const FORWARDED_TASK_PREFIX = WINDOW_MESSAGE_PREFIX;
/** Maximum decoded session-id length accepted by the link parser. */
const MAX_SESSION_ID_CHARS = 512;
const LINK_PATTERN = /^dsh:\/\/session\/([A-Za-z0-9._~%-]+)(?:\?v=1)?$/u;
const LINK_SCAN_PATTERN = /dsh:\/\/session\/[A-Za-z0-9._~%-]+(?:\?v=1)?(?![!-~])/gu;
const WIRE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const TASK_ID_PATTERN$1 = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/u;
/** Accept the current package identity and the durable legacy relay identity. */
function isSessionTeamsPlugin(plugin) {
	return plugin === "@vibeinging/dsh-session-teams" || plugin === "@vibeinging/dsh-window-link";
}
/** Detect separators, ASCII whitespace, and control bytes without a control-character regex. */
function containsInvalidSessionIdCharacter(value) {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 32 || code === 127 || character === "/" || character === "\\";
	});
}
/** Why a deep link or window envelope could not be parsed. */
var WindowLinkParseError = class extends Error {
	/** Stable code suitable for tool output and tests. */
	code = "invalid-link";
	/** @param message - Plain-language reason the input was refused. */
	constructor(message) {
		super(message);
		this.name = "WindowLinkParseError";
	}
};
/** Encode one opaque session id as a strict RFC 3986 path segment. */
function encodeSegment(value) {
	return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`);
}
/** Create the optional exact selector for one DSH session. */
function serializeWindowLink(sessionId) {
	const raw = String(sessionId);
	if (raw.length === 0 || raw.length > 512 || containsInvalidSessionIdCharacter(raw)) throw new WindowLinkParseError("session id cannot be represented as a window link");
	return `dsh://session/${encodeSegment(raw)}`;
}
/** Parse a strict DSH session link. The old `?v=1` suffix remains readable. */
function parseWindowLink(input) {
	const trimmed = input.trim();
	const match = LINK_PATTERN.exec(trimmed);
	if (match?.[1] === void 0) throw new WindowLinkParseError("expected a complete dsh://session/<session-id> link");
	let decoded;
	try {
		decoded = decodeURIComponent(match[1]);
	} catch {
		throw new WindowLinkParseError("session link contains invalid percent encoding");
	}
	if (decoded.length === 0 || decoded.length > 512 || containsInvalidSessionIdCharacter(decoded)) throw new WindowLinkParseError("session link contains an invalid session id");
	return {
		sessionId: decoded,
		canonical: serializeWindowLink(decoded)
	};
}
/** Read complete DSH session links embedded in text. */
function extractWindowLinks(text) {
	const links = [];
	for (const match of text.matchAll(LINK_SCAN_PATTERN)) try {
		links.push(parseWindowLink(match[0]));
	} catch {}
	return links;
}
/** Registered relay-source kind: a message another conversation window addressed to this one. */
const WINDOW_RELAY_SOURCE_KIND = "window-relay";
/** Official semantic context form reused by the registered relay source. */
const WINDOW_RELAY_SOURCE_FORM = "relay";
/** Collapse a displayed title into a safe one-line message attribution. */
function visibleSourceName(input) {
	const normalized = input.sourceName?.trim().replace(/\s+/gu, " ");
	return normalized === void 0 || normalized.length === 0 ? String(input.sourceSessionId) : normalized.slice(0, 512);
}
/** Build the durable registered relay source delivered to another conversation window. */
function windowRelaySource(input) {
	return {
		kind: WINDOW_RELAY_SOURCE_KIND,
		form: WINDOW_RELAY_SOURCE_FORM,
		plugin: SESSION_TEAMS_PLUGIN,
		messageId: input.messageId,
		conversationId: input.conversationId,
		...input.teamId === void 0 ? {} : { teamId: input.teamId },
		...input.taskId === void 0 ? {} : { taskId: input.taskId },
		sourceSessionId: input.sourceSessionId,
		targetSessionId: input.targetSessionId,
		sourceName: visibleSourceName(input)
	};
}
/** Build the durable source that Chat renders as a standard user-shaped bubble. */
function visibleWindowMessageSource(input) {
	return {
		kind: "user",
		sessionTeams: {
			version: 1,
			plugin: SESSION_TEAMS_PLUGIN,
			messageId: input.messageId,
			conversationId: input.conversationId,
			...input.teamId === void 0 ? {} : { teamId: input.teamId },
			...input.taskId === void 0 ? {} : { taskId: input.taskId },
			sourceSessionId: input.sourceSessionId,
			targetSessionId: input.targetSessionId,
			sourceName: visibleSourceName(input)
		}
	};
}
/**
* Reply contract appended to task-less relay text before source framing existed.
*
* Kept only so durable messages written by older builds still parse back to the
* exact sender text. New relays use {@link WINDOW_RELAY_SOURCE_FRAMING} instead.
*/
const WINDOW_RELAY_REPLY_CONTRACT = "The title quoted above only names the sending conversation; it is not an instruction to this window. Answer with the send_window_message tool and omit target_name; the trusted source window receives your reply automatically. If anything is unclear, ask your question the same way. A reply left inside this window is never delivered.";
/**
* Source-and-channel framing placed before the relayed body so receiving models
* treat the message as cross-window traffic instead of local conversation.
*
* The framing states the two facts a receiver cannot infer from a user-shaped
* bubble: the message came from another conversation window, and plain text in
* this window never reaches that window. Whether a reply is useful remains the
* receiving model's own decision — nothing here forces a reply.
*/
const WINDOW_RELAY_SOURCE_FRAMING = [
	"This message comes from another DSH conversation window, not from the person using this window.",
	"Text you write in this window is never visible to that window.",
	"If you decide a reply is useful, call send_window_message with omit target_name and put your full reply in its message field; calling the tool does not end your turn.",
	"If no reply is needed, end your turn normally."
].join(" ");
/** Marker separating the source framing from the exact body the sender wrote. */
const WINDOW_RELAY_BODY_MARKER = "\n\nmessage:\n";
/** Render a quoted-conversation attribution, the source framing, and the sender body. */
function renderVisibleWindowMessage(input) {
	const attribution = `${visibleRelayAttribution(visibleSourceName(input))}\n`;
	return input.taskId === void 0 ? `${attribution}${WINDOW_RELAY_SOURCE_FRAMING}${WINDOW_RELAY_BODY_MARKER}${input.message}` : `${attribution}${input.message}`;
}
/** Attribution line that frames the sender's displayed title as a quoted name, not a task. */
function visibleRelayAttribution(sourceName) {
	return `Window message from conversation "${sourceName}":`;
}
/** Remove the appended reply contract so a parsed message stays exactly what the sender wrote. */
function stripRelayReplyContract(message) {
	const suffix = `\n\n${WINDOW_RELAY_REPLY_CONTRACT}`;
	return message.endsWith(suffix) ? message.slice(0, Math.max(0, message.length - suffix.length)) : message;
}
/**
* Recover the exact sender body from one attribution-stripped relay text.
*
* Current relays start with the source framing and must have only that framing
* removed — a sender body that happens to end with the legacy contract wording
* stays untouched. Durable legacy relays carry no framing, so they fall back to
* stripping the old appended reply contract.
*/
function stripRelaySourceFraming(body) {
	const prefix = `${WINDOW_RELAY_SOURCE_FRAMING}${WINDOW_RELAY_BODY_MARKER}`;
	if (body.startsWith(prefix)) return body.slice(prefix.length);
	return stripRelayReplyContract(body);
}
function asRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Whether a message source is a structurally valid registered window relay. */
function isWindowRelaySource(source) {
	const root = asRecord(source);
	return root?.kind === "window-relay" && root.form === "relay" && typeof root.plugin === "string" && isSessionTeamsPlugin(root.plugin) && typeof root.messageId === "string" && WIRE_ID_PATTERN.test(root.messageId) && typeof root.conversationId === "string" && WIRE_ID_PATTERN.test(root.conversationId) && (root.teamId === void 0 || typeof root.teamId === "string" && WIRE_ID_PATTERN.test(root.teamId)) && (root.taskId === void 0 || typeof root.taskId === "string" && TASK_ID_PATTERN$1.test(root.taskId)) && validatedSessionId(root.sourceSessionId) !== void 0 && validatedSessionId(root.targetSessionId) !== void 0 && typeof root.sourceName === "string" && root.sourceName.length > 0 && root.sourceName.length <= 512;
}
/** Own fields the official human user sources may carry beyond the kind. */
const HUMAN_USER_SOURCE_FIELDS = /* @__PURE__ */ new Set([
	"kind",
	"rpcId",
	"clientTimeZone"
]);
/**
* Whether a user-kind source is host-attested human input.
*
* The official human shapes are the bare `{ kind: 'user' }` prompt and the
* browser `'user-rpc'` prompt whose only extra fields are the correlation
* `rpcId` and the Host-validated `clientTimeZone`. Any other own property
* means some producer attached metadata to a user-shaped message, so it must
* never count as direct human authority regardless of which plugin wrote it.
*/
function isHumanUserSource(source) {
	const root = asRecord(source);
	return root?.kind === "user" && Object.keys(root).every((key) => HUMAN_USER_SOURCE_FIELDS.has(key)) && (root.rpcId === void 0 || typeof root.rpcId === "string") && (root.clientTimeZone === void 0 || typeof root.clientTimeZone === "string");
}
/** Rebuild trusted routing facts from one registered window-relay source and its visible text. */
function parseWindowRelayMessage(source, text) {
	if (!isWindowRelaySource(source)) return void 0;
	const body = relayBody(source.sourceName, text);
	if (body === void 0) return void 0;
	return {
		messageId: source.messageId,
		conversationId: source.conversationId,
		...source.teamId === void 0 ? {} : { teamId: source.teamId },
		...source.taskId === void 0 ? {} : { taskId: source.taskId },
		sourceSessionId: source.sourceSessionId,
		sourceName: source.sourceName,
		targetSessionId: source.targetSessionId,
		message: stripRelaySourceFraming(body)
	};
}
/** Split one relay body after the current quoted attribution or the legacy bare-title prefix. */
function relayBody(sourceName, text) {
	for (const prefix of [`${visibleRelayAttribution(sourceName)}\n`, `${sourceName}:\n`]) if (text.startsWith(prefix)) return text.slice(prefix.length);
}
/** Whether a user-shaped source claims plugin-owned window-relay attribution. */
function isWindowMessageSourceClaim(source) {
	const root = asRecord(source);
	return root?.kind === "user" && Object.hasOwn(root, "sessionTeams");
}
function validatedSessionId(value) {
	if (typeof value !== "string") return void 0;
	try {
		serializeWindowLink(value);
		return value;
	} catch {
		return;
	}
}
/** Whether a message source is a structurally valid visible window relay. */
function isVisibleWindowMessageSource(source) {
	const root = asRecord(source);
	const relay = asRecord(root?.sessionTeams);
	const sourceSessionId = validatedSessionId(relay?.sourceSessionId);
	const targetSessionId = validatedSessionId(relay?.targetSessionId);
	return root?.kind === "user" && relay?.version === 1 && relay.plugin === "@vibeinging/dsh-session-teams" && typeof relay.messageId === "string" && WIRE_ID_PATTERN.test(relay.messageId) && typeof relay.conversationId === "string" && WIRE_ID_PATTERN.test(relay.conversationId) && (relay.teamId === void 0 || typeof relay.teamId === "string" && WIRE_ID_PATTERN.test(relay.teamId)) && (relay.taskId === void 0 || typeof relay.taskId === "string" && TASK_ID_PATTERN$1.test(relay.taskId)) && sourceSessionId !== void 0 && targetSessionId !== void 0 && typeof relay.sourceName === "string" && relay.sourceName.length > 0 && relay.sourceName.length <= 512;
}
/** Rebuild trusted routing facts from one visible Chat message and its durable source. */
function parseVisibleWindowMessage(source, text) {
	if (!isVisibleWindowMessageSource(source)) return void 0;
	const relay = source.sessionTeams;
	const body = relayBody(relay.sourceName, text);
	if (body === void 0) return void 0;
	return {
		messageId: relay.messageId,
		conversationId: relay.conversationId,
		...relay.teamId === void 0 ? {} : { teamId: relay.teamId },
		...relay.taskId === void 0 ? {} : { taskId: relay.taskId },
		sourceSessionId: relay.sourceSessionId,
		sourceName: relay.sourceName,
		targetSessionId: relay.targetSessionId,
		message: stripRelaySourceFraming(body)
	};
}
/** Render one message with exact reply routing. */
function renderWindowMessage(input) {
	return [
		WINDOW_MESSAGE_PREFIX,
		`message-id: ${input.messageId}`,
		`conversation-id: ${input.conversationId}`,
		`team-id: ${input.teamId ?? "none"}`,
		`task-id: ${input.taskId ?? "none"}`,
		`source-link: ${serializeWindowLink(input.sourceSessionId)}`,
		`target-link: ${serializeWindowLink(input.targetSessionId)}`,
		"Reply rule: use send_window_message to reply to source-link when another message helps. Continue only while useful; otherwise stop. Sending a message does not end your turn.",
		"message:",
		input.message
	].join("\n");
}
/** Parse a trusted plugin relay into its routing and reply contract. */
function parseWindowMessage(text) {
	const bodyAt = text.indexOf("\nmessage:\n");
	if (bodyAt < 0) return void 0;
	const lines = text.slice(0, bodyAt).split("\n");
	const current = lines[0] === SESSION_TEAMS_MESSAGE_PREFIX;
	const legacy = lines[0] === "[dsh-session-teams/message/v3]" || lines[0] === "[dsh-window-link/message/v3]";
	if (!current && !legacy) return void 0;
	const messageId = field(lines, "message-id");
	const conversationId = field(lines, "conversation-id");
	const teamId = field(lines, "team-id");
	const taskId = field(lines, "task-id");
	const sourceLink = field(lines, "source-link");
	const targetLink = field(lines, "target-link");
	const legacyHop = legacy ? integerField(lines, "hop") : void 0;
	const legacyMaxHops = legacy ? integerField(lines, "max-hops") : void 0;
	const legacyReplyPolicy = legacy ? field(lines, "reply-expected") : void 0;
	if (messageId === void 0 || !WIRE_ID_PATTERN.test(messageId) || conversationId === void 0 || !WIRE_ID_PATTERN.test(conversationId) || teamId === void 0 || teamId !== "none" && !WIRE_ID_PATTERN.test(teamId) || taskId !== void 0 && taskId !== "none" && !TASK_ID_PATTERN$1.test(taskId) || sourceLink === void 0 || targetLink === void 0 || legacy && (legacyHop === void 0 || legacyMaxHops === void 0 || legacyMaxHops < 1 || legacyHop < 0 || legacyHop > legacyMaxHops || legacyReplyPolicy !== "yes" && legacyReplyPolicy !== "no")) return void 0;
	try {
		return {
			messageId,
			conversationId,
			...teamId === "none" ? {} : { teamId },
			...taskId === void 0 || taskId === "none" ? {} : { taskId },
			sourceSessionId: parseWindowLink(sourceLink).sessionId,
			targetSessionId: parseWindowLink(targetLink).sessionId,
			message: text.slice(bodyAt + 10)
		};
	} catch {
		return;
	}
}
/** Render a compatibility task using the current message protocol. */
function renderForwardedTask(input) {
	return renderWindowMessage({
		messageId: input.messageId,
		conversationId: input.messageId,
		sourceSessionId: input.sourceSessionId,
		targetSessionId: input.targetSessionId,
		message: input.task
	});
}
/** Read one exact `name: value` header. */
function field(lines, name) {
	const prefix = `${name}: `;
	const matches = lines.filter((line) => line.startsWith(prefix));
	if (matches.length !== 1) return void 0;
	const value = matches[0]?.slice(prefix.length);
	return value === void 0 || value.length === 0 ? void 0 : value;
}
/** Read one non-negative safe integer header. */
function integerField(lines, name) {
	const value = field(lines, name);
	if (value === void 0 || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return void 0;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : void 0;
}
//#endregion
//#region lib/types/authority.js
/** Collapse only text blocks from one model-visible user message. */
function messageText(message) {
	return message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
}
/** Find direct human messages entered into the currently executing step. */
function currentDirectMessages(events) {
	const stepStart = events.findLastIndex((event) => event.type === "step/start");
	if (stepStart < 0) return [];
	const messages = [];
	for (let index = stepStart + 1; index < events.length; index += 1) {
		const event = events[index];
		if (event?.type === "step/end") break;
		if (event?.type === "user/message" && isHumanUserSource(event.data.source)) messages.push(event.data);
	}
	return messages;
}
/** Find direct human messages admitted since the current turn began. */
function currentTurnDirectMessages(events) {
	const turnStart = events.findLastIndex((event) => event.type === "turn/start");
	if (turnStart < 0) return [];
	const messages = [];
	for (let index = turnStart + 1; index < events.length; index += 1) {
		const event = events[index];
		if (event?.type === "turn/end") break;
		if (event?.type === "user/message" && isHumanUserSource(event.data.source)) messages.push(event.data);
	}
	return messages;
}
/** Read the newest trusted window relay admitted into the current turn. */
function currentWindowRelay(events) {
	const turnStart = events.findLastIndex((event) => event.type === "turn/start");
	if (turnStart < 0) return void 0;
	for (let index = events.length - 1; index > turnStart; index -= 1) {
		const event = events[index];
		if (event === void 0) continue;
		if (event?.type === "turn/end") return void 0;
		const relay = trustedWindowRelay(event);
		if (relay !== void 0) return relay;
	}
}
/** Read the newest durable task assignment without letting ordinary relays shadow it. */
function latestTeamTaskAssignment(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event === void 0) continue;
		const relay = trustedWindowRelay(event);
		if (relay?.teamId !== void 0 && relay.taskId !== void 0) return {
			...relay,
			teamId: relay.teamId,
			taskId: relay.taskId
		};
	}
}
/** Parse one trusted registered, visible, or legacy window relay event. */
function trustedWindowRelay(event) {
	if (event.type !== "user/message") return void 0;
	const source = event.data.source;
	const registered = parseWindowRelayMessage(source, messageText(event.data));
	if (registered !== void 0) return registered;
	const visible = parseVisibleWindowMessage(source, messageText(event.data));
	if (visible !== void 0) return visible;
	if (source.kind !== "plugin" || !isSessionTeamsPlugin(source.plugin) || source.form !== "relay") return void 0;
	return parseWindowMessage(messageText(event.data));
}
//#endregion
//#region lib/types/directory.js
/** Directory-backed lookup with revision caching and deduplicated cold resumes. */
var ConversationWindowDirectory = class {
	agents;
	persistence;
	sessions;
	#cached = /* @__PURE__ */ new Map();
	#pendingResumes = /* @__PURE__ */ new Map();
	/** @param agents - Official live Agent registry. @param persistence - Official durable session store. */
	constructor(agents, persistence, sessions) {
		this.agents = agents;
		this.persistence = persistence;
		this.sessions = sessions;
	}
	/** Refresh cold metadata, reusing inspection results whose durable revision is unchanged. */
	async refresh(signal) {
		signal?.throwIfAborted();
		const snapshots = await this.persistence.list(signal === void 0 ? {} : { signal });
		const next = /* @__PURE__ */ new Map();
		await Promise.all(snapshots.map(async (snapshot) => {
			if (!isOrdinaryHeader(snapshot.header)) return;
			const current = this.#cached.get(snapshot.header.id);
			if (current?.revision === snapshot.revision) {
				next.set(snapshot.header.id, current);
				return;
			}
			try {
				const inspection = await this.sessions.inspect(snapshot.header.id, signal);
				next.set(snapshot.header.id, {
					revision: snapshot.revision,
					window: windowFromInspection(inspection, false)
				});
			} catch {
				signal?.throwIfAborted();
				if (current !== void 0) next.set(snapshot.header.id, current);
			}
		}));
		this.#cached.clear();
		for (const [sessionId, value] of next) this.#cached.set(sessionId, value);
	}
	/** List every other ordinary conversation visible to the current Host. */
	async listFor(source, signal) {
		await this.refresh(signal);
		return this.currentFor(source);
	}
	/** Read the current cached and live directory without an asynchronous persistence call. */
	currentFor(source) {
		const byId = /* @__PURE__ */ new Map();
		for (const cached of this.#cached.values()) byId.set(cached.window.sessionId, cached.window);
		for (const live of this.agents.list()) {
			if (!isOrdinaryHeader(live.session.header)) continue;
			byId.set(live.session.id, windowFromLiveAgent(live));
		}
		return [...byId.values()].filter((window) => window.sessionId !== source.session.id).sort(compareWindows);
	}
	/** Resolve a canonical link first, then a unique exact title, then the sole other window. */
	async resolve(source, selectors, signal) {
		const windows = await this.listFor(source, signal);
		let target;
		if (selectors.targetLink !== void 0) {
			let parsed;
			try {
				parsed = parseWindowLink(selectors.targetLink);
			} catch (error) {
				return failure(selectors.targetLink, "invalid-link", error instanceof Error ? error.message : "target link could not be parsed");
			}
			if (parsed.sessionId === source.session.id) return failure(parsed.canonical, "self-target", "a conversation window cannot message itself");
			target = windows.find((window) => window.sessionId === parsed.sessionId);
			if (target === void 0) return failure(parsed.canonical, "target-not-found", "that conversation is not visible to this Host");
		} else if (selectors.targetName !== void 0) {
			const name = selectors.targetName.trim();
			if (name.length === 0) return failure("", "invalid-target-name", "target_name must not be empty");
			const matches = windows.filter((window) => window.title === name);
			if (matches.length === 0) return failure("", "target-name-not-found", "no conversation has that title; use the target_link of the intended window from list_conversation_windows");
			if (matches.length > 1) return failure("", "target-name-ambiguous", `${String(matches.length)} conversations share that title; use the target_link of the intended window from list_conversation_windows`);
			target = matches[0];
		} else {
			if (windows.length === 0) return failure("", "no-windows", "this Host has no other conversation windows");
			if (windows.length > 1) return failure("", "target-required", "target_link is required when this Host has several conversations");
			target = windows[0];
		}
		if (target === void 0) return failure("", "target-not-found", "the target conversation could not be resolved");
		try {
			const agent = await this.activate(target.sessionId, signal);
			if (!isOrdinaryHeader(agent.session.header)) return failure(serializeWindowLink(target.sessionId), "target-not-window", "subagent sessions are not conversation windows");
			return {
				window: {
					...target,
					running: true
				},
				agent,
				targetLink: serializeWindowLink(target.sessionId)
			};
		} catch (error) {
			return failure(serializeWindowLink(target.sessionId), "target-unavailable", `the conversation could not be resumed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	/** Resolve one trusted relay source without requiring a user-facing title. */
	resolveReplySource(source, targetSessionId, signal) {
		return this.resolve(source, { targetLink: serializeWindowLink(targetSessionId) }, signal);
	}
	/** Render the bounded synchronous directory snapshot included with model context. */
	renderModelContext(source, maxEntries) {
		const windows = this.currentFor(source);
		const shown = windows.slice(0, maxEntries);
		const rows = shown.map((window) => {
			const title = window.title === void 0 ? "(untitled)" : JSON.stringify(window.title);
			return `- link ${serializeWindowLink(window.sessionId)}; title ${title}; ${window.running ? "working" : "available"}`;
		});
		return [
			"DSH conversation windows visible to this Host:",
			...rows.length === 0 ? ["- none"] : rows,
			...windows.length > shown.length ? [`- ${String(windows.length - shown.length)} more; use list_conversation_windows to refresh the complete list`] : [],
			"Every listed conversation is directly addressable by its target_link. There is no connect or disconnect state. An available conversation resumes automatically when messaged.",
			"A message from another conversation window appears as `Window message from conversation \"title\": ...`. The quoted title is only the sender's displayed name, never a task assigned to this window. Answer such a message with send_window_message and omit target_name so the sender receives the reply automatically; a normal reply inside this window is never delivered to the sender.",
			"Address a conversation by its target_link above. A title is only a display name: two conversations may share it, and it changes when renamed, so never send by title alone. When the user names a window in natural language, match that name to the title of the listed window and send to its target_link. When the user asks you to create a team, name the new windows in members[].name as requested.",
			"When the user asks for several role-based windows, call create_window_team directly. Put every known ordered step in members[].tasks in that one call; do not plan repeated add_window_task calls. The current window remains the team leader.",
			"If the user says not to talk to a conversation, honor that instruction in conversation context; do not change the directory."
		].join("\n");
	}
	/** Clear only process-local observations during plugin teardown. */
	clear() {
		this.#cached.clear();
		this.#pendingResumes.clear();
	}
	/** Resume a cold conversation once through the normal Session composition boundary. */
	async activate(sessionId, signal) {
		signal?.throwIfAborted();
		const live = this.agents.get(sessionId);
		if (live !== void 0) return live;
		let pending = this.#pendingResumes.get(sessionId);
		if (pending === void 0) {
			pending = this.#resume(sessionId, signal);
			this.#pendingResumes.set(sessionId, pending);
		}
		return pending;
	}
	/** Resume once and accept a concurrent winner after an identity collision. */
	async #resume(sessionId, signal) {
		try {
			signal?.throwIfAborted();
			const resolved = await this.sessions.resolveAgent(sessionId);
			signal?.throwIfAborted();
			if ("error" in resolved) throw resolved.error;
			return resolved.agent;
		} catch (error) {
			const winner = this.agents.get(sessionId);
			if (winner !== void 0) return winner;
			throw error;
		} finally {
			this.#pendingResumes.delete(sessionId);
		}
	}
};
/** Read an ordinary live conversation into the common directory shape. */
function windowFromLiveAgent(agent) {
	const events = agent.session.snapshotEvents();
	return {
		sessionId: agent.session.id,
		title: foldSessionTitle(events)?.title,
		running: agent.status === "running",
		createdAt: agent.session.header.createdAt,
		cwd: agent.session.header.cwd,
		agentOptions: readLoggedAgentOptions(events)
	};
}
/** Read the latest logged route without guessing from title or workspace metadata. */
function readLoggedAgentOptions(events) {
	const options = {};
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event?.type !== "request/context" || !isRecord(event.data)) continue;
		const provider = event.data["provider"];
		const model = event.data["model"];
		if (typeof provider === "string") options.provider = provider;
		if (typeof model === "string") options.model = model;
		break;
	}
	return options;
}
/** Read one persisted inspection into the common directory shape. */
function windowFromInspection(inspection, running) {
	return {
		sessionId: inspection.meta.id,
		title: foldSessionTitle(inspection.events)?.title,
		running,
		createdAt: inspection.meta.createdAt,
		cwd: inspection.meta.cwd,
		agentOptions: readLoggedAgentOptions(inspection.events)
	};
}
/** Only top-level product conversations belong in the window directory. */
function isOrdinaryHeader(header) {
	return header.origin !== "subagent" && (header.delegationDepth ?? 0) === 0;
}
/** Prefer visible titles, then stable creation and identity order. */
function compareWindows(left, right) {
	if (left.title !== void 0 && right.title === void 0) return -1;
	if (left.title === void 0 && right.title !== void 0) return 1;
	const titleOrder = (left.title ?? "").localeCompare(right.title ?? "");
	if (titleOrder !== 0) return titleOrder;
	if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
	return String(left.sessionId).localeCompare(String(right.sessionId));
}
/** Build one stable target refusal. */
function failure(targetLink, code, message) {
	return {
		targetLink,
		code,
		message
	};
}
/** Narrow persisted event payloads at the session-log boundary. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region lib/types/delivery.js
/** Process-local duplicate suppression keyed by caller-visible message id. */
var DeliveryLedger = class {
	maxEntries;
	#records = /* @__PURE__ */ new Map();
	/** @param maxEntries - Maximum retained pending and completed message ids. */
	constructor(maxEntries) {
		this.maxEntries = maxEntries;
	}
	/** Number of retained message ids, exposed for invariant-style tests. */
	get size() {
		return this.#records.size;
	}
	/** Forget process-local receipts during plugin disposal. */
	clear() {
		this.#records.clear();
	}
	/** Run a delivery once for one message id and exact payload. */
	run(messageId, fingerprint, targetLink, deliver) {
		const existing = this.#records.get(messageId);
		if (existing !== void 0) {
			if (existing.fingerprint === fingerprint) return existing.promise;
			return Promise.resolve({
				status: "rejected",
				messageId,
				targetLink,
				code: "message-id-conflict",
				message: "message_id was already used for a different target or message"
			});
		}
		this.#evictSettled();
		if (this.#records.size >= this.maxEntries) return Promise.resolve({
			status: "rejected",
			messageId,
			targetLink,
			code: "ledger-capacity",
			message: "too many deliveries are still pending; try again after they settle"
		});
		const record = {
			fingerprint,
			promise: Promise.resolve().then(deliver),
			settled: false
		};
		this.#records.set(messageId, record);
		record.promise.finally(() => {
			record.settled = true;
		}).catch(() => void 0);
		return record.promise;
	}
	/** Remove oldest completed receipts until a new record can fit. */
	#evictSettled() {
		if (this.#records.size < this.maxEntries) return;
		for (const [messageId, record] of this.#records) {
			if (!record.settled) continue;
			this.#records.delete(messageId);
			if (this.#records.size < this.maxEntries) return;
		}
	}
};
/** Deliver one versioned relay to one ordinary conversation window. */
async function deliverWindowMessage(options) {
	const targetLink = serializeWindowLink(options.targetSessionId);
	options.signal.throwIfAborted();
	const target = resolveTargetWindow(options.target, options.targetSessionId);
	if ("code" in target) return {
		status: "rejected",
		messageId: options.messageId,
		targetLink,
		code: target.code,
		message: target.message
	};
	try {
		const message = createUserMessage({
			content: [{
				type: "text",
				text: renderVisibleWindowMessage(options)
			}],
			source: visibleWindowMessageSource(options)
		});
		if (options.delivery === "queue") target.followup(message);
		else target.steer(message);
		return {
			status: "accepted",
			messageId: options.messageId,
			targetLink,
			code: "queued",
			message: "the conversation accepted the message and may continue when useful"
		};
	} catch (error) {
		if (options.signal.aborted) throw error;
		return {
			status: "rejected",
			messageId: options.messageId,
			targetLink,
			code: "target-unavailable",
			message: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Verify the exact live top-level Agent selected by the directory. */
function resolveTargetWindow(target, targetSessionId) {
	if (target === void 0) return {
		code: "target-not-active",
		message: "the target conversation is not active"
	};
	if (target.session.id !== targetSessionId) return {
		code: "target-mismatch",
		message: "the resolved conversation identity changed"
	};
	if (target.session.header.origin === "subagent" || (target.session.header.delegationDepth ?? 0) !== 0) return {
		code: "target-not-window",
		message: "subagent sessions are not conversation windows"
	};
	return target;
}
/** Compatibility wrapper that queues one task in an active target. */
function deliverWindowTask(options) {
	const target = options.agents.get(options.targetSessionId);
	if (target === void 0) return Promise.resolve({
		status: "rejected",
		messageId: options.messageId,
		targetLink: serializeWindowLink(options.targetSessionId),
		code: "target-not-active",
		message: "the target conversation is not active"
	});
	return deliverWindowMessage({
		target,
		sourceSessionId: options.sourceSessionId,
		sourceName: String(options.sourceSessionId),
		targetSessionId: options.targetSessionId,
		messageId: options.messageId,
		conversationId: options.messageId,
		delivery: "queue",
		message: options.task,
		signal: options.signal
	});
}
//#endregion
//#region lib/types/provisioner.js
/** Normal conversation creation through the official Session Controller and an optional product Host. */
/** Create normal conversations without copying or naming individual tool capabilities. */
var ConversationWindowProvisioner = class {
	sessions;
	productHost;
	/** @param sessions - Official owner of ordinary Session composition. @param productHost - Optional parent product creator. */
	constructor(sessions, productHost) {
		this.sessions = sessions;
		this.productHost = productHost;
	}
	/** Create, name, select the source model, and resolve one fully composed role window. */
	async create(request) {
		request.signal.throwIfAborted();
		const agentPreset = request.source.session.header.agentPreset;
		let sessionId;
		if (await this.#creationMode(request) === "dsh") {
			const proposedId = SessionId(`session-${randomUUID()}`);
			sessionId = (await this.sessions.create({
				sessionId: proposedId,
				...request.workspace === void 0 ? { cwd: request.cwd } : { workspaceId: request.workspace.id },
				...agentPreset === void 0 ? {} : { agentPreset }
			})).sessionId;
			await this.sessions.rename({
				sessionId,
				title: request.title
			});
		} else {
			const productHost = this.productHost;
			if (productHost === void 0) throw new Error("product conversation creation requires a product Host");
			const created = await productHost.conversationCreate({
				title: request.title,
				...agentPreset === void 0 ? {} : { agentPreset }
			}, {
				sessionId: request.source.session.id,
				signal: request.signal
			});
			if (typeof created.dshSessionId !== "string" || created.dshSessionId.trim().length === 0) throw new Error("the product Host created a conversation without a DSH Session id");
			sessionId = SessionId(created.dshSessionId);
		}
		const selection = currentModelSelection(request.source);
		if (selection !== void 0) await this.sessions.selectModel({
			sessionId,
			...selection
		});
		request.signal.throwIfAborted();
		const resolved = await this.sessions.resolveAgent(sessionId);
		if ("error" in resolved) throw resolved.error;
		return {
			sessionId,
			agent: resolved.agent
		};
	}
	/** Resolve the owner before creating; older product providers remain product-authoritative. */
	async #creationMode(request) {
		if (this.productHost === void 0) return "dsh";
		if (this.productHost.conversationCreateScope === void 0) return "product";
		const scope = await this.productHost.conversationCreateScope({
			sessionId: request.source.session.id,
			signal: request.signal
		});
		if (scope?.mode !== "product" && scope?.mode !== "dsh") throw new Error("the product Host returned an unknown conversation creation scope");
		return scope.mode;
	}
};
/** Narrow an optional Host service without treating its presence as authorization. */
function windowConversationHost(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const candidate = value;
	return typeof candidate.conversationCreate === "function" ? candidate : void 0;
}
/** Read the exact route already assembled for the initiating turn. */
function currentModelSelection(agent) {
	const header = agent.session.requestHeader();
	if (header !== void 0) return {
		provider: header.config.provider,
		model: header.config.model,
		...header.config.reasoningEffort === void 0 || header.adapterDefaults?.reasoningEffort === true ? {} : { reasoningEffort: header.config.reasoningEffort }
	};
	if (agent.options.provider === void 0 || agent.options.model === void 0) return void 0;
	return {
		provider: agent.options.provider,
		model: agent.options.model,
		...agent.options.reasoningEffort === void 0 ? {} : { reasoningEffort: agent.options.reasoningEffort }
	};
}
//#endregion
//#region lib/types/team-state.js
/** Durable log-only records and the official Session Projection for window teams. */
const TEAM_STATE_PLUGIN = "@vibeinging/dsh-session-teams";
const TEAM_STATE_TASK_ID = "session-teams-state";
const TEAM_STATE_SUBJECT = "DSH Session Teams state";
const TEAM_STATE_RECORD_PREFIX = "DSH Session Teams state v1\n\n";
const LEGACY_TEAM_STATE_PREFIX = "Current window team state. This snapshot supersedes earlier window-team snapshots.\n\n";
const memberSchema = z$1.object({
	sessionId: z$1.string().min(1),
	name: z$1.string().min(1),
	role: z$1.string().min(1),
	created: z$1.boolean()
}).strict();
const taskSchema = z$1.object({
	id: z$1.string().min(2).max(64),
	title: z$1.string().min(1),
	instruction: z$1.string().min(1),
	ownerSessionId: z$1.string().min(1),
	ownerName: z$1.string().min(1),
	dependsOn: z$1.array(z$1.string().min(2).max(64)),
	status: z$1.enum([
		"blocked",
		"ready",
		"queued",
		"running",
		"completed",
		"failed"
	]),
	attempts: z$1.number().int().nonnegative(),
	maxAttempts: z$1.number().int().positive(),
	note: z$1.string().nullable(),
	failureKind: z$1.enum(["technical", "work"]).nullable()
}).strict();
/** Runtime schema used by the persisted projection cache and client wire. */
const windowTeamSchema$1 = z$1.object({
	teamId: z$1.string().min(8),
	revision: z$1.number().int().positive(),
	goal: z$1.string().min(1),
	leaderSessionId: z$1.string().min(1),
	leaderName: z$1.string().min(1),
	leaderRole: z$1.string().min(1),
	members: z$1.array(memberSchema),
	tasks: z$1.array(taskSchema)
}).strict();
const nullableWindowTeamSchema = windowTeamSchema$1.nullable();
const windowTeamTaskRecordSchema = z$1.object({
	version: z$1.literal(1),
	teamId: z$1.string().min(1),
	task: z$1.object({
		id: z$1.literal(TEAM_STATE_TASK_ID),
		revision: z$1.number().int().positive(),
		subject: z$1.literal(TEAM_STATE_SUBJECT),
		description: z$1.string().startsWith(TEAM_STATE_RECORD_PREFIX),
		status: z$1.literal("in_progress"),
		blockedBy: z$1.array(z$1.string()).max(0),
		writeScopes: z$1.tuple([z$1.literal(TEAM_STATE_PLUGIN)])
	}).strict()
}).strict();
/** Official projection unit carrying a rebuildable complete team view to the browser. */
const windowTeamProjectionDefinition = {
	key: "windowTeam",
	stateVersion: 2,
	stateSchema: nullableWindowTeamSchema,
	init: () => null,
	apply: (state, event) => windowTeamFromEvent(event) ?? state,
	wire: {
		viewSchema: nullableWindowTeamSchema,
		view: (state) => state
	}
};
/** Decode one current log-only record or an earlier model-visible snapshot. */
function windowTeamFromEvent(event) {
	const record = event;
	if (record.type === "team/task") {
		const parsedRecord = windowTeamTaskRecordSchema.safeParse(record.data);
		if (!parsedRecord.success) return void 0;
		try {
			const parsed = JSON.parse(parsedRecord.data.task.description.slice(28));
			const result = windowTeamSchema$1.safeParse(parsed);
			if (!result.success || result.data.revision !== parsedRecord.data.task.revision || parsedRecord.data.teamId !== stateRecordTeamId(result.data)) return void 0;
			return result.data;
		} catch {
			return;
		}
	}
	if (event.type !== "user/message") return void 0;
	const message = event.data;
	if (message.source.kind !== "plugin" || message.source.plugin !== TEAM_STATE_PLUGIN || message.source.form !== "snapshot") return void 0;
	const [block] = message.content;
	if (message.content.length !== 1 || block?.type !== "text" || !block.text.startsWith(LEGACY_TEAM_STATE_PREFIX)) return;
	try {
		const parsed = JSON.parse(block.text.slice(84));
		const result = windowTeamSchema$1.safeParse(parsed);
		return result.success ? result.data : void 0;
	} catch {
		return;
	}
}
/** Fold the latest whole team state directly from the Session log. */
function foldWindowTeam(events) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event === void 0) continue;
		const state = windowTeamFromEvent(event);
		if (state !== void 0) return state;
		const legacy = event;
		if (legacy.type === "window-team/state") {
			const result = windowTeamSchema$1.safeParse(legacy.data);
			if (result.success) return result.data;
		}
	}
	return null;
}
/** Append one validated known event that never enters or replaces the model surface. */
function appendWindowTeamState(session, state) {
	const validated = windowTeamSchema$1.parse(state);
	const json = JSON.stringify(validated);
	session.append.bind(session)("team/task", {
		version: 1,
		teamId: stateRecordTeamId(validated),
		task: {
			id: TEAM_STATE_TASK_ID,
			revision: validated.revision,
			subject: TEAM_STATE_SUBJECT,
			description: `${TEAM_STATE_RECORD_PREFIX}${json}`,
			status: "in_progress",
			blockedBy: [],
			writeScopes: [TEAM_STATE_PLUGIN]
		}
	});
	return validated;
}
/** Keep this plugin's records outside the implicit Team rooted at the leader Session. */
function stateRecordTeamId(state) {
	return `${TEAM_STATE_PLUGIN}:${state.leaderSessionId}:${state.teamId}`;
}
/** Recompute waiting and ready tasks after a dependency or owner change. */
function refreshTaskReadiness(state) {
	const completed = new Set(state.tasks.filter((task) => task.status === "completed").map((task) => task.id));
	let changed = false;
	const tasks = state.tasks.map((task) => {
		if (task.status !== "blocked" && task.status !== "ready") return task;
		const status = task.dependsOn.every((id) => completed.has(id)) ? "ready" : "blocked";
		if (status === task.status) return task;
		changed = true;
		return {
			...task,
			status
		};
	});
	return changed ? {
		...state,
		tasks
	} : state;
}
/** Return a state replacement with one new revision and normalized dependency readiness. */
function nextWindowTeamState(state, change) {
	return refreshTaskReadiness({
		...change,
		revision: state.revision + 1
	});
}
/** Serialize mutations per leader Session so concurrent tools cannot lose updates. */
var WindowTeamCoordinator = class {
	#tails = /* @__PURE__ */ new Map();
	/** Read the current immutable state from the authoritative Session log. */
	current(session) {
		return foldWindowTeam(session.snapshotEvents());
	}
	/** Run one state operation after prior work for the same leader has settled. */
	async run(session, operation) {
		const key = String(session.id);
		const prior = this.#tails.get(key) ?? Promise.resolve();
		let resolveTail = () => void 0;
		const tail = new Promise((resolve) => {
			resolveTail = resolve;
		});
		this.#tails.set(key, tail);
		await prior.catch(() => void 0);
		try {
			return await operation();
		} finally {
			resolveTail();
			if (this.#tails.get(key) === tail) this.#tails.delete(key);
		}
	}
	/** Drop process-local serialization tails during plugin disposal. */
	clear() {
		this.#tails.clear();
	}
};
//#endregion
//#region lib/types/team-scheduler.js
/** Dependency-aware dispatch and bounded technical retry for visible window tasks. */
/** Dispatch every ready task once its dependencies complete. */
var WindowTeamScheduler = class {
	config;
	directory;
	coordinator;
	#active = /* @__PURE__ */ new Map();
	#lifetime = new AbortController();
	constructor(config, directory, coordinator) {
		this.config = config;
		this.directory = directory;
		this.coordinator = coordinator;
	}
	/** Coalesce concurrent drains for the same leader Session. */
	run(leader, signal) {
		const key = String(leader.session.id);
		const existing = this.#active.get(key);
		if (existing !== void 0) return existing;
		const operation = this.#drain(leader, signal).finally(() => this.#active.delete(key));
		this.#active.set(key, operation);
		return operation;
	}
	/** Cancel retry delays and wait for all active drains to settle. */
	async dispose() {
		this.#lifetime.abort(/* @__PURE__ */ new Error("window team scheduler disposed"));
		await Promise.allSettled(this.#active.values());
		this.#active.clear();
	}
	async #drain(leader, signal) {
		const fused = signal === void 0 ? this.#lifetime.signal : AbortSignal.any([signal, this.#lifetime.signal]);
		const started = [];
		const failed = [];
		while (!fused.aborted) {
			const claimed = await this.#claimNext(leader);
			if (claimed === void 0) break;
			const result = await this.#deliver(leader, claimed, fused);
			const disposition = await this.#settle(leader, claimed.task, result);
			if (disposition === "started") started.push(claimed.task.id);
			if (disposition === "failed") failed.push(claimed.task.id);
			if (disposition === "retry") {
				if (!await cancellableDelay(this.config.taskRetryDelayMs, fused)) break;
			}
		}
		return {
			started,
			failed
		};
	}
	async #claimNext(leader) {
		return this.coordinator.run(leader.session, () => {
			const state = this.coordinator.current(leader.session);
			if (state === null) return void 0;
			const task = state.tasks.find((candidate) => candidate.status === "ready");
			if (task === void 0) return void 0;
			const claimedTask = {
				...task,
				status: "queued",
				attempts: task.attempts + 1,
				note: null,
				failureKind: null
			};
			const next = nextWindowTeamState(state, {
				...state,
				tasks: state.tasks.map((candidate) => candidate.id === task.id ? claimedTask : candidate)
			});
			appendWindowTeamState(leader.session, next);
			return {
				state: next,
				task: claimedTask
			};
		});
	}
	async #deliver(leader, claimed, signal) {
		const targetLink = serializeWindowLink(SessionId(claimed.task.ownerSessionId));
		const resolved = await this.directory.resolve(leader, { targetLink }, signal);
		if ("code" in resolved) return {
			status: "rejected",
			messageId: `task-message-${randomUUID()}`,
			targetLink: resolved.targetLink,
			code: resolved.code,
			message: resolved.message
		};
		return deliverWindowMessage({
			target: resolved.agent,
			messageId: `task-message-${randomUUID()}`,
			conversationId: `conversation-${randomUUID()}`,
			teamId: claimed.state.teamId,
			taskId: claimed.task.id,
			sourceSessionId: leader.session.id,
			sourceName: claimed.state.leaderName,
			targetSessionId: resolved.window.sessionId,
			delivery: "queue",
			message: renderTaskAssignment(claimed.state, claimed.task),
			signal
		});
	}
	async #settle(leader, claimed, result) {
		return this.coordinator.run(leader.session, () => {
			const state = this.coordinator.current(leader.session);
			if (state === null) return "superseded";
			const current = state.tasks.find((task) => task.id === claimed.id);
			if (current === void 0 || current.status !== "queued" || current.attempts !== claimed.attempts) return "superseded";
			if (result.status === "accepted") {
				const next = replaceTask(state, {
					...current,
					status: "running",
					note: null,
					failureKind: null
				});
				appendWindowTeamState(leader.session, next);
				return "started";
			}
			const retry = retryableDeliveryCode(result.code) && current.attempts < current.maxAttempts;
			const nextTask = {
				...current,
				status: retry ? "ready" : "failed",
				note: result.message,
				failureKind: "technical"
			};
			appendWindowTeamState(leader.session, replaceTask(state, nextTask));
			return retry ? "retry" : "failed";
		});
	}
};
/** Render a self-contained task contract that reports through the normal message tool. */
function renderTaskAssignment(state, task) {
	return [
		"You are working as one visible conversation window in a DSH window team.",
		`Team goal: ${state.goal}`,
		`Leader window: ${state.leaderName}`,
		`Your window: ${task.ownerName}`,
		`Task id: ${task.id}`,
		`Task: ${task.title}`,
		`Instruction: ${task.instruction}`,
		`Attempt: ${String(task.attempts)} of ${String(task.maxAttempts)}`,
		"Use send_window_message to ask the leader a question or report progress when useful. Reply without target_name; the trusted source is used automatically. Sending a message does not end your turn.",
		"Before you finish, use send_window_message to send the leader a self-contained result and set task_outcome to completed or failed. The trusted assignment already identifies the task, so do not provide a task id. Never end your turn without sending the leader a result, a question, or a blocker.",
		"For a failed result, set failure_kind to technical only for a temporary tool, process, or service failure; use work for failed tests, unclear requirements, or unacceptable output.",
		"Continue the conversation only while another message helps the work.",
		"Do not create a hidden team, subagent, or private task database."
	].join("\n");
}
/** Replace one task and advance the complete team state revision. */
function replaceTask(state, task) {
	return nextWindowTeamState(state, {
		...state,
		tasks: state.tasks.map((candidate) => candidate.id === task.id ? task : candidate)
	});
}
/** Only transient routing failures are eligible for automatic delivery retry. */
function retryableDeliveryCode(code) {
	return code === "target-unavailable" || code === "target-not-active";
}
/** Abort-aware retry delay. */
function cancellableDelay(delayMs, signal) {
	if (signal.aborted) return Promise.resolve(false);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve(true);
		}, delayMs);
		function onAbort() {
			clearTimeout(timer);
			resolve(false);
		}
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
//#endregion
//#region lib/types/index.js
/** Persistent conversation routing and role-window teams for DSH. @module @vibeinging/dsh-session-teams */
/** Cordis plugin name used in loader diagnostics. */
const name = "session-teams";
/** Required Host services; system prompt remains an optional child. */
const inject = [
	"tools",
	"agents",
	"sessionController",
	"sessionPersistence",
	"sessionProjections",
	"workspaceRegistry"
];
/** Default largest message payload accepted from a model-facing tool. */
const DEFAULT_MAX_TASK_CHARS = 2e4;
/** Default number of process-local receipts retained for duplicate suppression. */
const DEFAULT_MAX_REMEMBERED_MESSAGES = 1024;
/** Default in-process tool deadline. */
const DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
/** Default largest team created by one user request. */
const DEFAULT_MAX_TEAM_MEMBERS = 8;
/** Default largest number of tasks retained by one team. */
const DEFAULT_MAX_TEAM_TASKS = 64;
/** Default number of technical attempts allowed for a task. */
const DEFAULT_MAX_TASK_ATTEMPTS = 2;
/** Default delay before retrying a temporary task failure. */
const DEFAULT_TASK_RETRY_DELAY_MS = 1e3;
/** Default number of conversation titles placed directly in model context. */
const DEFAULT_MAX_DIRECTORY_ENTRIES = 32;
/** Validated deployment settings with usable defaults. */
const Config = z.object({
	maxTaskChars: z.number().min(1).default(DEFAULT_MAX_TASK_CHARS),
	maxRememberedMessages: z.number().min(1).default(DEFAULT_MAX_REMEMBERED_MESSAGES),
	requestTimeoutMs: z.number().min(1).max(2147483647).default(DEFAULT_REQUEST_TIMEOUT_MS),
	maxTeamMembers: z.number().min(1).default(8),
	maxTeamTasks: z.number().min(1).default(64),
	maxTaskAttempts: z.number().min(1).default(2),
	taskRetryDelayMs: z.number().min(1).max(2147483647).default(DEFAULT_TASK_RETRY_DELAY_MS),
	maxDirectoryEntries: z.number().min(1).default(32)
});
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/u;
/** Render one message receipt into compact model-facing text. */
function renderMessageResult(value) {
	return [
		`status: ${value.status}`,
		`message_id: ${value.messageId}`,
		`target_link: ${value.targetLink}`,
		`code: ${value.code}`,
		`message: ${value.message}`
	].join("\n");
}
/** Render the current conversation directory for the model. */
function renderListResult(value) {
	return [
		`status: ${value.status}`,
		`code: ${value.code}`,
		`message: ${value.message}`,
		...value.windows.map((window) => `- target_link: ${window.targetLink}; title: ${window.title === null ? "(untitled)" : JSON.stringify(window.title)}; state: ${window.state}`)
	].join("\n");
}
/** Render one team creation result without hiding partial creation. */
function renderTeamResult(value) {
	return [
		`status: ${value.status}`,
		`team_id: ${value.teamId}`,
		`code: ${value.code}`,
		`message: ${value.message}`,
		...value.members.map((member) => `- name: ${JSON.stringify(member.name)}; role: ${JSON.stringify(member.role)}; status: ${member.status}; target_link: ${member.targetLink}; task_id: ${member.taskId}; task_status: ${member.taskStatus}; code: ${member.code}; message: ${member.message}`),
		...value.tasks.map((task) => `- task_id: ${task.id}; title: ${JSON.stringify(task.title)}; owner: ${JSON.stringify(task.ownerName)}; status: ${task.status}; depends_on: ${task.dependsOn.join(",") || "none"}; attempts: ${String(task.attempts)}/${String(task.maxAttempts)}`)
	].join("\n");
}
/** Render a task mutation without hiding follow-on scheduling. */
function renderTeamMutationResult(value) {
	return [
		`status: ${value.status}`,
		`team_id: ${value.teamId}`,
		`code: ${value.code}`,
		`message: ${value.message}`,
		...value.task === null ? [] : [
			`task_id: ${value.task.id}`,
			`task_status: ${value.task.status}`,
			`owner: ${JSON.stringify(value.task.ownerName)}`,
			`attempts: ${String(value.task.attempts)}/${String(value.task.maxAttempts)}`
		],
		`started: ${value.schedule.started.join(",") || "none"}`,
		`failed: ${value.schedule.failed.join(",") || "none"}`
	].join("\n");
}
/** Render the complete current team for dependency-aware model decisions. */
function renderWindowTeamListResult(value) {
	if (value.team === null) return [
		`status: ${value.status}`,
		`code: ${value.code}`,
		`message: ${value.message}`
	].join("\n");
	return [
		`status: ${value.status}`,
		`code: ${value.code}`,
		`message: ${value.message}`,
		`team_id: ${value.team.teamId}`,
		`goal: ${value.team.goal}`,
		`leader: ${value.team.leaderName} (${value.team.leaderRole})`,
		...value.team.tasks.map((task) => `- task_id: ${task.id}; title: ${JSON.stringify(task.title)}; owner: ${JSON.stringify(task.ownerName)}; status: ${task.status}; depends_on: ${task.dependsOn.join(",") || "none"}; attempts: ${String(task.attempts)}/${String(task.maxAttempts)}; note: ${task.note ?? "none"}`)
	].join("\n");
}
/** Return one definite message refusal without touching a target. */
function rejectedMessage(messageId, targetLink, code, message) {
	return {
		status: "rejected",
		messageId,
		targetLink,
		code,
		message
	};
}
/** Validate integer-only configuration that Schemastery's number bounds cannot express. */
function assertPositiveInteger(setting, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`session-teams config ${setting} must be a positive safe integer`);
}
/** Resolve and validate one calling top-level conversation. */
function sourceAgent(exec) {
	const source = exec.agent;
	if (source === void 0) return {
		targetLink: "",
		code: "missing-agent",
		message: "window communication requires an agent-owned tool call"
	};
	if (source.session.header.origin === "subagent" || (source.session.header.delegationDepth ?? 0) !== 0) return {
		targetLink: "",
		code: "source-not-window",
		message: "subagent sessions cannot use conversation-window tools"
	};
	return source;
}
/** Build the directory refresh and list tool. */
function createListConversationWindowsTool(config, directory) {
	return defineTool({
		name: "list_conversation_windows",
		description: "List every other ordinary DSH conversation visible to this Host. Use it when a title is unclear or the user asks which windows are available. Working and available windows are equally addressable.",
		parameters: {},
		output: {
			schema: windowListResultSchema,
			render: (_args, value) => [{
				type: "text",
				text: renderListResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(_args, exec) {
			const source = sourceAgent(exec);
			if ("code" in source) return {
				status: "rejected",
				code: source.code,
				message: source.message,
				windows: []
			};
			try {
				const windows = await directory.listFor(source, exec.signal);
				return {
					status: "ok",
					code: "listed",
					message: windows.length === 0 ? "this Host has no other conversation windows" : `found ${String(windows.length)} conversation window(s)`,
					windows: windows.map((window) => ({
						title: window.title ?? null,
						state: window.running ? "working" : "available",
						targetLink: serializeWindowLink(window.sessionId)
					}))
				};
			} catch (error) {
				return {
					status: "rejected",
					code: "directory-unavailable",
					message: error instanceof Error ? error.message : String(error),
					windows: []
				};
			}
		}
	});
}
/** Build direct conversation and source-locked reply delivery. */
function createWindowMessageTool(config, directory, ledger, coordinator, scheduler) {
	return defineTool({
		name: "send_window_message",
		description: "Send a message to any ordinary DSH conversation visible to this Host. Address it with target_link, the canonical link listed for each conversation; a title alone is never a safe address because titles can duplicate or be renamed. When replying to a window message, omit target_name entirely; the trusted source is used automatically. A relayed reply cannot be redirected to a different existing conversation. Windows decide whether another reply is useful. For a final team-task report, set task_outcome; the task id comes from the trusted assignment.",
		parameters: {
			target_link: {
				type: "string",
				description: "Canonical dsh://session/... link of the destination from the directory or list_conversation_windows. Prefer this; resolve a user-named window to its link first."
			},
			target_name: {
				type: "string",
				description: "Optional fallback by exact displayed title. Only valid when exactly one conversation has that title."
			},
			message: {
				type: "string",
				required: true,
				description: "Exact task, result, question, or reply to send."
			},
			task_outcome: {
				type: "string",
				enum: ["completed", "failed"],
				description: "Final team-task result. Omit for ordinary messages, progress, and questions."
			},
			failure_kind: {
				type: "string",
				enum: ["technical", "work"],
				description: "Required when task_outcome is failed; omit otherwise."
			},
			message_id: {
				type: "string",
				description: "Optional 8-128 character id for exact duplicate suppression; omit to generate one."
			}
		},
		output: {
			schema: messageResultSchema,
			render: (_args, value) => [{
				type: "text",
				text: renderMessageResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(args, exec) {
			const messageId = args.message_id ?? `message-${randomUUID()}`;
			if (!MESSAGE_ID_PATTERN.test(messageId)) return rejectedMessage(messageId, args.target_link ?? "", "invalid-message-id", "message_id must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen");
			if (args.message.trim().length === 0) return rejectedMessage(messageId, args.target_link ?? "", "empty-message", "message must contain non-whitespace text");
			if (args.message.length > config.maxTaskChars) return rejectedMessage(messageId, args.target_link ?? "", "message-too-large", `message exceeds the configured ${String(config.maxTaskChars)} character limit`);
			const source = sourceAgent(exec);
			if ("code" in source) return rejectedMessage(messageId, source.targetLink, source.code, source.message);
			const sourceEvents = source.session.snapshotEvents();
			const direct = currentTurnDirectMessages(sourceEvents);
			const relay = currentWindowRelay(sourceEvents);
			const reportsTask = args.task_outcome !== void 0 || args.failure_kind !== void 0;
			const assignment = reportsTask ? latestTeamTaskAssignment(sourceEvents) : void 0;
			let resolved;
			let conversationId;
			let teamId;
			let taskId;
			let teamReportRequest;
			if (direct.length > 0) {
				if (args.task_outcome !== void 0 || args.failure_kind !== void 0) return rejectedMessage(messageId, args.target_link ?? "", "task-report-without-assignment", "task_outcome and failure_kind are available only while replying to an assigned team task");
				resolved = await directory.resolve(source, {
					...args.target_name === void 0 ? {} : { targetName: args.target_name },
					...args.target_link === void 0 ? {} : { targetLink: args.target_link }
				}, exec.signal);
				conversationId = `conversation-${randomUUID()}`;
			} else {
				const targetRelay = reportsTask ? assignment : relay;
				if (targetRelay === void 0) {
					if (reportsTask) return rejectedMessage(messageId, args.target_link ?? "", "task-report-without-assignment", "task_outcome requires a trusted team-task assignment");
					return rejectedMessage(messageId, args.target_link ?? "", "missing-direct-message", "sending requires a direct user request or a replyable window message in this turn");
				}
				const replyLink = serializeWindowLink(targetRelay.sourceSessionId);
				if (targetRelay.targetSessionId !== source.session.id) return rejectedMessage(messageId, replyLink, "invalid-relay", "the incoming window message targets another session");
				if (args.target_link !== void 0) try {
					if (parseWindowLink(args.target_link).sessionId !== targetRelay.sourceSessionId) return rejectedMessage(messageId, replyLink, "relay-target-denied", "a relayed message may reply only to its source");
				} catch {
					return rejectedMessage(messageId, args.target_link, "invalid-link", "target link could not be parsed");
				}
				resolved = await directory.resolveReplySource(source, targetRelay.sourceSessionId, exec.signal);
				if (!("code" in resolved) && args.target_name !== void 0 && resolved.window.title !== args.target_name.trim()) {
					if (!("code" in await directory.resolve(source, { targetName: args.target_name }, exec.signal))) return rejectedMessage(messageId, replyLink, "relay-target-denied", "a relayed message may reply only to its source; reply without target_name and the trusted source is used automatically");
				}
				conversationId = targetRelay.conversationId;
				teamId = targetRelay.teamId;
				taskId = targetRelay.taskId;
				if (reportsTask) {
					const taskAssignment = assignment;
					if (taskAssignment === void 0) return rejectedMessage(messageId, replyLink, "task-report-without-assignment", "task_outcome requires a trusted team-task assignment");
					if (args.task_outcome === void 0) return rejectedMessage(messageId, replyLink, "task-outcome-required", "failure_kind requires task_outcome");
					if (args.task_outcome === "failed" && args.failure_kind === void 0) return rejectedMessage(messageId, replyLink, "missing-failure-kind", "failed task outcomes require failure_kind technical or work");
					if (args.task_outcome === "completed" && args.failure_kind !== void 0) return rejectedMessage(messageId, replyLink, "unexpected-failure-kind", "completed task outcomes cannot include failure_kind");
					teamId = taskAssignment.teamId;
					taskId = taskAssignment.taskId;
					if ("code" in resolved) return rejectedMessage(messageId, resolved.targetLink, resolved.code, resolved.message);
					teamReportRequest = {
						source,
						leader: resolved.agent,
						teamId: taskAssignment.teamId,
						taskId: taskAssignment.taskId,
						outcome: args.task_outcome,
						message: args.message,
						...args.failure_kind === void 0 ? {} : { failureKind: args.failure_kind }
					};
				}
			}
			if ("code" in resolved) return rejectedMessage(messageId, resolved.targetLink, resolved.code, resolved.message);
			const fingerprint = JSON.stringify([
				String(resolved.window.sessionId),
				args.message,
				conversationId,
				teamId ?? null,
				taskId ?? null,
				args.task_outcome ?? null,
				args.failure_kind ?? null
			]);
			return ledger.run(messageId, fingerprint, resolved.targetLink, async () => {
				const teamReport = teamReportRequest === void 0 ? void 0 : await recordTeamTaskReport({
					...teamReportRequest,
					coordinator,
					scheduler,
					signal: exec.signal
				});
				if (teamReport?.status === "rejected") {
					if (teamReport.code === "task-completed" && relay !== void 0 && relay.taskId === void 0) {
						const fallback = await deliverWindowMessage({
							target: resolved.agent,
							messageId,
							conversationId: relay.conversationId,
							sourceSessionId: source.session.id,
							sourceName: foldSessionTitle(sourceEvents)?.title ?? "conversation window",
							targetSessionId: resolved.window.sessionId,
							message: args.message,
							signal: exec.signal
						});
						return fallback.status === "accepted" ? {
							...fallback,
							code: "delivered-as-reply",
							message: "the last team task is already completed; the message was delivered as an ordinary reply without task_outcome"
						} : fallback;
					}
					return rejectedMessage(messageId, resolved.targetLink, teamReport.code, teamReport.message);
				}
				const result = await deliverWindowMessage({
					target: resolved.agent,
					messageId,
					conversationId,
					...teamId === void 0 ? {} : { teamId },
					...taskId === void 0 ? {} : { taskId },
					sourceSessionId: source.session.id,
					sourceName: foldSessionTitle(sourceEvents)?.title ?? "conversation window",
					targetSessionId: resolved.window.sessionId,
					message: args.message,
					signal: exec.signal
				});
				return teamReport === void 0 || result.status !== "accepted" ? result : {
					...result,
					message: `${result.message}; team task ${teamReport.task?.status ?? "updated"}`
				};
			});
		}
	});
}
/** Build several visible role windows and schedule dependency-ready first tasks. */
function createWindowTeamTool(config, provisioner, directory, coordinator, scheduler, workspaceRegistry) {
	return defineTool({
		name: "create_window_team",
		description: "Create or reuse several ordinary DSH conversation windows and schedule one atomic dependency graph. The current conversation is the leader. For multi-step work, put every known step in members[].tasks in this call instead of adding tasks one by one. Exact existing titles are reused; ambiguous titles are rejected. Ready tasks start automatically. Use only for a direct user request.",
		parameters: {
			team_goal: {
				type: "string",
				required: true,
				description: "Shared outcome the team must complete."
			},
			leader_role: {
				type: "string",
				required: true,
				description: "Role of the current conversation, such as product lead."
			},
			members: {
				type: "array",
				required: true,
				description: "One to several independently visible role windows.",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						name: {
							type: "string",
							required: true,
							description: "Unique displayed conversation title."
						},
						role: {
							type: "string",
							required: true,
							description: "Responsibility owned by this window."
						},
						task: {
							type: "string",
							description: "One-task shorthand. Omit when tasks is provided."
						},
						task_id: {
							type: "string",
							description: "Stable id for the one-task shorthand."
						},
						task_title: {
							type: "string",
							description: "Short label for the one-task shorthand."
						},
						depends_on: {
							type: "array",
							description: "Dependencies for the one-task shorthand.",
							items: { type: "string" }
						},
						max_attempts: {
							type: "number",
							description: "Attempt limit for the one-task shorthand."
						},
						tasks: {
							type: "array",
							description: "Complete tasks owned by this window. Use this for ordered multi-step work and declare the whole graph in one call.",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									task: {
										type: "string",
										required: true,
										description: "Exact self-contained work instruction."
									},
									task_id: {
										type: "string",
										description: "Stable 2-64 character id used by dependencies."
									},
									task_title: {
										type: "string",
										description: "Short task label shown in the team panel."
									},
									depends_on: {
										type: "array",
										description: "Any task ids in this same team graph that must complete first.",
										items: { type: "string" }
									},
									max_attempts: {
										type: "number",
										description: "Bounded technical attempts, up to the configured maximum."
									}
								}
							}
						}
					}
				}
			}
		},
		output: {
			schema: teamResultSchema,
			render: (_args, value) => [{
				type: "text",
				text: renderTeamResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(args, exec) {
			const teamId = `team-${randomUUID()}`;
			const source = sourceAgent(exec);
			if ("code" in source) return rejectedTeam(teamId, source.code, source.message);
			const sourceEvents = source.session.snapshotEvents();
			if (currentTurnDirectMessages(sourceEvents).length === 0) return rejectedTeam(teamId, "missing-direct-message", "team creation requires a direct user request in this turn");
			const normalizedMembers = args.members.map((member, index) => normalizeMemberRequest(member, index, config));
			const validation = validateTeamRequest(args.team_goal, args.leader_role, normalizedMembers, config);
			if (validation !== void 0) return rejectedTeam(teamId, validation.code, validation.message);
			const existing = await directory.listFor(source, exec.signal);
			for (const member of normalizedMembers) if (existing.filter((window) => window.title === member.name).length > 1) return rejectedTeam(teamId, "target-name-ambiguous", `more than one conversation is named ${JSON.stringify(member.name)}; rename the intended window or choose a unique new name`);
			const sourceTitle = foldSessionTitle(sourceEvents)?.title ?? "team leader";
			const workspace = source.session.header.cwd === void 0 ? void 0 : await workspaceRegistry.resolveByPath(source.session.header.cwd);
			const outcomes = [];
			const members = [];
			const tasks = [];
			for (const member of normalizedMembers) {
				exec.signal.throwIfAborted();
				const existingWindow = existing.find((window) => window.title === member.name);
				let memberId = existingWindow?.sessionId ?? SessionId(`session-${randomUUID()}`);
				let targetLink = serializeWindowLink(memberId);
				let createdWindow;
				let reused = false;
				try {
					if (existingWindow === void 0) {
						if (source.session.header.cwd === void 0) throw new Error("the leader conversation has no working directory");
						createdWindow = await provisioner.create({
							source,
							title: member.name,
							cwd: source.session.header.cwd,
							...workspace === void 0 ? {} : { workspace },
							signal: exec.signal
						});
						memberId = createdWindow.sessionId;
						targetLink = serializeWindowLink(memberId);
					} else {
						const resolved = await directory.resolve(source, { targetLink }, exec.signal);
						if ("code" in resolved) throw new Error(resolved.message);
						memberId = resolved.window.sessionId;
						targetLink = resolved.targetLink;
						reused = true;
					}
					if (workspace !== void 0 && existingWindow !== void 0) await workspace.attachSession(memberId);
					members.push({
						sessionId: String(memberId),
						name: member.name,
						role: member.role,
						created: true
					});
					tasks.push(...member.tasks.map((task) => teamTask(member, task, memberId, true)));
					const firstTask = member.tasks[0];
					if (firstTask === void 0) throw new Error("validated member has no tasks");
					outcomes.push({
						name: member.name,
						role: member.role,
						status: reused ? "reused" : "created",
						targetLink,
						code: reused ? "reused" : "created",
						message: reused ? "the existing exact-title window joined the team" : "the role window was created and named",
						taskId: firstTask.taskId,
						taskStatus: firstTask.dependsOn.length === 0 ? "ready" : "blocked"
					});
				} catch (error) {
					const message = renderError(error);
					members.push({
						sessionId: String(memberId),
						name: member.name,
						role: member.role,
						created: false
					});
					tasks.push(...member.tasks.map((task) => ({
						...teamTask(member, task, memberId, false),
						note: message
					})));
					const firstTask = member.tasks[0];
					if (firstTask === void 0) throw new Error("validated member has no tasks");
					outcomes.push({
						name: member.name,
						role: member.role,
						status: "failed",
						targetLink,
						code: "create-failed",
						message,
						taskId: firstTask.taskId,
						taskStatus: "failed"
					});
				}
			}
			const ready = outcomes.filter((outcome) => outcome.status !== "failed").length;
			if (ready > 0) {
				const state = refreshTaskReadiness({
					teamId,
					revision: 1,
					goal: args.team_goal.trim(),
					leaderSessionId: String(source.session.id),
					leaderName: sourceTitle,
					leaderRole: args.leader_role.trim(),
					members,
					tasks
				});
				await coordinator.run(source.session, () => {
					appendWindowTeamState(source.session, state);
				});
				await scheduler.run(source, exec.signal);
			}
			const latest = coordinator.current(source.session);
			const latestTasks = latest?.teamId === teamId ? latest.tasks : tasks;
			const renderedOutcomes = outcomes.map((outcome) => ({
				...outcome,
				taskStatus: latestTasks.find((task) => task.id === outcome.taskId)?.status ?? outcome.taskStatus
			}));
			const status = ready === outcomes.length ? "accepted" : ready === 0 ? "rejected" : "partial";
			const created = outcomes.filter((outcome) => outcome.status === "created").length;
			const reused = outcomes.filter((outcome) => outcome.status === "reused").length;
			return {
				status,
				teamId,
				code: ready === outcomes.length ? "team-created" : ready === 0 ? "team-failed" : "team-partial",
				message: `${String(created)} role window(s) created and ${String(reused)} reused; dependency-ready tasks were scheduled`,
				members: renderedOutcomes,
				tasks: latestTasks
			};
		}
	});
}
/** Add one dependency-aware task to the current leader's window team. */
function createAddWindowTaskTool(config, directory, coordinator, scheduler) {
	return defineTool({
		name: "add_window_task",
		description: "Add one new task after a window team already exists. Do not use this to build a graph known during create_window_team; put that graph in members[].tasks instead. Address the owner window with its target_link, or a title only when exactly one window has that title. Optional dependencies. Ready work starts automatically. Use only for a direct user request.",
		parameters: {
			target_link: {
				type: "string",
				description: "Canonical dsh://session/... link of the owner window from the directory. Prefer this."
			},
			target_name: {
				type: "string",
				description: "Optional fallback by exact displayed title, only when exactly one window has that title."
			},
			title: {
				type: "string",
				required: true,
				description: "Short task label shown in the team panel."
			},
			task: {
				type: "string",
				required: true,
				description: "Exact self-contained work instruction."
			},
			task_id: {
				type: "string",
				description: "Stable 2-64 character id; omit to generate one."
			},
			depends_on: {
				type: "array",
				description: "Existing task ids that must complete first.",
				items: { type: "string" }
			},
			owner_role: {
				type: "string",
				description: "Role used if the target window is new to this team."
			},
			max_attempts: {
				type: "number",
				description: "Bounded technical attempts, up to the configured maximum."
			}
		},
		output: {
			schema: teamMutationResultSchema,
			render: (_args, value) => [{
				type: "text",
				text: renderTeamMutationResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(args, exec) {
			const source = sourceAgent(exec);
			if ("code" in source) return rejectedMutation("", source.code, source.message);
			if (currentTurnDirectMessages(source.session.snapshotEvents()).length === 0) return rejectedMutation("", "missing-direct-message", "adding a team task requires a direct user request");
			const state = coordinator.current(source.session);
			if (state === null) return rejectedMutation("", "no-team", "the current window has no team");
			const taskId = args.task_id?.trim() || `task-${randomUUID()}`;
			const validation = validateNewTask(state, taskId, args.title, args.task, args.depends_on ?? [], args.max_attempts, config);
			if (validation !== void 0) return rejectedMutation(state.teamId, validation.code, validation.message);
			const resolved = await directory.resolve(source, {
				...args.target_name === void 0 ? {} : { targetName: args.target_name },
				...args.target_link === void 0 ? {} : { targetLink: args.target_link }
			}, exec.signal);
			if ("code" in resolved) return rejectedMutation(state.teamId, resolved.code, resolved.message);
			const ownerName = resolved.window.title ?? args.target_name?.trim() ?? "";
			const ownerSessionId = String(resolved.window.sessionId);
			await coordinator.run(source.session, () => {
				const current = coordinator.current(source.session);
				if (current === null || current.teamId !== state.teamId) throw new Error("window team changed while adding the task");
				const members = current.members.some((member) => member.sessionId === ownerSessionId) ? current.members : [...current.members, {
					sessionId: ownerSessionId,
					name: ownerName,
					role: args.owner_role?.trim() || "team member",
					created: true
				}];
				const task = {
					id: taskId,
					title: args.title.trim(),
					instruction: args.task.trim(),
					ownerSessionId,
					ownerName,
					dependsOn: uniqueStrings(args.depends_on ?? []),
					status: "blocked",
					attempts: 0,
					maxAttempts: args.max_attempts ?? config.maxTaskAttempts,
					note: null,
					failureKind: null
				};
				appendWindowTeamState(source.session, nextWindowTeamState(current, {
					...current,
					members,
					tasks: [...current.tasks, task]
				}));
			});
			const schedule = await scheduler.run(source, exec.signal);
			const task = coordinator.current(source.session)?.tasks.find((candidate) => candidate.id === taskId) ?? null;
			return acceptedMutation(state.teamId, "task-added", "the task was added and ready work was scheduled", task, schedule);
		}
	});
}
/** Record one member result and schedule work released by that result. */
async function recordTeamTaskReport(request) {
	const before = request.coordinator.current(request.leader.session);
	if (before === null) return rejectedMutation(request.teamId, "no-team", "the leader window has no team");
	if (request.teamId !== before.teamId) return rejectedMutation(before.teamId, "team-mismatch", "the assignment belongs to another team");
	let updated = null;
	try {
		await request.coordinator.run(request.leader.session, () => {
			const state = request.coordinator.current(request.leader.session);
			if (state === null || state.teamId !== before.teamId) throw new Error("window team changed while recording a result");
			const task = state.tasks.find((candidate) => candidate.id === request.taskId);
			if (task === void 0) throw new TeamMutationError("task-not-found", "the team has no assigned task for this result");
			if (task.ownerSessionId !== String(request.source.session.id)) throw new TeamMutationError("task-owner-mismatch", "only the assigned member can report this task result");
			if (task.status === "completed") throw new TeamMutationError("task-completed", "the task is already completed; if this is an ordinary window reply, resend it without task_outcome");
			const failureKind = request.outcome === "failed" ? request.failureKind ?? null : null;
			const retry = failureKind === "technical" && task.attempts < task.maxAttempts;
			updated = {
				...task,
				status: request.outcome === "completed" ? "completed" : retry ? "ready" : "failed",
				note: request.message.trim(),
				failureKind
			};
			appendWindowTeamState(request.leader.session, nextWindowTeamState(state, {
				...state,
				tasks: state.tasks.map((candidate) => candidate.id === task.id ? updated : candidate)
			}));
		});
	} catch (error) {
		if (error instanceof TeamMutationError) return rejectedMutation(before.teamId, error.code, error.message);
		throw error;
	}
	if (updated === null) return rejectedMutation(before.teamId, "task-update-rejected", "the task result was rejected");
	const schedule = await request.scheduler.run(request.leader, request.signal);
	const latest = request.coordinator.current(request.leader.session)?.tasks.find((task) => task.id === request.taskId) ?? updated;
	return acceptedMutation(before.teamId, "task-reported", "the result was sent and dependencies were rescheduled", latest, schedule);
}
/** Move one non-running task to another visible conversation by title. */
function createReassignWindowTaskTool(config, directory, coordinator, scheduler) {
	return defineTool({
		name: "reassign_window_task",
		description: "Manually move a blocked, ready, or failed team task to another visible conversation. Running and completed work is not silently duplicated. Address the new owner with its target_link, or a title only when exactly one window has that title. Use only for a direct user request.",
		parameters: {
			task_id: {
				type: "string",
				required: true,
				description: "Exact task id to move."
			},
			target_link: {
				type: "string",
				description: "Canonical dsh://session/... link of the new owner window from the directory. Prefer this."
			},
			target_name: {
				type: "string",
				description: "Optional fallback by exact displayed title, only when exactly one window has that title."
			},
			owner_role: {
				type: "string",
				description: "Role used if the target is new to this team."
			}
		},
		output: {
			schema: teamMutationResultSchema,
			render: (_args, value) => [{
				type: "text",
				text: renderTeamMutationResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(args, exec) {
			const source = sourceAgent(exec);
			if ("code" in source) return rejectedMutation("", source.code, source.message);
			if (currentTurnDirectMessages(source.session.snapshotEvents()).length === 0) return rejectedMutation("", "missing-direct-message", "task reassignment requires a direct user request");
			const before = coordinator.current(source.session);
			if (before === null) return rejectedMutation("", "no-team", "the current window has no team");
			const resolved = await directory.resolve(source, {
				...args.target_name === void 0 ? {} : { targetName: args.target_name },
				...args.target_link === void 0 ? {} : { targetLink: args.target_link }
			}, exec.signal);
			if ("code" in resolved) return rejectedMutation(before.teamId, resolved.code, resolved.message);
			const ownerSessionId = String(resolved.window.sessionId);
			const ownerName = resolved.window.title ?? args.target_name?.trim() ?? "";
			let updated = null;
			try {
				await coordinator.run(source.session, () => {
					const state = coordinator.current(source.session);
					if (state === null || state.teamId !== before.teamId) throw new Error("window team changed while reassigning the task");
					const task = state.tasks.find((candidate) => candidate.id === args.task_id.trim());
					if (task === void 0) throw new TeamMutationError("task-not-found", "the team has no task with that id");
					if (task.status === "running" || task.status === "queued") throw new TeamMutationError("task-running", "running work cannot be reassigned without first reaching a settled state");
					if (task.status === "completed") throw new TeamMutationError("task-completed", "completed work is not reassigned");
					updated = {
						...task,
						ownerSessionId,
						ownerName,
						status: "blocked",
						attempts: 0,
						note: null,
						failureKind: null
					};
					const members = state.members.some((member) => member.sessionId === ownerSessionId) ? state.members : [...state.members, {
						sessionId: ownerSessionId,
						name: ownerName,
						role: args.owner_role?.trim() || "team member",
						created: true
					}];
					appendWindowTeamState(source.session, nextWindowTeamState(state, {
						...state,
						members,
						tasks: state.tasks.map((candidate) => candidate.id === task.id ? updated : candidate)
					}));
				});
			} catch (error) {
				if (error instanceof TeamMutationError) return rejectedMutation(before.teamId, error.code, error.message);
				throw error;
			}
			const schedule = await scheduler.run(source, exec.signal);
			const latest = coordinator.current(source.session)?.tasks.find((task) => task.id === args.task_id.trim()) ?? updated;
			return acceptedMutation(before.teamId, "task-reassigned", "the task owner changed and ready work was scheduled", latest, schedule);
		}
	});
}
/** List the leader-owned team state for natural-language coordination. */
function createListWindowTeamTool(config, directory, coordinator) {
	return defineTool({
		name: "list_window_team",
		description: "List the current window team, task ids, owners, dependencies, attempts, and states.",
		parameters: {},
		output: {
			schema: windowTeamListResultSchema,
			render: (_args, value) => [{
				type: "text",
				text: renderWindowTeamListResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(_args, exec) {
			const source = sourceAgent(exec);
			if ("code" in source) return {
				status: "rejected",
				code: source.code,
				message: source.message,
				team: null
			};
			let team = coordinator.current(source.session);
			if (team === null) {
				const assignment = latestTeamTaskAssignment(source.session.snapshotEvents());
				if (assignment !== void 0) {
					const resolved = await directory.resolveReplySource(source, assignment.sourceSessionId, exec.signal);
					if (!("code" in resolved)) team = coordinator.current(resolved.agent.session);
				}
			}
			if (team === null) return {
				status: "empty",
				code: "no-team",
				message: "this window has no team",
				team: null
			};
			return {
				status: "ok",
				code: "listed",
				message: `${String(team.tasks.length)} task(s) in the current team`,
				team
			};
		}
	});
}
/** Register the stateless directory, direct routing, team creation, and optional model context. */
async function apply(ctx, config) {
	const resolved = config;
	for (const [setting, value] of Object.entries(resolved)) assertPositiveInteger(setting, value);
	const ledger = new DeliveryLedger(resolved.maxRememberedMessages);
	const directory = new ConversationWindowDirectory(ctx.agents, ctx.sessionPersistence, ctx.sessionController);
	const provisioner = new ConversationWindowProvisioner(ctx.sessionController, windowConversationHost(ctx.get("productHost")));
	const coordinator = new WindowTeamCoordinator();
	const scheduler = new WindowTeamScheduler({ taskRetryDelayMs: resolved.taskRetryDelayMs }, directory, coordinator);
	await directory.refresh();
	ctx.effect(() => {
		const disposers = [
			ctx.sessionProjections.register(windowTeamProjectionDefinition),
			ctx.tools.register(createListConversationWindowsTool(resolved, directory)),
			ctx.tools.register(createWindowMessageTool(resolved, directory, ledger, coordinator, scheduler)),
			ctx.tools.register(createWindowTeamTool(resolved, provisioner, directory, coordinator, scheduler, ctx.workspaceRegistry)),
			ctx.tools.register(createListWindowTeamTool(resolved, directory, coordinator)),
			ctx.tools.register(createAddWindowTaskTool(resolved, directory, coordinator, scheduler)),
			ctx.tools.register(createReassignWindowTaskTool(resolved, directory, coordinator, scheduler))
		];
		return async () => {
			for (const dispose of disposers.reverse()) dispose();
			await scheduler.dispose();
			coordinator.clear();
			ledger.clear();
			directory.clear();
		};
	}, "session-teams: conversation directory and team tools");
	const restoreTeam = async (agent) => {
		const team = coordinator.current(agent.session);
		if (team === null || team.leaderSessionId !== String(agent.session.id)) return;
		const workspace = agent.session.header.cwd === void 0 ? void 0 : await ctx.workspaceRegistry.resolveByPath(agent.session.header.cwd);
		if (workspace !== void 0) {
			const knownWindows = new Set(directory.currentFor(agent).map((window) => String(window.sessionId)));
			for (const member of team.members) if (member.created && knownWindows.has(member.sessionId)) await workspace.attachSession(SessionId(member.sessionId));
		}
		if (team.tasks.some((task) => task.status === "queued")) appendWindowTeamState(agent.session, nextWindowTeamState(team, {
			...team,
			tasks: team.tasks.map((task) => task.status === "queued" ? {
				...task,
				status: "ready",
				note: "recovered after plugin restart",
				failureKind: "technical"
			} : task)
		}));
		await scheduler.run(agent);
	};
	for (const agent of ctx.agents.roots()) await restoreTeam(agent);
	ctx.on("agent/created", ({ agent }) => {
		restoreTeam(agent).catch((error) => {
			ctx.logger("session-teams").warn("failed to restore team workspace membership: %s", renderError(error));
		});
	});
	ctx.on("agent/disposed", () => {
		directory.refresh().catch(() => void 0);
	});
	ctx.inject(["systemPrompt"], (promptCtx) => {
		promptCtx.systemPrompt.context({
			name: "session-teams:directory",
			order: 125,
			text: (context) => context.agent === void 0 ? "" : [directory.renderModelContext(context.agent, resolved.maxDirectoryEntries), renderTeamModelContext(coordinator.current(context.agent.session))].filter(Boolean).join("\n\n")
		});
	});
}
function renderError(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Validate a team request before creating any window. */
function validateTeamRequest(teamGoal, leaderRole, members, config) {
	if (teamGoal.trim().length === 0 || leaderRole.trim().length === 0) return {
		code: "invalid-team",
		message: "team_goal and leader_role must contain visible text"
	};
	if (teamGoal.length > config.maxTaskChars) return {
		code: "team-goal-too-large",
		message: "team_goal exceeds the configured message limit"
	};
	if (members.length === 0 || members.length > config.maxTeamMembers) return {
		code: "invalid-team-size",
		message: `members must contain 1-${String(config.maxTeamMembers)} role windows`
	};
	const names = /* @__PURE__ */ new Set();
	const taskIds = /* @__PURE__ */ new Set();
	for (const member of members) {
		const name = member.name;
		if (name.length === 0 || member.role.length === 0 || member.tasks.length === 0) return {
			code: "invalid-member",
			message: "each member needs a visible name, role, and at least one task"
		};
		if (names.has(name)) return {
			code: "duplicate-member-name",
			message: `member name ${JSON.stringify(name)} is repeated`
		};
		names.add(name);
		for (const task of member.tasks) {
			if (task.task.length === 0 || task.taskTitle.length === 0 || task.task.length > config.maxTaskChars) return {
				code: "invalid-task",
				message: `every task for ${JSON.stringify(name)} needs visible text within the configured message limit`
			};
			if (!TASK_ID_PATTERN.test(task.taskId)) return {
				code: "invalid-task-id",
				message: `task id ${JSON.stringify(task.taskId)} must use 2-64 safe characters`
			};
			if (taskIds.has(task.taskId)) return {
				code: "duplicate-task-id",
				message: `task id ${JSON.stringify(task.taskId)} is repeated`
			};
			if (!Number.isSafeInteger(task.maxAttempts) || task.maxAttempts <= 0 || task.maxAttempts > config.maxTaskAttempts) return {
				code: "invalid-max-attempts",
				message: `max_attempts must be between 1 and ${String(config.maxTaskAttempts)}`
			};
			taskIds.add(task.taskId);
		}
	}
	const tasks = members.flatMap((member) => member.tasks);
	if (tasks.length > config.maxTeamTasks) return {
		code: "team-task-limit",
		message: `the complete graph exceeds the configured ${String(config.maxTeamTasks)} task limit`
	};
	for (const task of tasks) {
		if (task.dependsOn.length !== uniqueStrings(task.dependsOn).length) return {
			code: "duplicate-dependency",
			message: `task ${JSON.stringify(task.taskId)} repeats a dependency`
		};
		for (const dependency of task.dependsOn) {
			if (!taskIds.has(dependency)) return {
				code: "unknown-dependency",
				message: `task ${JSON.stringify(task.taskId)} depends on unknown task ${JSON.stringify(dependency)}`
			};
			if (dependency === task.taskId) return {
				code: "self-dependency",
				message: `task ${JSON.stringify(task.taskId)} cannot depend on itself`
			};
		}
	}
	if (hasDependencyCycle(tasks.map((task) => ({
		id: task.taskId,
		dependsOn: task.dependsOn
	})))) return {
		code: "dependency-cycle",
		message: "task dependencies must not contain a cycle"
	};
}
/** Return a team refusal before any window is created. */
function rejectedTeam(teamId, code, message) {
	return {
		status: "rejected",
		teamId,
		code,
		message,
		members: [],
		tasks: []
	};
}
/** Error with a stable model-facing mutation code. */
var TeamMutationError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "TeamMutationError";
	}
};
/** Normalize optional task fields before request-wide validation. */
function normalizeMemberRequest(member, index, config) {
	const hasShorthand = member.task !== void 0 || member.task_id !== void 0 || member.task_title !== void 0 || member.depends_on !== void 0 || member.max_attempts !== void 0;
	const requests = member.tasks === void 0 ? hasShorthand ? [{
		task: member.task ?? "",
		...member.task_id === void 0 ? {} : { task_id: member.task_id },
		...member.task_title === void 0 ? {} : { task_title: member.task_title },
		...member.depends_on === void 0 ? {} : { depends_on: member.depends_on },
		...member.max_attempts === void 0 ? {} : { max_attempts: member.max_attempts }
	}] : [] : hasShorthand ? [] : member.tasks;
	return {
		name: member.name.trim(),
		role: member.role.trim(),
		tasks: requests.map((task, taskIndex) => ({
			task: task.task.trim(),
			taskId: task.task_id?.trim() || (member.tasks === void 0 ? `task-${String(index + 1)}` : `task-${String(index + 1)}-${String(taskIndex + 1)}`),
			taskTitle: task.task_title?.trim() || shortTaskTitle(task.task, taskIndex),
			dependsOn: task.depends_on?.map((value) => value.trim()) ?? [],
			maxAttempts: task.max_attempts ?? config.maxTaskAttempts
		}))
	};
}
/** Build one task for a newly created, reused, or failed role window. */
function teamTask(member, task, memberId, created) {
	return {
		id: task.taskId,
		title: task.taskTitle,
		instruction: task.task,
		ownerSessionId: String(memberId),
		ownerName: member.name,
		dependsOn: [...task.dependsOn],
		status: created ? "blocked" : "failed",
		attempts: 0,
		maxAttempts: task.maxAttempts,
		note: null,
		failureKind: created ? null : "technical"
	};
}
/** Keep generated task labels readable in the compact team panel. */
function shortTaskTitle(instruction, index) {
	const compact = instruction.trim().replace(/\s+/gu, " ");
	if (compact.length === 0) return `Task ${String(index + 1)}`;
	return compact.length <= 72 ? compact : `${compact.slice(0, 69)}...`;
}
/** Preserve order while removing repeated exact values. */
function uniqueStrings(values) {
	return [...new Set(values.map((value) => value.trim()))];
}
/** Detect a dependency cycle in a closed task graph. */
function hasDependencyCycle(tasks) {
	const dependencies = new Map(tasks.map((task) => [task.id, task.dependsOn]));
	const visiting = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	const visit = (id) => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		for (const dependency of dependencies.get(id) ?? []) if (dependencies.has(dependency) && visit(dependency)) return true;
		visiting.delete(id);
		visited.add(id);
		return false;
	};
	return tasks.some((task) => visit(task.id));
}
/** Validate one new task against the current closed team graph. */
function validateNewTask(state, taskId, title, instruction, dependsOn, maxAttempts, config) {
	if (state.tasks.length >= config.maxTeamTasks) return {
		code: "team-task-limit",
		message: `the team already has the configured ${String(config.maxTeamTasks)} task limit`
	};
	if (!TASK_ID_PATTERN.test(taskId)) return {
		code: "invalid-task-id",
		message: "task_id must use 2-64 safe characters"
	};
	if (state.tasks.some((task) => task.id === taskId)) return {
		code: "duplicate-task-id",
		message: "the team already has that task id"
	};
	if (title.trim().length === 0 || instruction.trim().length === 0 || instruction.length > config.maxTaskChars) return {
		code: "invalid-task",
		message: "title and task must contain visible text within the configured message limit"
	};
	const attempts = maxAttempts ?? config.maxTaskAttempts;
	if (!Number.isSafeInteger(attempts) || attempts <= 0 || attempts > config.maxTaskAttempts) return {
		code: "invalid-max-attempts",
		message: `max_attempts must be between 1 and ${String(config.maxTaskAttempts)}`
	};
	const normalizedDependencies = dependsOn.map((value) => value.trim());
	if (normalizedDependencies.some((value) => value.length === 0)) return {
		code: "invalid-dependency",
		message: "dependency task ids must contain visible text"
	};
	if (uniqueStrings(normalizedDependencies).length !== normalizedDependencies.length) return {
		code: "duplicate-dependency",
		message: "depends_on repeats a task id"
	};
	if (normalizedDependencies.includes(taskId)) return {
		code: "self-dependency",
		message: "a task cannot depend on itself"
	};
	const known = new Set(state.tasks.map((task) => task.id));
	const unknown = normalizedDependencies.find((id) => !known.has(id));
	if (unknown !== void 0) return {
		code: "unknown-dependency",
		message: `unknown dependency ${JSON.stringify(unknown)}`
	};
}
/** Return a successful mutation result. */
function acceptedMutation(teamId, code, message, task, schedule) {
	return {
		status: "accepted",
		teamId,
		code,
		message,
		task,
		schedule
	};
}
/** Return a rejected mutation result without a scheduler side effect. */
function rejectedMutation(teamId, code, message) {
	return {
		status: "rejected",
		teamId,
		code,
		message,
		task: null,
		schedule: {
			started: [],
			failed: []
		}
	};
}
/** Describe leader-owned task state to the model without exposing internal Session ids. */
function renderTeamModelContext(team) {
	if (team === null) return "";
	return [
		"# Window team",
		`You lead the visible window team ${JSON.stringify(team.goal)} as ${team.leaderRole}.`,
		"Use list_window_team for exact task ids and states. Ready tasks are dispatched automatically after dependencies complete.",
		"Use add_window_task or reassign_window_task only when the user directly asks for coordination changes.",
		`Current task summary: ${team.tasks.map((task) => `${task.id}=${task.status}@${task.ownerName}`).join(", ")}`
	].join("\n");
}
const messageResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true,
			enum: ["accepted", "rejected"]
		},
		messageId: {
			type: "string",
			required: true
		},
		targetLink: {
			type: "string",
			required: true
		},
		code: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		}
	}
};
const windowListResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true,
			enum: ["ok", "rejected"]
		},
		code: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		windows: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					title: {
						oneOf: [{ type: "string" }, { type: "null" }],
						required: true
					},
					state: {
						type: "string",
						required: true,
						enum: ["working", "available"]
					},
					targetLink: {
						type: "string",
						required: true
					}
				}
			}
		}
	}
};
const taskResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		id: {
			type: "string",
			required: true
		},
		title: {
			type: "string",
			required: true
		},
		instruction: {
			type: "string",
			required: true
		},
		ownerSessionId: {
			type: "string",
			required: true
		},
		ownerName: {
			type: "string",
			required: true
		},
		dependsOn: {
			type: "array",
			required: true,
			items: { type: "string" }
		},
		status: {
			type: "string",
			required: true,
			enum: [
				"blocked",
				"ready",
				"queued",
				"running",
				"completed",
				"failed"
			]
		},
		attempts: {
			type: "number",
			required: true
		},
		maxAttempts: {
			type: "number",
			required: true
		},
		note: {
			oneOf: [{ type: "string" }, { type: "null" }],
			required: true
		},
		failureKind: {
			oneOf: [{
				type: "string",
				enum: ["technical", "work"]
			}, { type: "null" }],
			required: true
		}
	}
};
const windowTeamSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		teamId: {
			type: "string",
			required: true
		},
		revision: {
			type: "number",
			required: true
		},
		goal: {
			type: "string",
			required: true
		},
		leaderSessionId: {
			type: "string",
			required: true
		},
		leaderName: {
			type: "string",
			required: true
		},
		leaderRole: {
			type: "string",
			required: true
		},
		members: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					sessionId: {
						type: "string",
						required: true
					},
					name: {
						type: "string",
						required: true
					},
					role: {
						type: "string",
						required: true
					},
					created: {
						type: "boolean",
						required: true
					}
				}
			}
		},
		tasks: {
			type: "array",
			required: true,
			items: taskResultSchema
		}
	}
};
const teamResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true,
			enum: [
				"accepted",
				"partial",
				"rejected"
			]
		},
		teamId: {
			type: "string",
			required: true
		},
		code: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		members: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					name: {
						type: "string",
						required: true
					},
					role: {
						type: "string",
						required: true
					},
					status: {
						type: "string",
						required: true,
						enum: [
							"created",
							"reused",
							"failed"
						]
					},
					targetLink: {
						type: "string",
						required: true
					},
					code: {
						type: "string",
						required: true
					},
					message: {
						type: "string",
						required: true
					},
					taskId: {
						type: "string",
						required: true
					},
					taskStatus: {
						type: "string",
						required: true,
						enum: [
							"blocked",
							"ready",
							"queued",
							"running",
							"completed",
							"failed"
						]
					}
				}
			}
		},
		tasks: {
			type: "array",
			required: true,
			items: taskResultSchema
		}
	}
};
const teamMutationResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true,
			enum: ["accepted", "rejected"]
		},
		code: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		teamId: {
			type: "string",
			required: true
		},
		task: {
			oneOf: [taskResultSchema, { type: "null" }],
			required: true
		},
		schedule: {
			type: "object",
			required: true,
			additionalProperties: false,
			properties: {
				started: {
					type: "array",
					required: true,
					items: { type: "string" }
				},
				failed: {
					type: "array",
					required: true,
					items: { type: "string" }
				}
			}
		}
	}
};
const windowTeamListResultSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		status: {
			type: "string",
			required: true,
			enum: [
				"ok",
				"empty",
				"rejected"
			]
		},
		code: {
			type: "string",
			required: true
		},
		message: {
			type: "string",
			required: true
		},
		team: {
			oneOf: [windowTeamSchema, { type: "null" }],
			required: true
		}
	}
};
//#endregion
export { Config, ConversationWindowDirectory, ConversationWindowProvisioner, DEFAULT_MAX_DIRECTORY_ENTRIES, DEFAULT_MAX_REMEMBERED_MESSAGES, DEFAULT_MAX_TASK_ATTEMPTS, DEFAULT_MAX_TASK_CHARS, DEFAULT_MAX_TEAM_MEMBERS, DEFAULT_MAX_TEAM_TASKS, DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_TASK_RETRY_DELAY_MS, DeliveryLedger, FORWARDED_TASK_PREFIX, LEGACY_SESSION_TEAMS_MESSAGE_PREFIX, LEGACY_WINDOW_LINK_PLUGIN, LEGACY_WINDOW_MESSAGE_PREFIX, MAX_SESSION_ID_CHARS, SESSION_TEAMS_MESSAGE_PREFIX, SESSION_TEAMS_PLUGIN, SESSION_TEAMS_PROTOCOL_VERSION, SESSION_TEAMS_VISIBLE_RELAY_VERSION, WINDOW_LINK_PLUGIN, WINDOW_LINK_PROTOCOL_VERSION, WINDOW_MESSAGE_PREFIX, WINDOW_RELAY_REPLY_CONTRACT, WINDOW_RELAY_SOURCE_FORM, WINDOW_RELAY_SOURCE_FRAMING, WINDOW_RELAY_SOURCE_KIND, WindowLinkParseError, WindowTeamCoordinator, WindowTeamScheduler, appendWindowTeamState, apply, createAddWindowTaskTool, createListConversationWindowsTool, createListWindowTeamTool, createReassignWindowTaskTool, createWindowMessageTool, createWindowTeamTool, currentDirectMessages, currentModelSelection, currentTurnDirectMessages, currentWindowRelay, deliverWindowMessage, deliverWindowTask, extractWindowLinks, foldWindowTeam, inject, isHumanUserSource, isSessionTeamsPlugin, isVisibleWindowMessageSource, isWindowMessageSourceClaim, isWindowRelaySource, serializeWindowLink as linkForSession, serializeWindowLink, name, parseVisibleWindowMessage, parseWindowLink, parseWindowMessage, parseWindowRelayMessage, readLoggedAgentOptions, refreshTaskReadiness, renderForwardedTask, renderTaskAssignment, renderVisibleWindowMessage, renderWindowMessage, resolveTargetWindow, visibleWindowMessageSource, windowConversationHost, windowFromLiveAgent, windowRelaySource, windowTeamProjectionDefinition };

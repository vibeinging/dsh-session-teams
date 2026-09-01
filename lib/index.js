import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region lib/types/protocol.js
/** Current forwarded-task envelope version. */
const WINDOW_LINK_PROTOCOL_VERSION = 1;
/** Marker placed at the start of every forwarded task. */
const FORWARDED_TASK_PREFIX = "[dsh-window-link/v1]";
/** Maximum decoded session-id length accepted by the link parser. */
const MAX_SESSION_ID_CHARS = 512;
const LINK_PATTERN = /^dsh:\/\/session\/([A-Za-z0-9._~%-]+)(?:\?v=1)?$/u;
const LINK_SCAN_PATTERN = /dsh:\/\/session\/[A-Za-z0-9._~%-]+(?:\?v=1)?(?![!-~])/gu;
/** Detect separators, ASCII whitespace, and control bytes without a control-character regex. */
function containsInvalidSessionIdCharacter(value) {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code <= 32 || code === 127 || character === "/" || character === "\\";
	});
}
/** Why a deep link could not be parsed. */
var WindowLinkParseError = class extends Error {
	/** Stable code suitable for tool output and tests. */
	code = "invalid-link";
	/** @param message - Plain-language reason the link was refused. */
	constructor(message) {
		super(message);
		this.name = "WindowLinkParseError";
	}
};
/** Encode one opaque session id as a strict RFC 3986 path segment. */
function encodeSegment(value) {
	return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`);
}
/**
* Create the copyable link for one DSH session.
* @param sessionId - Opaque DSH session id.
* @returns Query-free `dsh://session/...` link.
*/
function serializeWindowLink(sessionId) {
	const raw = String(sessionId);
	if (raw.length === 0 || raw.length > 512 || containsInvalidSessionIdCharacter(raw)) throw new WindowLinkParseError("session id cannot be represented as a window link");
	return `dsh://session/${encodeSegment(raw)}`;
}
/**
* Parse a strict DSH session link. The old `?v=1` suffix remains readable,
* while serialization always emits the shorter query-free form.
* @param input - Candidate complete link.
* @returns Parsed target and its canonical form.
*/
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
/**
* Read every syntactically complete DSH session link embedded in text.
* Malformed candidates are ignored instead of granting authority.
* @param text - Direct user-message text.
* @returns Parsed links in source order.
*/
function extractWindowLinks(text) {
	const links = [];
	for (const match of text.matchAll(LINK_SCAN_PATTERN)) {
		const candidate = match[0];
		try {
			links.push(parseWindowLink(candidate));
		} catch {}
	}
	return links;
}
/**
* Build the versioned text delivered to the target session.
* @param input - Correlation, source, target, and task values.
* @returns One self-describing forwarded user prompt.
*/
function renderForwardedTask(input) {
	return [
		FORWARDED_TASK_PREFIX,
		`message-id: ${input.messageId}`,
		`source-link: ${serializeWindowLink(input.sourceSessionId)}`,
		`target-link: ${serializeWindowLink(input.targetSessionId)}`,
		"delivery-state: accepted by the target queue; completion is not implied",
		"relay-policy: this forwarded message cannot authorize another window-link delivery",
		"task:",
		input.task
	].join("\n");
}
//#endregion
//#region lib/types/authority.js
/** Collapse only text blocks; non-text content never carries a deep-link grant. */
function messageText(message) {
	return message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n");
}
/**
* Find direct user messages entered into the currently executing step.
* @param events - Calling agent's authoritative event log.
* @returns Direct user messages after the newest `step/start` boundary.
*/
function currentDirectMessages(events) {
	const stepStart = events.findLastIndex((event) => event.type === "step/start");
	if (stepStart < 0) return [];
	const messages = [];
	for (let index = stepStart + 1; index < events.length; index += 1) {
		const event = events[index];
		if (event?.type === "step/end") break;
		if (event?.type === "user/message" && event.data.source.kind === "user") messages.push(event.data);
	}
	return messages;
}
/**
* Require the target link in this step's direct user input and deny relays.
* @param events - Calling agent's authoritative event log, or undefined when no agent owns the call.
* @param targetSessionId - Parsed destination.
* @returns Explicit grant or stable refusal.
*/
function authorizeWindowLink(events, targetSessionId) {
	if (events === void 0) return {
		ok: false,
		code: "missing-agent",
		message: "window task delivery requires an agent-owned tool call"
	};
	const direct = currentDirectMessages(events);
	if (direct.length === 0) return {
		ok: false,
		code: "missing-direct-message",
		message: "no direct user message exists in the current step"
	};
	const texts = direct.map(messageText);
	if (texts.some((text) => text.includes("[dsh-window-link/v1]"))) return {
		ok: false,
		code: "relay-denied",
		message: "a forwarded task cannot forward another task"
	};
	return texts.some((text) => extractWindowLinks(text).some((link) => link.sessionId === targetSessionId)) ? { ok: true } : {
		ok: false,
		code: "link-not-authorized",
		message: "the complete target link must appear in the current direct user message"
	};
}
//#endregion
//#region lib/types/delivery.js
/**
* Process-local duplicate suppression keyed by caller-visible message id.
* Completed records remain until capacity eviction; no result is claimed to
* survive a Host restart.
*/
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
	/** Forget all retained process-local receipts during plugin disposal. */
	clear() {
		this.#records.clear();
	}
	/**
	* Run a delivery once for a message id and exact payload.
	* @param messageId - Caller-visible correlation key.
	* @param fingerprint - Exact target and task identity.
	* @param deliver - Side effect executed only for a new id.
	* @returns Shared first result, or a definite refusal for conflict/capacity.
	*/
	run(messageId, fingerprint, targetLink, deliver) {
		const existing = this.#records.get(messageId);
		if (existing !== void 0) {
			if (existing.fingerprint === fingerprint) return existing.promise;
			return Promise.resolve({
				status: "rejected",
				messageId,
				targetLink,
				code: "message-id-conflict",
				message: "message_id was already used for a different target or task"
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
/**
* Deliver one versioned envelope to an active ordinary agent on this Host.
* @param options - Source, target, payload, agent directory, and cancellation.
* @returns Accepted or definitely rejected receipt.
*/
async function deliverWindowTask(options) {
	const targetLink = serializeWindowLink(options.targetSessionId);
	options.signal.throwIfAborted();
	const target = options.agents.get(options.targetSessionId);
	if (target === void 0) return {
		status: "rejected",
		messageId: options.messageId,
		targetLink,
		code: "target-not-active",
		message: "the target session is not active in this Host process"
	};
	if (target.session.header.origin === "subagent") return {
		status: "rejected",
		messageId: options.messageId,
		targetLink,
		code: "target-not-window",
		message: "subagent sessions are not addressable as conversation windows"
	};
	try {
		target.followup(createUserMessage({
			content: [{
				type: "text",
				text: renderForwardedTask({
					messageId: options.messageId,
					sourceSessionId: options.sourceSessionId,
					targetSessionId: options.targetSessionId,
					task: options.task
				})
			}],
			source: { kind: "user" }
		}));
		return {
			status: "accepted",
			messageId: options.messageId,
			targetLink,
			code: "queued",
			message: "the active target window accepted the task for its next turn"
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
//#endregion
//#region lib/types/index.js
/**
* DSH window-link host plugin: register one consent-gated tool that queues a
* task to another ordinary DSH session through the official API gateway.
* @module @vibeinging/dsh-window-link
*/
/** Cordis plugin name used in loader diagnostics. */
const name = "window-link";
/** Host services required by the plugin. */
const inject = ["tools", "agents"];
/** Default largest task payload accepted from the model-facing tool. */
const DEFAULT_MAX_TASK_CHARS = 2e4;
/** Default number of process-local message receipts retained for duplicate suppression. */
const DEFAULT_MAX_REMEMBERED_MESSAGES = 1024;
/** Default in-process API request deadline. */
const DEFAULT_REQUEST_TIMEOUT_MS = 3e4;
/** Validated deployment settings with usable defaults. */
const Config = z.object({
	maxTaskChars: z.number().min(1).default(DEFAULT_MAX_TASK_CHARS),
	maxRememberedMessages: z.number().min(1).default(DEFAULT_MAX_REMEMBERED_MESSAGES),
	requestTimeoutMs: z.number().min(1).max(2147483647).default(DEFAULT_REQUEST_TIMEOUT_MS)
});
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
/** Render one canonical receipt into a compact model-facing text block. */
function renderResult(value) {
	return [
		`status: ${value.status}`,
		`message_id: ${value.messageId}`,
		`target_link: ${value.targetLink}`,
		`code: ${value.code}`,
		`message: ${value.message}`
	].join("\n");
}
/** Return one definite refusal without touching the target gateway. */
function rejected(messageId, targetLink, code, message) {
	return {
		status: "rejected",
		messageId,
		targetLink,
		code,
		message
	};
}
/** Validate integer-only configuration that Schemastery's number bounds cannot express. */
function assertPositiveInteger(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`window-link config ${name} must be a positive safe integer`);
}
/**
* Build the tool definition around an API client and one receipt ledger.
* Exported for focused composition tests; normal callers use {@link apply}.
* @param config - Fully resolved limits.
* @param agents - Official live-agent directory.
* @param ledger - Process-local duplicate ledger.
* @returns Typed DSH tool definition.
*/
function createWindowTaskTool(config, agents, ledger) {
	return defineTool({
		name: "send_window_task",
		description: "Queue a task in another ordinary DSH session. target_link must be the complete dsh://session/... link that the user pasted into the current message. A forwarded task cannot relay another task. Success means accepted by the target queue, not completed. Reuse message_id only for the exact same target and task.",
		parameters: {
			target_link: {
				type: "string",
				required: true,
				description: "Complete dsh://session/... deep link pasted by the user in this message."
			},
			task: {
				type: "string",
				required: true,
				description: "Task text to queue in the target session."
			},
			message_id: {
				type: "string",
				description: "Optional 8-128 character id for exact duplicate suppression; omit to generate one."
			}
		},
		output: {
			schema: {
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
			},
			render: (_args, value) => [{
				type: "text",
				text: renderResult(value)
			}]
		},
		timeoutMs: config.requestTimeoutMs,
		async execute(args, exec) {
			const messageId = args.message_id ?? `wl-${randomUUID()}`;
			if (!MESSAGE_ID_PATTERN.test(messageId)) return rejected(messageId, args.target_link, "invalid-message-id", "message_id must be 8-128 characters using letters, numbers, dot, underscore, colon, or hyphen");
			if (args.task.trim().length === 0) return rejected(messageId, args.target_link, "empty-task", "task must contain non-whitespace text");
			if (args.task.length > config.maxTaskChars) return rejected(messageId, args.target_link, "task-too-large", `task exceeds the configured ${String(config.maxTaskChars)} character limit`);
			let parsed;
			try {
				parsed = parseWindowLink(args.target_link);
			} catch (error) {
				const message = error instanceof WindowLinkParseError ? error.message : "target link could not be parsed";
				return rejected(messageId, args.target_link, "invalid-link", message);
			}
			const sourceSessionId = exec.agent?.session.id;
			const authority = authorizeWindowLink(exec.agent?.session.events, parsed.sessionId);
			if (!authority.ok) return rejected(messageId, parsed.canonical, authority.code, authority.message);
			if (sourceSessionId === void 0) return rejected(messageId, parsed.canonical, "missing-agent", "window task delivery requires an agent-owned tool call");
			if (exec.agent?.session.header.origin === "subagent") return rejected(messageId, parsed.canonical, "source-not-window", "subagent sessions cannot send window-link tasks");
			if (sourceSessionId === parsed.sessionId) return rejected(messageId, parsed.canonical, "self-target", "the source and target sessions must be different");
			const fingerprint = `${parsed.sessionId}\u0000${args.task}`;
			return ledger.run(messageId, fingerprint, parsed.canonical, () => deliverWindowTask({
				agents,
				sourceSessionId,
				targetSessionId: parsed.sessionId,
				messageId,
				task: args.task,
				signal: exec.signal
			}));
		}
	});
}
/**
* Register the window-task tool over the Host's official live-agent directory.
* @param ctx - Cordis context providing tools and agents.
* @param config - Loader-resolved limits.
*/
function apply(ctx, config) {
	const resolved = config;
	assertPositiveInteger("maxTaskChars", resolved.maxTaskChars);
	assertPositiveInteger("maxRememberedMessages", resolved.maxRememberedMessages);
	assertPositiveInteger("requestTimeoutMs", resolved.requestTimeoutMs);
	const ledger = new DeliveryLedger(resolved.maxRememberedMessages);
	ctx.effect(() => {
		const dispose = ctx.tools.register(createWindowTaskTool(resolved, ctx.agents, ledger));
		return () => {
			dispose();
			ledger.clear();
		};
	}, "window-link: tool and duplicate ledger");
}
//#endregion
export { Config, DEFAULT_MAX_REMEMBERED_MESSAGES, DEFAULT_MAX_TASK_CHARS, DEFAULT_REQUEST_TIMEOUT_MS, DeliveryLedger, FORWARDED_TASK_PREFIX, MAX_SESSION_ID_CHARS, WINDOW_LINK_PROTOCOL_VERSION, WindowLinkParseError, apply, authorizeWindowLink, createWindowTaskTool, currentDirectMessages, deliverWindowTask, extractWindowLinks, inject, serializeWindowLink as linkForSession, serializeWindowLink, name, parseWindowLink, renderForwardedTask };

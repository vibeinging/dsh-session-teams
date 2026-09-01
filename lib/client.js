window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-window-link",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
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
		//#endregion
		//#region \0dsh-css:WindowLinkAction.module.css.mjs
		const css = ".dTAw_G_action{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;justify-content:center;align-items:center;padding:0;display:inline-flex}.dTAw_G_action:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-fill-hover)}.dTAw_G_action:focus-visible{outline:2px solid var(--dsw-alias-stroke-focus);outline-offset:1px}.dTAw_G_action[data-copy-state=copied]{color:var(--dsw-alias-label-success,var(--dsw-alias-label-primary))}.dTAw_G_action[data-copy-state=failed]{color:var(--dsw-alias-label-error,var(--dsw-alias-label-primary))}.dTAw_G_icon{fill:none;stroke:currentColor;stroke-width:1.3px;stroke-linecap:round;stroke-linejoin:round;width:16px;height:16px}";
		const tagId = "@deepseek-ai/dsh-window-link/WindowLinkAction.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-window-link";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var _dsh_css_WindowLinkAction_module_css_default = {
			"action": "dTAw_G_action",
			"icon": "dTAw_G_icon"
		};
		//#endregion
		//#region src/client/WindowLinkAction.tsx
		/** Session-header action that copies the current conversation deep link. */
		/**
		* Write the session link through the browser clipboard surface.
		* @param text - Exact canonical deep link.
		* @returns Whether the host accepted the copy.
		*/
		async function writeWindowLinkClipboard(text) {
			if (navigator.clipboard?.writeText !== void 0) try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
			if (typeof document.execCommand !== "function") return false;
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.readOnly = true;
			textarea.style.position = "fixed";
			textarea.style.left = "-9999px";
			document.body.appendChild(textarea);
			textarea.select();
			try {
				return document.execCommand("copy");
			} catch {
				return false;
			} finally {
				textarea.remove();
			}
		}
		/** Copy the current session link and expose success or failure to assistive text. */
		function WindowLinkAction({ sessionId, t }) {
			const [state, setState] = (0, react.useState)("idle");
			(0, react.useEffect)(() => {
				if (state === "idle") return;
				const timer = window.setTimeout(() => {
					setState("idle");
				}, 1500);
				return () => {
					window.clearTimeout(timer);
				};
			}, [state]);
			const label = state === "copied" ? "copy.success" : state === "failed" ? "copy.failure" : "copy.label";
			const copy = async () => {
				const copied = await writeWindowLinkClipboard(serializeWindowLink(sessionId));
				setState(copied ? "copied" : "failed");
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: _dsh_css_WindowLinkAction_module_css_default.action,
				"aria-label": t(label),
				title: t(label),
				"data-copy-state": state,
				onClick: () => {
					copy();
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					className: _dsh_css_WindowLinkAction_module_css_default.icon,
					viewBox: "0 0 16 16",
					"aria-hidden": "true",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6.4 10.7 5.2 12a2.5 2.5 0 0 1-3.6-3.6l2.2-2.2a2.5 2.5 0 0 1 3.6 0" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m9.6 5.3 1.2-1.2a2.5 2.5 0 0 1 3.6 3.6l-2.2 2.2a2.5 2.5 0 0 1-3.6 0" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m5.8 10.2 4.4-4.4" })
					]
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"copy.label": "复制会话链接",
			"copy.success": "会话链接已复制",
			"copy.failure": "无法复制会话链接"
		};
		/** English dictionary, checked complete against the Chinese key set. */
		const en = {
			"copy.label": "Copy session link",
			"copy.success": "Session link copied",
			"copy.failure": "Could not copy session link"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by the plugin. */
		const NS = "windowLink";
		/** Browser services required by the link action. */
		const inject = ["slots", "locale"];
		/**
		* Register localized copy feedback and the session-header action.
		* @param ctx - DSH client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "window-link: dictionaries");
			ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
				name: "conversation.session.header.actions",
				id: "window-link-copy",
				locale: NS
			}, WindowLinkAction));
		}
		//#endregion
		exports.WindowLinkAction = WindowLinkAction;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
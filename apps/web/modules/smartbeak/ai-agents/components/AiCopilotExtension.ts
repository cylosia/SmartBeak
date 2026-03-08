/**
 * Phase 3B — AI Co-Pilot Tiptap Extension
 *
 * A Tiptap extension that adds AI co-pilot capabilities to the editor.
 * Registers keyboard shortcuts and commands for:
 * - Inline suggestion (Tab to accept)
 * - Rewrite selection
 * - Fact-check selection
 * - Optimize for SEO
 * - Shorten / Expand selection
 * - Tone adjustment
 *
 * The extension stores a "ghost text" suggestion in a decoration
 * that is displayed in a faded style after the cursor. Pressing Tab
 * accepts the suggestion; pressing Escape dismisses it.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type CopilotAction =
	| "suggest"
	| "rewrite"
	| "fact_check"
	| "optimize"
	| "shorten"
	| "expand"
	| "tone";

export interface AiCopilotOptions {
	/** Called when the user triggers a co-pilot action. */
	onAction?: (action: CopilotAction, selectedText: string) => void;
	/** Whether the co-pilot is enabled. */
	enabled?: boolean;
}

const COPILOT_PLUGIN_KEY = new PluginKey("ai-copilot");

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		aiCopilot: {
			/** Trigger an AI co-pilot action on the current selection or cursor. */
			triggerCopilot: (action: CopilotAction) => ReturnType;
			/** Accept the current ghost-text suggestion. */
			acceptSuggestion: () => ReturnType;
			/** Dismiss the current ghost-text suggestion. */
			dismissSuggestion: () => ReturnType;
			/** Insert the result of a co-pilot action, replacing the selection. */
			insertCopilotResult: (text: string) => ReturnType;
		};
	}
}

export const AiCopilotExtension = Extension.create<AiCopilotOptions>({
	name: "aiCopilot",

	addOptions() {
		return {
			enabled: true,
			onAction: undefined,
		};
	},

	addCommands() {
		return {
			triggerCopilot:
				(action: CopilotAction) =>
				({ editor, state }) => {
					if (!this.options.enabled || !this.options.onAction) {
						return false;
					}

					const { from, to, empty } = state.selection;
					const selectedText = empty
						? editor.getText().slice(Math.max(0, from - 300), from) // context before cursor
						: state.doc.textBetween(from, to, " ");

					this.options.onAction(action, selectedText);
					return true;
				},

			acceptSuggestion:
				() =>
				({ state, dispatch }) => {
					const pluginState = COPILOT_PLUGIN_KEY.getState(state) as {
						suggestion: string;
						from: number;
					} | null;

					if (!pluginState?.suggestion) {
						return false;
					}

					if (!state.selection.empty || state.selection.from !== pluginState.from) {
						return false;
					}

					if (dispatch) {
						const tr = state.tr.insertText(
							pluginState.suggestion,
							pluginState.from,
						);
						// Clear suggestion
						tr.setMeta(COPILOT_PLUGIN_KEY, {
							suggestion: null,
							from: null,
						});
						dispatch(tr);
					}
					return true;
				},

			dismissSuggestion:
				() =>
				({ state, dispatch }) => {
					const pluginState = COPILOT_PLUGIN_KEY.getState(state) as {
						suggestion: string | null;
						from: number | null;
					} | null;

					if (!pluginState?.suggestion) {
						return false;
					}

					if (dispatch) {
						const tr = state.tr.setMeta(COPILOT_PLUGIN_KEY, {
							suggestion: null,
							from: null,
						});
						dispatch(tr);
					}
					return true;
				},

			insertCopilotResult:
				(text: string) =>
				({ state, dispatch, editor: _editor }) => {
					const { from, empty } = state.selection;
					if (dispatch) {
						const tr = empty
							? state.tr.insertText(text, from)
							: state.tr.replaceSelectionWith(
									state.schema.text(text),
								);
						dispatch(tr);
					}
					return true;
				},
		};
	},

	addKeyboardShortcuts() {
		return {
			// Tab to accept inline suggestion
			Tab: ({ editor }) => {
				return editor.commands.acceptSuggestion();
			},
			// Escape to dismiss inline suggestion
			Escape: ({ editor }) => {
				return editor.commands.dismissSuggestion();
			},
			// Keyboard shortcuts for co-pilot actions
			"Mod-Shift-s": ({ editor }) =>
				editor.commands.triggerCopilot("suggest"),
			"Mod-Shift-r": ({ editor }) =>
				editor.commands.triggerCopilot("rewrite"),
			"Mod-Shift-f": ({ editor }) =>
				editor.commands.triggerCopilot("fact_check"),
			"Mod-Shift-o": ({ editor }) =>
				editor.commands.triggerCopilot("optimize"),
		};
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: COPILOT_PLUGIN_KEY,

				state: {
					init() {
						return {
							suggestion: null as string | null,
							from: null as number | null,
						};
					},
					apply(tr, prev) {
						const meta = tr.getMeta(COPILOT_PLUGIN_KEY) as
							| {
									suggestion: string | null;
									from: number | null;
							  }
							| undefined;
						if (meta !== undefined) {
							return {
								suggestion: meta.suggestion,
								from: meta.from,
							};
						}
						// Clear suggestion if the document changed
						if (tr.docChanged && prev.suggestion) {
							return { suggestion: null, from: null };
						}
						// Suggestions are only valid at the original cursor position.
						if (
							tr.selectionSet &&
							prev.suggestion &&
							prev.from !== tr.selection.from
						) {
							return { suggestion: null, from: null };
						}
						return prev;
					},
				},

				props: {
					decorations(state) {
						const pluginState = COPILOT_PLUGIN_KEY.getState(
							state,
						) as {
							suggestion: string | null;
							from: number | null;
						};

						if (
							!pluginState?.suggestion ||
							pluginState.from == null
						) {
							return DecorationSet.empty;
						}

						const widget = Decoration.widget(
							pluginState.from,
							() => {
								const span = document.createElement("span");
								span.className =
									"ai-copilot-suggestion text-muted-foreground/50 italic pointer-events-none select-none";
								span.setAttribute("data-suggestion", "true");
								span.textContent = pluginState.suggestion ?? "";
								return span;
							},
							{ side: 1 },
						);

						return DecorationSet.create(state.doc, [widget]);
					},
				},
			}),
		];
	},
});

/**
 * Helper to set a ghost-text suggestion in the editor.
 * Call this after receiving the AI response.
 */
export function setCopilotSuggestion(
	editor: {
		commands: {
			acceptSuggestion: () => boolean;
			dismissSuggestion: () => boolean;
		};
	} & {
		view: {
			state: import("@tiptap/pm/state").EditorState;
			dispatch: (tr: import("@tiptap/pm/state").Transaction) => void;
		};
	},
	suggestion: string,
	from: number,
) {
	const tr = editor.view.state.tr.setMeta(COPILOT_PLUGIN_KEY, {
		suggestion,
		from,
	});
	editor.view.dispatch(tr);
}

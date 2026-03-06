"use client";

/**
 * Phase 3B — TiptapEditor with AI Co-Pilot
 *
 * A drop-in wrapper around the existing TiptapEditor that adds the
 * AI Co-Pilot toolbar and extension. Import this component anywhere
 * the standard TiptapEditor is used to get co-pilot capabilities.
 *
 * Usage:
 *   import { TiptapEditorWithCopilot } from "@/modules/smartbeak/ai-agents/components/TiptapEditorWithCopilot";
 *
 *   <TiptapEditorWithCopilot
 *     value={content}
 *     onChange={setContent}
 *     documentTitle="My Article"
 *   />
 *
 * The co-pilot toolbar appears above the editor. Keyboard shortcuts:
 *   Mod+Shift+S — Inline suggest (Tab to accept)
 *   Mod+Shift+R — Rewrite selection
 *   Mod+Shift+F — Fact-check selection
 *   Mod+Shift+O — Optimize for SEO
 */

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import { AiCopilotExtension } from "./AiCopilotExtension";
import { AiCopilotToolbar } from "./AiCopilotToolbar";

interface TiptapEditorWithCopilotProps {
	value?: string;
	onChange?: (value: string) => void;
	placeholder?: string;
	documentTitle?: string;
	className?: string;
	editable?: boolean;
}

export function TiptapEditorWithCopilot({
	value = "",
	onChange,
	placeholder = "Start writing...",
	documentTitle,
	className,
	editable = true,
}: TiptapEditorWithCopilotProps) {
	const [isMounted, setIsMounted] = useState(false);

	useEffect(() => {
		setIsMounted(true);
	}, []);

	const editor = useEditor({
		immediatelyRender: false,
		extensions: [
			StarterKit,
			Placeholder.configure({
				placeholder,
				emptyEditorClass: "is-editor-empty",
			}),
			AiCopilotExtension.configure({
				enabled: true,
			}),
		],
		content: value,
		editable,
		onUpdate: ({ editor: e }) => {
			onChange?.(e.getHTML());
		},
		editorProps: {
			attributes: {
				class: [
					"prose prose-sm dark:prose-invert max-w-none",
					"focus:outline-none min-h-[200px] px-4 py-3",
					"prose-headings:font-semibold prose-p:leading-relaxed",
					"[&_.ai-copilot-suggestion]:text-muted-foreground/40 [&_.ai-copilot-suggestion]:italic",
					className ?? "",
				]
					.filter(Boolean)
					.join(" "),
			},
		},
	});

	if (!isMounted) {
		return (
			<div className="rounded-xl border bg-background">
				<div className="border-b px-3 py-2 h-10 bg-muted/30 animate-pulse rounded-t-xl" />
				<div className="min-h-[200px] animate-pulse bg-muted/10 rounded-b-xl" />
			</div>
		);
	}

	return (
		<div className="rounded-xl border bg-background overflow-hidden">
			{/* Co-Pilot Toolbar */}
			<div className="flex items-center gap-1 border-b px-3 py-1.5 bg-muted/30 min-h-[40px] flex-wrap">
				<AiCopilotToolbar
					editor={editor}
					documentTitle={documentTitle}
				/>
			</div>

			{/* Editor */}
			<EditorContent editor={editor} />
		</div>
	);
}

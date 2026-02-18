
import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
export interface RichTextEditorProps {
  content?: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ content, onChange }: RichTextEditorProps) {
  // P1-FIX: Keep a ref to the latest onChange so the stable onUpdate callback
  // always calls the current prop without needing to recreate the editor.
  // Without this, the editor captures a stale closure of onChange from mount
  // and silently uses outdated callback logic when the parent re-renders.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const editor = useEditor({
    extensions: [StarterKit],
    content: content || '',
    onUpdate({ editor: e }) {
      // Call through the ref to always use the latest onChange prop.
      onChangeRef.current(e.getHTML());
    },
  });

  // P1-FIX: Guard against null editor (returned during SSR / before hydration).
  // EditorContent accepts null but TypeScript strict mode rejects it; a loading
  // fallback also avoids a brief flash of an empty container.
  if (!editor) {
    return (
      <div style={{ border: '1px solid var(--border, #333)', padding: 12 }}>
        Loading editor\u2026
      </div>
    );
  }

  return (
    // P2-FIX: Use CSS variable for border colour so the editor respects the
    // active theme (dark-mode uses var(--border) instead of hardcoded #333).
    <div style={{ border: '1px solid var(--border, #333)', padding: 12 }}>
      <EditorContent editor={editor} />
    </div>
  );
}

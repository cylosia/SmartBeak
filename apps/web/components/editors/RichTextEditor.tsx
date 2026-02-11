
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
export interface RichTextEditorProps {
  content?: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ content, onChange }: RichTextEditorProps) {
  const editor = useEditor({
  extensions: [StarterKit],
  content: content || '',
  onUpdate({ editor }) {
    onChange(editor.getHTML());
  },
  });

  return (
  <div style={{ border: '1px solid #333', padding: 12 }}>
    <EditorContent editor={editor} />
  </div>
  );
}

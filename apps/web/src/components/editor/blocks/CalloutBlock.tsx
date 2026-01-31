import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useCallback, useRef, useEffect } from 'react';
import type { CalloutBlockData, CalloutVariant } from '../block-types';

interface Props {
  data: CalloutBlockData;
  onChange: (data: CalloutBlockData) => void;
  readOnly?: boolean;
}

const VARIANTS: Record<CalloutVariant, { label: string; icon: string; bg: string; border: string; text: string }> = {
  tip: { label: 'Tip', icon: '💡', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900' },
  warning: { label: 'Warning', icon: '⚠️', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900' },
  'exam-hint': { label: 'Exam Hint', icon: '📝', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900' },
  'common-mistake': { label: 'Common Mistake', icon: '❌', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900' },
};

export default function CalloutBlock({ data, onChange, readOnly }: Props) {
  const v = VARIANTS[data.variant] || VARIANTS.tip;
  const lastSavedRef = useRef(data.html);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false }),
      Placeholder.configure({ placeholder: 'Write callout content...' }),
    ],
    content: data.html || '',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: `prose prose-sm max-w-none focus:outline-none min-h-[2rem] px-1 ${v.text}`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      debounceSave(ed.getHTML());
    },
  });

  const debounceSave = useCallback(
    (() => {
      let timer: ReturnType<typeof setTimeout>;
      return (html: string) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (html !== lastSavedRef.current) {
            onChange({ ...data, html });
            lastSavedRef.current = html;
          }
        }, 800);
      };
    })(),
    [onChange, data],
  );

  // Sync external content changes
  useEffect(() => {
    if (editor && data.html !== lastSavedRef.current) {
      editor.commands.setContent(data.html || '');
      lastSavedRef.current = data.html;
    }
  }, [data.html, editor]);

  return (
    <div className={`${v.bg} border ${v.border} rounded-lg overflow-hidden`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-inherit">
        <span className="text-base">{v.icon}</span>
        {!readOnly ? (
          <select
            value={data.variant}
            onChange={(e) => onChange({ ...data, variant: e.target.value as CalloutVariant })}
            className="text-xs font-semibold bg-transparent border-none focus:outline-none cursor-pointer"
          >
            {Object.entries(VARIANTS).map(([key, val]) => (
              <option key={key} value={key}>
                {val.icon} {val.label}
              </option>
            ))}
          </select>
        ) : (
          <span className={`text-xs font-semibold ${v.text}`}>{v.label}</span>
        )}
      </div>
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

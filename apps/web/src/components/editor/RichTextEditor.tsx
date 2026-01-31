import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { InlineMath, BlockMath } from './latex-extensions';
import EquationModal from './EquationModal';

// ─── Types ──────────────────────────────────────────────

interface Props {
  content: string;
  onSave: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  autoSaveMs?: number;
}

// ─── Toolbar Button ─────────────────────────────────────

function TBtn({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-1.5 py-1 text-xs rounded transition-colors ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-5 bg-gray-200 mx-0.5" />;
}

// ─── Component ──────────────────────────────────────────

export default function RichTextEditor({
  content,
  onSave,
  placeholder = 'Start writing...',
  readOnly = false,
  autoSaveMs = 2000,
}: Props) {
  const [eqModal, setEqModal] = useState<{
    open: boolean;
    mode: 'inline' | 'block';
    latex: string;
    editPos: number | null;
  }>({ open: false, mode: 'inline', latex: '', editPos: null });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedRef = useRef(content);
  const editorRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-indigo-600 underline' },
      }),
      Placeholder.configure({ placeholder }),
      InlineMath,
      BlockMath,
    ],
    content: content || '',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[200px] px-4 py-3',
      },
    },
    onUpdate: ({ editor: ed }) => {
      debounceSave(ed.getHTML());
    },
  });

  // Autosave with debounce
  const debounceSave = useCallback(
    (html: string) => {
      if (readOnly) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus('idle');
      saveTimerRef.current = setTimeout(() => {
        if (html !== lastSavedRef.current) {
          setSaveStatus('saving');
          onSave(html);
          lastSavedRef.current = html;
          setTimeout(() => setSaveStatus('saved'), 300);
          setTimeout(() => setSaveStatus('idle'), 2500);
        }
      }, autoSaveMs);
    },
    [onSave, autoSaveMs, readOnly],
  );

  // Update content when prop changes externally (e.g. AI generation)
  useEffect(() => {
    if (editor && content !== lastSavedRef.current) {
      editor.commands.setContent(content || '');
      lastSavedRef.current = content;
    }
  }, [content, editor]);

  // Listen for equation edit events from node views
  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setEqModal({
        open: true,
        mode: detail.type,
        latex: detail.latex,
        editPos: detail.pos,
      });
    };
    container.addEventListener('edit-equation', handler);
    return () => container.removeEventListener('edit-equation', handler);
  }, []);

  // ─── Equation handlers ────────────────────────────────

  const handleInsertEquation = (latex: string, mode: 'inline' | 'block') => {
    if (!editor) return;

    if (eqModal.editPos !== null) {
      // Editing existing: delete the old node and insert new one
      // Find the node at the approximate position
      const { state } = editor.view;
      const resolved = state.doc.resolve(Math.min(eqModal.editPos, state.doc.content.size));
      const nodeAfter = resolved.nodeAfter;
      if (
        nodeAfter &&
        (nodeAfter.type.name === 'inlineMath' || nodeAfter.type.name === 'blockMath')
      ) {
        const from = resolved.pos;
        const to = from + nodeAfter.nodeSize;
        const nodeType = mode === 'inline' ? 'inlineMath' : 'blockMath';
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContentAt(from, { type: nodeType, attrs: { latex } })
          .run();
      }
    } else {
      // New equation
      if (mode === 'inline') {
        editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex } }).run();
      } else {
        editor.chain().focus().insertContent({ type: 'blockMath', attrs: { latex } }).run();
      }
    }

    setEqModal({ open: false, mode: 'inline', latex: '', editPos: null });
  };

  // ─── Link handler ─────────────────────────────────────

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes('link').href || '';
    const url = window.prompt('URL:', prev);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  // ─── Font size ────────────────────────────────────────

  const setFontSize = (size: string) => {
    if (!editor) return;
    if (size === 'normal') {
      editor.chain().focus().unsetMark('textStyle').run();
    } else {
      const px = size === 'small' ? '12px' : '18px';
      editor.chain().focus().setMark('textStyle', { fontSize: px }).run();
    }
  };

  if (!editor) return null;

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
          {/* Text formatting */}
          <TBtn
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold (Ctrl+B)"
          >
            <strong>B</strong>
          </TBtn>
          <TBtn
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic (Ctrl+I)"
          >
            <em>I</em>
          </TBtn>
          <TBtn
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="Underline (Ctrl+U)"
          >
            <span className="underline">U</span>
          </TBtn>
          <TBtn
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <span className="line-through">S</span>
          </TBtn>
          <TBtn
            active={editor.isActive('code')}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline code"
          >
            <span className="font-mono">&lt;/&gt;</span>
          </TBtn>

          <Separator />

          {/* Headings */}
          <TBtn
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title="Heading 1"
          >
            H1
          </TBtn>
          <TBtn
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          >
            H2
          </TBtn>
          <TBtn
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
          >
            H3
          </TBtn>
          <TBtn
            active={editor.isActive('heading', { level: 4 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
            title="Heading 4"
          >
            H4
          </TBtn>

          <Separator />

          {/* Lists */}
          <TBtn
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet list"
          >
            &#8226; List
          </TBtn>
          <TBtn
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered list"
          >
            1. List
          </TBtn>
          <TBtn
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title="Blockquote"
          >
            &ldquo; Quote
          </TBtn>

          <Separator />

          {/* Alignment */}
          <TBtn
            active={editor.isActive({ textAlign: 'left' })}
            onClick={() => editor.chain().focus().setTextAlign('left').run()}
            title="Align left"
          >
            &#9776;
          </TBtn>
          <TBtn
            active={editor.isActive({ textAlign: 'center' })}
            onClick={() => editor.chain().focus().setTextAlign('center').run()}
            title="Align center"
          >
            &#9776;
          </TBtn>
          <TBtn
            active={editor.isActive({ textAlign: 'right' })}
            onClick={() => editor.chain().focus().setTextAlign('right').run()}
            title="Align right"
          >
            &#9776;
          </TBtn>

          <Separator />

          {/* Font size */}
          <select
            onChange={(e) => setFontSize(e.target.value)}
            className="text-xs px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-600"
            defaultValue="normal"
            title="Font size"
          >
            <option value="small">Small</option>
            <option value="normal">Normal</option>
            <option value="large">Large</option>
          </select>

          <Separator />

          {/* Link */}
          <TBtn active={editor.isActive('link')} onClick={setLink} title="Insert/edit link">
            Link
          </TBtn>

          <Separator />

          {/* Equations */}
          <TBtn
            onClick={() => setEqModal({ open: true, mode: 'inline', latex: '', editPos: null })}
            title="Insert inline equation"
          >
            <span className="font-serif italic">f(x)</span>
          </TBtn>
          <TBtn
            onClick={() => setEqModal({ open: true, mode: 'block', latex: '', editPos: null })}
            title="Insert display equation"
          >
            <span className="font-serif italic">&sum;</span>
          </TBtn>

          {/* Save status indicator */}
          <div className="ml-auto text-xs text-gray-400">
            {saveStatus === 'saving' && 'Saving...'}
            {saveStatus === 'saved' && <span className="text-green-600">Saved</span>}
          </div>
        </div>
      )}

      {/* Editor area */}
      <div ref={editorRef}>
        <EditorContent editor={editor} />
      </div>

      {/* Equation modal */}
      <EquationModal
        open={eqModal.open}
        initialLatex={eqModal.latex}
        mode={eqModal.mode}
        onInsert={handleInsertEquation}
        onClose={() => setEqModal({ open: false, mode: 'inline', latex: '', editPos: null })}
      />
    </div>
  );
}

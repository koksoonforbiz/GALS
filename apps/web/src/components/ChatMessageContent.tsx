import { Component, useState, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Check, Copy } from 'lucide-react';
import 'highlight.js/styles/github.css';

/**
 * Shared rich-content renderer for every assistant / user message on the
 * platform. Used by both `FloatingChatbot/ChatbotPanel` and
 * `dialogue/ChatPanel` so formatting is identical everywhere.
 *
 * Features:
 *  - GitHub-flavored Markdown (headings, bold/italic, lists, blockquotes,
 *    links, horizontal rules, pipe tables)
 *  - Tables rendered as real HTML tables with Tailwind styling and
 *    horizontal scroll so wide tables never break the chat column
 *  - Math (KaTeX) — inline `$…$` / `\(…\)` and block `$$…$$` / `\[…\]`.
 *    Backslash-paren / -bracket delimiters are normalised to dollar-sign
 *    delimiters because many providers emit those instead.
 *  - Fenced code blocks with language label, syntax highlighting
 *    (highlight.js via rehype-highlight), and a copy button. Inline code
 *    gets its own distinct styling.
 *  - HTML is sanitised via rehype-sanitize so model output cannot inject
 *    `<script>` or other unsafe tags.
 *  - Wrapped in an error boundary so a malformed table / unmatched `$` /
 *    KaTeX parse error degrades to plain-text rather than blanking the
 *    message or crashing the panel.
 */

// rehype-sanitize's default schema strips the className / language-* /
// math attributes that react-markdown + rehype-highlight + rehype-katex
// rely on to render code and math. Extend it.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow class on every element so highlight.js theme classes survive
    // (hljs / language-*, plus KaTeX's many internal classes).
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'className',
      'style',
    ],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-./, 'hljs', /^hljs-./],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      'className',
      'style',
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      'className',
      'style',
    ],
  },
  // KaTeX emits a lot of tag names that defaultSchema strips. Allow them.
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'math',
    'semantics',
    'mrow',
    'mi',
    'mn',
    'mo',
    'ms',
    'mtext',
    'mfrac',
    'msup',
    'msub',
    'msubsup',
    'munder',
    'mover',
    'munderover',
    'mtable',
    'mtr',
    'mtd',
    'annotation',
    'menclose',
    'mspace',
    'msqrt',
    'mroot',
    'mphantom',
    'mstyle',
    'mpadded',
    'maction',
  ],
};

/**
 * Models commonly emit `\(...\)` and `\[...\]` for inline / block math.
 * remark-math only understands `$...$` / `$$...$$`, so we normalise.
 * Done before any other rewriting and outside fenced code blocks so we
 * never mangle real text or code samples that legitimately contain
 * backslash-paren sequences.
 */
function normaliseMathDelimiters(input: string): string {
  if (!input) return input;
  // Split on triple-backtick fences so we don't touch math-looking
  // sequences inside code blocks.
  const parts = input.split(/(```[\s\S]*?```)/g);
  for (let i = 0; i < parts.length; i++) {
    // Odd indices are code fences — skip.
    if (i % 2 === 1) continue;
    let s = parts[i]!;
    // Block math: \[ ... \]
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `\n$$${body}$$\n`);
    // Inline math: \( ... \)
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`);
    parts[i] = s;
  }
  return parts.join('');
}

// ─── Code block with copy button ────────────────────────────────────

function CodeBlock({
  language,
  rawText,
  children,
}: {
  language: string | null;
  rawText: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context). Silent fail
      // is fine — there's nothing for the user to recover from.
    }
  };

  return (
    <div className="relative my-2 rounded-md border border-gray-200 bg-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1 border-b border-gray-200 bg-gray-100 text-[10px] uppercase tracking-wide text-gray-500">
        <span>{language || 'code'}</span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
          title="Copy code"
          type="button"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-snug">
        {children}
      </pre>
    </div>
  );
}

// ─── react-markdown component overrides ─────────────────────────────

const markdownComponents: Components = {
  // Pipe tables: wrap in a horizontally scrolling container so wide
  // tables never blow out the narrow chat column.
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-100 text-gray-700">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border border-gray-300 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-300 px-2 py-1 align-top">{children}</td>
  ),
  // Block-level styling. Keep margins tight for chat density.
  h1: ({ children }) => (
    <h1 className="text-base font-semibold mt-2 mb-1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold mt-2 mb-1">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-semibold mt-1.5 mb-1">{children}</h4>
  ),
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-gray-300 pl-3 my-2 text-gray-600 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline hover:text-blue-800"
    >
      {children}
    </a>
  ),
  // Code rendering. react-markdown calls `code` for both inline and
  // fenced; the parent `pre` is only present for fences. rehype-highlight
  // adds `language-*` + `hljs` classes for fences.
  code: ({ className, children, ...props }) => {
    const text = String(children ?? '');
    const langMatch = /language-(\w+)/.exec(className ?? '');
    const isInline = !langMatch;
    if (isInline) {
      return (
        <code
          className="px-1 py-0.5 rounded bg-gray-100 text-pink-700 font-mono text-[0.85em]"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Fenced — strip the trailing newline react-markdown leaves behind.
    const rawText = text.replace(/\n$/, '');
    return (
      <CodeBlock language={langMatch?.[1] ?? null} rawText={rawText}>
        <code className={className} {...props}>
          {children}
        </code>
      </CodeBlock>
    );
  },
  // The default `pre` wrapper would double-wrap our CodeBlock above.
  // Render its children directly so CodeBlock provides the only <pre>.
  pre: ({ children }) => <>{children}</>,
};

// ─── Error boundary fallback ────────────────────────────────────────

interface BoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

class RenderBoundary extends Component<BoundaryProps, { errored: boolean }> {
  state = { errored: false };
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch() {
    // Intentionally silent — chat-render failures should not pollute
    // the console for what is almost always a model formatting glitch.
  }
  render() {
    return this.state.errored ? this.props.fallback : this.props.children;
  }
}

// ─── Public component ───────────────────────────────────────────────

interface ChatMessageContentProps {
  content: string;
  /**
   * Chat bubbles for the USER role typically use a coloured background
   * with white text. Pass `inverted` so links / inline code / KaTeX
   * inherit a sane palette in that case. Defaults to false (light
   * background, dark text — the assistant bubble).
   */
  inverted?: boolean;
  /**
   * Optional additional class names for the outer wrapper. Useful when
   * the caller needs to constrain typography size (e.g. `text-xs` in
   * the floating chatbot, `text-sm` in dialogue mode).
   */
  className?: string;
}

export function ChatMessageContent({
  content,
  inverted = false,
  className = '',
}: ChatMessageContentProps) {
  const normalised = useMemo(() => normaliseMathDelimiters(content ?? ''), [content]);

  // Plain-text fallback used by both the error boundary and as the
  // user-bubble render path. Preserves whitespace so newlines survive.
  const plainFallback = (
    <p className="whitespace-pre-wrap break-words">{content}</p>
  );

  return (
    <div
      className={[
        'chat-message-content max-w-full break-words',
        inverted ? 'chat-message-content--inverted' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <RenderBoundary fallback={plainFallback}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[
            rehypeKatex,
            [rehypeHighlight, { detect: true, ignoreMissing: true }],
            [rehypeSanitize, sanitizeSchema],
          ]}
          components={markdownComponents}
        >
          {normalised}
        </ReactMarkdown>
      </RenderBoundary>
    </div>
  );
}

export default ChatMessageContent;

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  /** Text that may contain inline LaTeX delimited by $...$ (and block math by $$...$$). */
  text: string;
  className?: string;
}

interface Segment {
  math: boolean;
  display: boolean;
  value: string;
}

/**
 * Split a string into plain-text and math segments. Math is delimited by
 * `$$...$$` (display) or `$...$` (inline). Only *balanced* delimiters are
 * treated as math; a lone `$` (e.g. a currency amount) is left as literal text.
 */
function splitMath(input: string): Segment[] {
  const segments: Segment[] = [];
  // Matches $$...$$ or $...$ (non-greedy, no newlines inside inline math).
  const re = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(input)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ math: false, display: false, value: input.slice(lastIndex, m.index) });
    }
    const display = m[1] !== undefined;
    segments.push({ math: true, display, value: (m[1] ?? m[2] ?? '').trim() });
    lastIndex = re.lastIndex;
  }

  if (lastIndex < input.length) {
    segments.push({ math: false, display: false, value: input.slice(lastIndex) });
  }

  return segments;
}

/**
 * Renders a string with inline/block LaTeX math via KaTeX. Non-math text is
 * emitted verbatim (no Markdown parsing), so it is safe for question prompts
 * and answer options that mix prose with formulas.
 */
export function MathText({ text, className }: MathTextProps) {
  const segments = useMemo(() => splitMath(text ?? ''), [text]);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (!seg.math) {
          return <span key={i}>{seg.value}</span>;
        }
        let html: string;
        try {
          html = katex.renderToString(seg.value, {
            throwOnError: false,
            displayMode: seg.display,
          });
        } catch {
          // Fall back to the raw LaTeX source if KaTeX cannot parse it.
          return <span key={i}>{seg.value}</span>;
        }
        return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </span>
  );
}

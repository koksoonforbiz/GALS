/**
 * Text-quote anchoring for study-note highlights (the approach used by
 * Hypothesis / the W3C Web Annotation TextQuoteSelector): a highlight is
 * stored as its exact text plus a little text before and after it, and is
 * found again by searching the rendered slide's text. Nothing depends on DOM
 * offsets, so a highlight survives React re-renders, reveals that add text
 * elsewhere on the slide, and later visits.
 */

export const CONTEXT_CHARS = 32;

/** Text a student types into is not slide content and is never anchored. */
const SKIP_SELECTOR = 'textarea, input, select, button, script, style, [data-notes-ignore]';

export interface TextIndex {
  root: Element;
  nodes: Text[];
  starts: number[];
  text: string;
}

export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export function indexText(root: Element): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    if (!t.data) continue;
    nodes.push(t);
    starts.push(text.length);
    text += t.data;
  }
  return { root, nodes, starts, text };
}

/** Text offset of a DOM boundary point (container, offset) within the index. */
function boundaryOffset(idx: TextIndex, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const i = idx.nodes.indexOf(container as Text);
    if (i >= 0) return idx.starts[i]! + Math.min(offset, (container as Text).length);
  }
  const probe = document.createRange();
  probe.setStart(container, offset);
  probe.collapse(true);
  let pos = 0;
  for (let i = 0; i < idx.nodes.length; i++) {
    const n = idx.nodes[i]!;
    // whole node at or before the boundary
    if (probe.comparePoint(n, n.length) <= 0) {
      pos = idx.starts[i]! + n.length;
      continue;
    }
    break;
  }
  return pos;
}

/** Range over [start, end) of the index text (null if it can't be built). */
export function rangeFromOffsets(idx: TextIndex, start: number, end: number): Range | null {
  if (end <= start) return null;
  const locate = (pos: number, preferNext: boolean) => {
    for (let i = 0; i < idx.nodes.length; i++) {
      const s = idx.starts[i]!;
      const e = s + idx.nodes[i]!.length;
      if (pos < e || (pos === e && !preferNext)) return { node: idx.nodes[i]!, offset: pos - s };
    }
    return null;
  };
  const a = locate(start, true);
  const b = locate(end, false);
  if (!a || !b) return null;
  const r = document.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  return r;
}

/** Anchor for a selection inside `root` (whitespace trimmed off both ends). */
export function anchorFromRange(
  root: Element,
  range: Range,
): (TextAnchor & { start: number; end: number }) | null {
  const idx = indexText(root);
  let start = boundaryOffset(idx, range.startContainer, range.startOffset);
  let end = boundaryOffset(idx, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(idx.text[start]!)) start++;
  while (end > start && /\s/.test(idx.text[end - 1]!)) end--;
  if (end <= start) return null;
  return {
    start,
    end,
    quote: idx.text.slice(start, end),
    prefix: idx.text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: idx.text.slice(end, end + CONTEXT_CHARS),
  };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Where the anchor's quote is in the index text: the occurrence whose
 * surrounding text best matches the stored prefix/suffix. Null when the
 * quote is not on the page (e.g. text not revealed yet).
 */
export function findAnchor(
  idx: TextIndex,
  a: { quote: string; prefix?: string | null; suffix?: string | null },
): { start: number; end: number } | null {
  if (!a.quote) return null;
  let best: { start: number; score: number } | null = null;
  for (let i = idx.text.indexOf(a.quote); i >= 0; i = idx.text.indexOf(a.quote, i + 1)) {
    const before = idx.text.slice(Math.max(0, i - CONTEXT_CHARS), i);
    const after = idx.text.slice(i + a.quote.length, i + a.quote.length + CONTEXT_CHARS);
    const score = commonSuffix(before, a.prefix ?? '') + commonPrefix(after, a.suffix ?? '');
    if (!best || score > best.score) best = { start: i, score };
  }
  return best ? { start: best.start, end: best.start + a.quote.length } : null;
}

/** The DOM point under the pointer (for clicking an existing highlight). */
export function caretPointFromXY(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}

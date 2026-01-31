/**
 * Read-only renderer for block-based lesson content.
 * Used on the student-facing view.
 */
import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import katex from 'katex';
import mermaid from 'mermaid';
import type { Block, BlockDocument, CalloutVariant } from './block-types';

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });

// ─── Helpers ──────────────────────────────────────────

function decodeHTMLEntities(str: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = str;
  return textarea.value;
}

function processHtmlMath(raw: string): string {
  let html = raw;

  html = html.replace(
    /<span[^>]*data-inline-math[^>]*latex="([^"]*)"[^>]*>[\s\S]*?<\/span>/g,
    (_, latex) => {
      try {
        return katex.renderToString(decodeHTMLEntities(latex), { throwOnError: false, displayMode: false });
      } catch {
        return latex;
      }
    },
  );

  html = html.replace(
    /<div[^>]*data-block-math[^>]*latex="([^"]*)"[^>]*>[\s\S]*?<\/div>/g,
    (_, latex) => {
      try {
        return `<div style="text-align:center;margin:0.5rem 0">${katex.renderToString(decodeHTMLEntities(latex), { throwOnError: false, displayMode: true })}</div>`;
      } catch {
        return latex;
      }
    },
  );

  return html;
}

// ─── Individual Renderers ─────────────────────────────

function TextRenderer({ html }: { html: string }) {
  const processed = useMemo(() => processHtmlMath(html), [html]);
  return (
    <div
      className="prose prose-sm max-w-none tiptap"
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
}

function ImageRenderer({ src, caption, alt, size, align }: {
  src: string; caption: string; alt: string;
  size: 'small' | 'medium' | 'full';
  align: 'left' | 'center' | 'right';
}) {
  const sizeClass = size === 'small' ? 'max-w-xs' : size === 'full' ? 'w-full' : 'max-w-lg';
  const alignClass = align === 'left' ? '' : align === 'right' ? 'ml-auto' : 'mx-auto';

  return (
    <figure className={`${sizeClass} ${alignClass}`}>
      <img src={src} alt={alt || ''} className="rounded-lg w-full" />
      {caption && (
        <figcaption className="text-xs text-gray-500 text-center mt-1 italic">{caption}</figcaption>
      )}
    </figure>
  );
}

function VideoRenderer({ url, startTime }: { url: string; startTime: number }) {
  const embedUrl = useMemo(() => {
    const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const t = startTime > 0 ? `&start=${startTime}` : '';
      return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0${t}`;
    }
    const vmMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vmMatch) {
      const t = startTime > 0 ? `#t=${startTime}s` : '';
      return `https://player.vimeo.com/video/${vmMatch[1]}${t}`;
    }
    return null;
  }, [url, startTime]);

  if (!embedUrl) return <p className="text-sm text-gray-400">Invalid video URL</p>;

  return (
    <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
      <iframe
        src={embedUrl}
        className="absolute top-0 left-0 w-full h-full rounded-lg"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="Video"
      />
    </div>
  );
}

let _mermaidCounter = 0;

function DiagramRenderer({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const renderMermaid = useCallback(async () => {
    if (!containerRef.current || !code.trim()) return;
    try {
      const id = `mermaid-render-${++_mermaidCounter}`;
      const { svg } = await mermaid.render(id, code);
      if (containerRef.current) containerRef.current.innerHTML = svg;
    } catch {
      if (containerRef.current) containerRef.current.innerHTML = '<p class="text-sm text-red-500">Diagram error</p>';
    }
  }, [code]);

  useEffect(() => {
    renderMermaid();
  }, [renderMermaid]);

  return <div ref={containerRef} className="flex justify-center p-4" />;
}

const CALLOUT_STYLES: Record<CalloutVariant, { icon: string; bg: string; border: string; text: string; label: string }> = {
  tip: { icon: '💡', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900', label: 'Tip' },
  warning: { icon: '⚠️', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900', label: 'Warning' },
  'exam-hint': { icon: '📝', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900', label: 'Exam Hint' },
  'common-mistake': { icon: '❌', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-900', label: 'Common Mistake' },
};

function CalloutRenderer({ variant, html }: { variant: CalloutVariant; html: string }) {
  const s = CALLOUT_STYLES[variant] || CALLOUT_STYLES.tip;
  return (
    <div className={`${s.bg} border ${s.border} rounded-lg overflow-hidden`}>
      <div className={`flex items-center gap-2 px-3 py-2 border-b border-inherit`}>
        <span className="text-base">{s.icon}</span>
        <span className={`text-xs font-semibold ${s.text}`}>{s.label}</span>
      </div>
      <div className={`px-3 py-2 prose prose-sm max-w-none ${s.text}`} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ─── Main Renderer ────────────────────────────────────

function renderBlock(block: Block) {
  switch (block.type) {
    case 'text':
      return <TextRenderer html={(block.data as { html: string }).html} />;
    case 'image': {
      const d = block.data as { src: string; caption: string; alt: string; size: 'small' | 'medium' | 'full'; align: 'left' | 'center' | 'right' };
      return d.src ? <ImageRenderer {...d} /> : null;
    }
    case 'video': {
      const d = block.data as { url: string; startTime: number };
      return d.url ? <VideoRenderer {...d} /> : null;
    }
    case 'diagram':
      return <DiagramRenderer code={(block.data as { code: string }).code} />;
    case 'callout': {
      const d = block.data as { variant: CalloutVariant; html: string };
      return <CalloutRenderer variant={d.variant} html={d.html} />;
    }
    case 'divider':
      return <hr className="border-t border-gray-300 my-4" />;
    default:
      return null;
  }
}

interface Props {
  content: string | null;
}

export default function BlockRenderer({ content }: Props) {
  const doc = useMemo(() => parseDocument(content), [content]);

  if (!doc || doc.blocks.length === 0) {
    return <p className="text-gray-400">No content yet.</p>;
  }

  return (
    <div className="space-y-4">
      {doc.blocks.map((block) => (
        <div key={block.id}>{renderBlock(block)}</div>
      ))}
    </div>
  );
}

// Parse with backward compatibility
function parseDocument(raw: string | null): BlockDocument | null {
  if (!raw || !raw.trim()) return null;

  // Try JSON block document
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && Array.isArray(parsed.blocks)) {
      return parsed as BlockDocument;
    }
  } catch {
    // Not JSON
  }

  // Legacy HTML/text content — render as single text block
  const isHtml = /<[a-z][\s\S]*>/i.test(raw);
  const html = isHtml
    ? raw
    : raw
        .split('\n\n')
        .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
        .join('');

  return {
    version: 2,
    blocks: [{ id: 'legacy', type: 'text', data: { html } }],
  };
}

// Re-export for convenience
export { processHtmlMath };

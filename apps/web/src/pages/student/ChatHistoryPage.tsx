import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatSGT } from '../../lib/formatDateTime';
import { useToast } from '../../components/Toast';
import { ChatMessageContent } from '../../components/ChatMessageContent';
import { MessageSquare, Bot, ArrowLeft, Loader, Download, BookOpen, Clock } from 'lucide-react';

interface ConversationSummary {
  surface: 'chatbot' | 'dialogue';
  id: string;
  title: string;
  courseId: string | null;
  courseTitle: string | null;
  messageCount: number;
  startedAt: string;
  lastMessageAt: string;
  snippet: string | null;
}

interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  contextSource?: string | null;
  selectedText?: string | null;
  // Bug 4 (2026-06-12): per-turn slide context. USER rows carry the
  // PDF page the student was viewing AT THE MOMENT of this question;
  // ASSISTANT rows and dialogue-surface rows leave it null. Lets the
  // review surface render "Re: «…» (page X)" per turn instead of just
  // the LAST selectedText overwriting every prior question.
  currentPage?: number | null;
  suggestedStrategy?: string | null;
  citations?: unknown;
}

interface ConversationDetail {
  surface: 'chatbot' | 'dialogue';
  id: string;
  title: string;
  courseId: string | null;
  courseTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  messages: ConversationMessage[];
}

interface ListResponse {
  items: ConversationSummary[];
  total: number;
}

const SURFACE_META: Record<'chatbot' | 'dialogue', { label: string; icon: JSX.Element }> = {
  chatbot: {
    label: 'Floating chat',
    icon: <Bot size={14} />,
  },
  dialogue: {
    label: 'Dialogue mode',
    icon: <MessageSquare size={14} />,
  },
};

function formatDate(iso: string): string {
  try {
    return formatSGT(iso, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

/**
 * Build a self-contained Markdown transcript suitable for download.
 * Uses ChatMessageContent-compatible Markdown so the file viewed in a
 * Markdown reader looks much like the in-app render (modulo KaTeX which
 * is a renderer feature, not a Markdown feature).
 */
function buildTranscriptMarkdown(detail: ConversationDetail): string {
  const lines: string[] = [];
  lines.push(`# ${detail.title}`);
  lines.push('');
  if (detail.courseTitle) lines.push(`**Course:** ${detail.courseTitle}`);
  lines.push(`**Surface:** ${SURFACE_META[detail.surface].label}  `);
  lines.push(`**Started:** ${formatDate(detail.startedAt)}`);
  if (detail.endedAt) lines.push(`**Ended:** ${formatDate(detail.endedAt)}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of detail.messages) {
    const who = m.role === 'USER' || m.role === 'user' ? 'Student' : 'Assistant';
    lines.push(`### ${who} — ${formatDate(m.createdAt)}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  }
  return lines.join('\n');
}

export function ChatHistoryPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const surfaceParam = searchParams.get('surface');
  const idParam = searchParams.get('id');
  const selected = useMemo(() => {
    if (surfaceParam === 'chatbot' || surfaceParam === 'dialogue') {
      if (idParam) return { surface: surfaceParam as 'chatbot' | 'dialogue', id: idParam };
    }
    return null;
  }, [surfaceParam, idParam]);

  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ─── Load list ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<ListResponse>('/chat-history/me');
        if (!cancelled) setItems(res.items);
      } catch (err) {
        if (!cancelled) {
          setListError(err instanceof Error ? err.message : 'Failed to load history');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Load detail when one is selected ──────────────────────
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    (async () => {
      try {
        const res = await api.get<ConversationDetail>(
          `/chat-history/me/${selected.surface}/${encodeURIComponent(selected.id)}`,
        );
        if (!cancelled) setDetail(res);
      } catch (err) {
        if (!cancelled) {
          toast('error', err instanceof Error ? err.message : 'Failed to load transcript');
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, toast]);

  const handleSelect = useCallback(
    (item: ConversationSummary) => {
      setSearchParams({ surface: item.surface, id: item.id }, { replace: false });
    },
    [setSearchParams],
  );

  const handleBackToList = useCallback(() => {
    setSearchParams({}, { replace: false });
  }, [setSearchParams]);

  const handleDownload = useCallback(() => {
    if (!detail) return;
    const md = buildTranscriptMarkdown(detail);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = detail.title.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'conversation';
    a.download = `${safeTitle}-${detail.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [detail]);

  // ─── Detail view ───────────────────────────────────────────
  if (selected) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={handleBackToList}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800"
          >
            <ArrowLeft size={16} /> Back to history
          </button>
          {detail && (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              title="Download as Markdown"
            >
              <Download size={14} />
              Download (.md)
            </button>
          )}
        </div>

        {detailLoading && (
          <div className="flex items-center justify-center min-h-[200px] text-gray-400">
            <Loader size={20} className="animate-spin mr-2" /> Loading transcript…
          </div>
        )}

        {!detailLoading && detail && (
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                {SURFACE_META[detail.surface].icon}
                <span>{SURFACE_META[detail.surface].label}</span>
                {detail.courseTitle && (
                  <>
                    <span className="text-gray-300">|</span>
                    <BookOpen size={12} />
                    <span>{detail.courseTitle}</span>
                  </>
                )}
              </div>
              <h2 className="text-lg font-semibold text-gray-900">{detail.title}</h2>
              <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                <Clock size={12} />
                Started {formatDate(detail.startedAt)}
                {detail.endedAt && <> · Ended {formatDate(detail.endedAt)}</>}
                <span className="text-gray-300">|</span>
                {detail.messages.length} message{detail.messages.length !== 1 ? 's' : ''}
              </div>
            </div>

            <div className="p-5 space-y-4">
              {detail.messages.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  This conversation has no messages.
                </p>
              ) : (
                detail.messages.map((m) => {
                  const isUser = m.role === 'USER' || m.role === 'user';
                  // Bug 4 (2026-06-12): show per-turn highlighted text +
                  // page number so the student can see "I asked this
                  // about page X" rather than only the LAST selection
                  // overwriting every prior question.
                  const turnSel =
                    isUser && typeof m.selectedText === 'string' && m.selectedText.trim().length > 0
                      ? m.selectedText.trim()
                      : null;
                  const turnPage =
                    isUser && typeof m.currentPage === 'number' && m.currentPage > 0
                      ? m.currentPage
                      : null;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      {(turnSel || turnPage) && (
                        <div className="max-w-[85%] mb-1 text-[10px] italic text-gray-500">
                          {turnSel
                            ? `Re: «${turnSel.slice(0, 80)}${turnSel.length > 80 ? '…' : ''}»`
                            : null}
                          {turnSel && turnPage ? ' ' : ''}
                          {turnPage ? `(page ${turnPage})` : null}
                        </div>
                      )}
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                          isUser
                            ? 'bg-blue-600 text-white rounded-br-md'
                            : 'bg-gray-100 text-gray-900 rounded-bl-md'
                        }`}
                      >
                        {isUser ? (
                          <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                        ) : (
                          <ChatMessageContent content={m.content} className="text-sm" />
                        )}
                        <div
                          className={`mt-1.5 text-[10px] ${
                            isUser ? 'text-blue-100/80' : 'text-gray-400'
                          }`}
                        >
                          {formatDate(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {!detailLoading && !detail && (
          <div className="text-center text-gray-400 py-12">Conversation not found.</div>
        )}
      </div>
    );
  }

  // ─── List view ─────────────────────────────────────────────
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Chat History</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review your past conversations from both the floating chatbot and dialogue mode.
        </p>
      </div>

      {listError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {listError}
        </div>
      )}

      {items === null && !listError && (
        <div className="flex items-center justify-center min-h-[200px] text-gray-400">
          <Loader size={20} className="animate-spin mr-2" /> Loading…
        </div>
      )}

      {items && items.length === 0 && (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <div className="text-gray-400 mb-3 flex justify-center">
            <MessageSquare size={40} />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No conversations yet</h3>
          <p className="text-sm text-gray-500">
            Once you chat with the learning assistant your history will appear here.
          </p>
          <button
            onClick={() => navigate('/student/courses')}
            className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Browse my courses
          </button>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {items.map((it) => (
            <button
              key={`${it.surface}:${it.id}`}
              onClick={() => handleSelect(it)}
              className="w-full text-left px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  {SURFACE_META[it.surface].icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-gray-900 truncate">{it.title}</span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                      {SURFACE_META[it.surface].label}
                    </span>
                  </div>
                  {it.snippet && <p className="text-xs text-gray-500 line-clamp-2">{it.snippet}</p>}
                  <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-1.5">
                    <Clock size={10} />
                    {formatDate(it.lastMessageAt)}
                    <span className="text-gray-300">|</span>
                    {it.messageCount} message{it.messageCount !== 1 ? 's' : ''}
                    {it.courseTitle && (
                      <>
                        <span className="text-gray-300">|</span>
                        <BookOpen size={10} />
                        {it.courseTitle}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChatHistoryPage;

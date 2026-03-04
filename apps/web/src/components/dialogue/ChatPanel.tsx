import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MessageSquare, SendHorizontal } from 'lucide-react';
import { CitationChip } from './CitationChip';
import type { Citation } from './CitationChip';

interface DialogueMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  citations?: Citation[];
  tokenUsage?: { promptTokens: number; completionTokens: number };
  createdAt: string;
}

interface DialogueSession {
  id: string;
  title: string;
  courseId: string;
  activeSourceIds: string[];
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number; studioOutputs: number };
}

interface SuggestedQuestion {
  question: string;
}

interface ChatPanelProps {
  messages: DialogueMessage[];
  isSending: boolean;
  activeSourceCount: number;
  onSend: (content: string) => void;
  onCitationClick: (citation: Citation) => void;
  session: DialogueSession | null;
  suggestedQuestions?: SuggestedQuestion[];
  inputOverride?: string;
  onInputOverrideUsed?: () => void;
  isLoading?: boolean;
  sendError?: string | null;
  onRetry?: () => void;
  onActivateSources?: () => void;
  totalSourceCount?: number;
}

const MAX_CHARS = 8000;

export function ChatPanel({
  messages,
  isSending,
  activeSourceCount,
  onSend,
  onCitationClick,
  session,
  suggestedQuestions,
  inputOverride,
  onInputOverrideUsed,
  isLoading,
  sendError,
  onRetry,
  onActivateSources,
  totalSourceCount = 0,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const [showNoSourcesWarning, setShowNoSourcesWarning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Apply input override (from suggested question clicks)
  useEffect(() => {
    if (inputOverride) {
      setInput(inputOverride);
      onInputOverrideUsed?.();
      textareaRef.current?.focus();
    }
  }, [inputOverride, onInputOverrideUsed]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      const maxHeight = 6 * 24; // 6 rows * ~24px per row
      el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    }
  }, [input]);

  const doSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setShowNoSourcesWarning(false);
    onSend(trimmed);
    setInput('');
  }, [input, isSending, onSend]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    // Show warning if no sources active and there are sources available
    if (activeSourceCount === 0 && totalSourceCount > 0) {
      setShowNoSourcesWarning(true);
      return;
    }
    doSend();
  }, [input, isSending, activeSourceCount, totalSourceCount, doSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Parse inline citations from message content
  const renderMessageContent = (msg: DialogueMessage) => {
    const content = msg.content;
    // Split on citation patterns [Source: DocName, p.X] or [Source N: DocName, p.X]
    const citationRegex = /\[Source\s*\d*:\s*[^\]]+\]/g;
    const parts = content.split(citationRegex);
    const matches = content.match(citationRegex) || [];

    if (matches.length === 0) {
      return (
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      );
    }

    return (
      <div>
        {parts.map((part, i) => (
          <span key={i}>
            <span className="prose prose-sm max-w-none inline">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>
            </span>
            {matches[i] && msg.citations && msg.citations[i] && (
              <CitationChip citation={msg.citations[i]} onClick={onCitationClick} />
            )}
          </span>
        ))}
      </div>
    );
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-4 space-y-4">
        <div className="flex justify-end">
          <div className="w-2/3 h-12 bg-blue-100 rounded-2xl animate-pulse" />
        </div>
        <div className="flex justify-start">
          <div className="w-3/4 h-20 bg-gray-100 rounded-2xl animate-pulse" />
        </div>
        <div className="flex justify-end">
          <div className="w-1/2 h-10 bg-blue-100 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  // Empty state
  if (!session) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-gray-400 p-8">
        <MessageSquare size={48} className="mb-3" />
        <p className="text-sm">Select or create a session to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="text-gray-400 mb-4">
              <MessageSquare size={40} />
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Start a Conversation</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md">
              Ask questions about your study materials. The AI will use your active sources to
              provide grounded answers with citations.
            </p>

            {/* Suggested questions */}
            {suggestedQuestions && suggestedQuestions.length > 0 && (
              <div className="w-full max-w-md">
                <p className="text-xs font-medium text-gray-400 uppercase mb-2">
                  Suggested Questions
                </p>
                <div className="space-y-2">
                  {suggestedQuestions.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(q.question)}
                      className="w-full text-left text-sm p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      {q.question}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'USER' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'USER'
                      ? 'bg-blue-600 text-white rounded-br-md'
                      : 'bg-gray-100 text-gray-900 rounded-bl-md'
                  }`}
                >
                  {msg.role === 'USER' ? (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    renderMessageContent(msg)
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isSending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" />
                    <span
                      className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: '0.1s' }}
                    />
                    <span
                      className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                      style={{ animationDelay: '0.2s' }}
                    />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error state */}
      {sendError && (
        <div className="mx-4 mb-2 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
          <span className="text-red-600">Failed to get a response.</span>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-red-700 font-medium underline hover:text-red-800"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* No sources warning */}
      {showNoSourcesWarning && (
        <div className="mx-4 mb-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm flex items-center justify-between">
          <span className="text-amber-700">
            No sources are active. Your answer won&apos;t be grounded in your materials.
          </span>
          <div className="flex gap-2 ml-2">
            {onActivateSources && (
              <button
                onClick={() => {
                  setShowNoSourcesWarning(false);
                  onActivateSources();
                }}
                className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded font-medium hover:bg-amber-200"
              >
                Activate sources
              </button>
            )}
            <button
              onClick={doSend}
              className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded font-medium hover:bg-gray-200"
            >
              Send anyway
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your sources..."
              rows={1}
              data-dialogue-input
              className="w-full resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="flex items-center justify-between mt-1 px-1">
              <span className="text-xs text-gray-400">
                {activeSourceCount > 0
                  ? `${activeSourceCount} source${activeSourceCount !== 1 ? 's' : ''} active`
                  : 'No sources active'}
              </span>
              <span
                className={`text-xs ${input.length > MAX_CHARS * 0.9 ? 'text-red-500' : 'text-gray-400'}`}
              >
                {input.length}/{MAX_CHARS}
              </span>
            </div>
          </div>
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isSending}
            className="flex-shrink-0 p-2.5 rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <SendHorizontal size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

export type { DialogueMessage, DialogueSession, ChatPanelProps };

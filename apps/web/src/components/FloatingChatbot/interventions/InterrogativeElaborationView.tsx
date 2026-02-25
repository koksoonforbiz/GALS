import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import type { SaveForReviewInput } from '../types';

interface InterrogativeElaborationViewProps {
  selectedText: string;
  courseId: string;
  contentId: string | null;
  pageType: string;
  contentTitle: string;
  onComplete: () => void;
  onBack: () => void;
  onSaveForReview: (data: SaveForReviewInput) => void;
}

interface SuggestedQuestion {
  question: string;
  type: 'why' | 'how';
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  wasSuggested?: boolean;
}

interface ConversationSummary {
  summary: string;
  conceptsCovered: string[];
  questionsAsked: number;
  depthRating: 'surface' | 'moderate' | 'deep';
}

type Phase = 'loading' | 'suggestions' | 'conversation' | 'completing' | 'complete' | 'error';

const DEPTH_STYLES: Record<string, { color: string; label: string }> = {
  surface: { color: 'text-red-600', label: 'Surface' },
  moderate: { color: 'text-yellow-600', label: 'Moderate' },
  deep: { color: 'text-green-600', label: 'Deep' },
};

const DIFFICULTY_STYLES: Record<string, string> = {
  beginner: 'bg-green-50 text-green-700',
  intermediate: 'bg-blue-50 text-blue-700',
  advanced: 'bg-purple-50 text-purple-700',
};

export function InterrogativeElaborationView({
  selectedText,
  courseId,
  contentId,
  pageType,
  contentTitle,
  onComplete,
  onBack,
  onSaveForReview,
}: InterrogativeElaborationViewProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [interventionId, setInterventionId] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
  const [keyConcepts, setKeyConcepts] = useState<string[]>([]);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [usedSuggestions, setUsedSuggestions] = useState<Set<number>>(new Set());
  const [inputValue, setInputValue] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [summary, setSummary] = useState<ConversationSummary | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialGenDone = useRef(false);

  // Auto-scroll to bottom when conversation updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, isAsking]);

  // Generate suggested questions on mount
  const generate = useCallback(async () => {
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        suggestedQuestions: SuggestedQuestion[];
        keyConcepts: string[];
      }>('/learning-interventions/interrogative-elaboration/generate', {
        selectedText,
        courseId,
        contentId: contentId || undefined,
        pageType,
        questionCount: 6,
      });
      setInterventionId(result.interventionId);
      setSuggestedQuestions(result.suggestedQuestions);
      setKeyConcepts(result.keyConcepts);
      setPhase('suggestions');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate suggestions');
      setPhase('error');
    }
  }, [selectedText, courseId, contentId, pageType]);

  useEffect(() => {
    if (initialGenDone.current) return;
    initialGenDone.current = true;
    void generate();
  }, [generate]);

  // Ask a question (from suggestion or typed)
  const handleAskQuestion = async (question: string, suggestionIndex?: number) => {
    if (!interventionId || !question.trim()) return;

    setIsAsking(true);

    // Add user message immediately
    const userMsg: ConversationMessage = {
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
      wasSuggested: suggestionIndex !== undefined,
    };
    const updatedConvo = [...conversation, userMsg];
    setConversation(updatedConvo);

    if (suggestionIndex !== undefined) {
      setUsedSuggestions((prev) => new Set(prev).add(suggestionIndex));
    }

    // Transition to conversation phase after first question
    if (phase === 'suggestions') {
      setPhase('conversation');
      setSuggestionsExpanded(false);
    }

    setInputValue('');

    try {
      const result = await api.post<{ answer: string }>(
        `/learning-interventions/interrogative-elaboration/${interventionId}/ask`,
        {
          question,
          conversationHistory: updatedConvo.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        },
      );

      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: result.answer,
        timestamp: new Date().toISOString(),
      };
      setConversation((prev) => [...prev, assistantMsg]);
    } catch {
      const errorAssistant: ConversationMessage = {
        role: 'assistant',
        content: 'Sorry, I had trouble generating an answer. Please try asking again.',
        timestamp: new Date().toISOString(),
      };
      setConversation((prev) => [...prev, errorAssistant]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleSuggestionClick = (index: number) => {
    const q = suggestedQuestions[index];
    if (!q || usedSuggestions.has(index)) return;
    void handleAskQuestion(q.question, index);
  };

  const handleSubmitInput = () => {
    if (!inputValue.trim() || inputValue.trim().length < 5) return;
    void handleAskQuestion(inputValue.trim());
  };

  const handleWrapUp = async () => {
    if (!interventionId) return;
    setPhase('completing');
    try {
      const result = await api.post<ConversationSummary>(
        `/learning-interventions/interrogative-elaboration/${interventionId}/complete`,
      );
      setSummary(result);
      setPhase('complete');
    } catch {
      // Still show complete phase with fallback
      setSummary({
        summary: 'Session completed.',
        conceptsCovered: keyConcepts.slice(0, 3),
        questionsAsked: conversation.filter((m) => m.role === 'user').length,
        depthRating: 'surface',
      });
      setPhase('complete');
    }
  };

  const handleSave = () => {
    if (!interventionId || !summary) return;

    onSaveForReview({
      interventionId,
      interventionType: 'INTERROGATIVE_ELABORATION',
      title: `Q&A Exploration - ${contentTitle || 'Untitled'}`,
      selectedText,
      savedData: {
        suggestedQuestions,
        conversation: conversation.map((msg) => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          wasSuggested: msg.wasSuggested || false,
        })),
        summary: summary.summary,
        conceptsCovered: summary.conceptsCovered,
        questionsAsked: summary.questionsAsked,
        depthRating: summary.depthRating,
        keyConcepts,
        completedAt: new Date().toISOString(),
      },
    });
    setSaved(true);
  };

  const handleRetry = () => {
    setSuggestedQuestions([]);
    setKeyConcepts([]);
    setConversation([]);
    setUsedSuggestions(new Set());
    setInputValue('');
    setSummary(null);
    setSaved(false);
    setUserNotes('');
    setSuggestionsExpanded(true);
    setShowAllSuggestions(false);
    initialGenDone.current = false;
    void generate();
  };

  // ─── Loading Phase ──────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3 animate-pulse">{'\uD83D\uDCA1'}</div>
        <p className="text-sm text-gray-600">
          Analyzing text and generating question suggestions...
        </p>
        <p className="text-xs text-gray-400 mt-2">This may take a few seconds</p>
      </div>
    );
  }

  // ─── Error Phase ────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3">{'\u26A0\uFE0F'}</div>
        <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={onBack}
            className="text-xs text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  // ─── Completing Phase ───────────────────────────────────
  if (phase === 'completing') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3 animate-pulse">{'\uD83E\uDDE0'}</div>
        <p className="text-sm text-gray-600">Generating conversation summary...</p>
      </div>
    );
  }

  // ─── Complete Phase ─────────────────────────────────────
  if (phase === 'complete' && summary) {
    const depthStyle = DEPTH_STYLES[summary.depthRating] || DEPTH_STYLES['surface']!;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-3 py-3 border-b border-gray-100 bg-gray-50 text-center">
          <div className="text-lg mb-1">{'\uD83C\uDF89'}</div>
          <div className="text-sm font-semibold text-gray-800">Great exploration!</div>
          <div className="text-xs text-gray-600 mt-1 flex items-center justify-center gap-3">
            <span>Questions: {summary.questionsAsked}</span>
            <span className={depthStyle.color}>Depth: {depthStyle.label}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Summary */}
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1">Summary</div>
            <div className="text-xs text-gray-700 bg-blue-50 border border-blue-200 rounded p-2">
              {summary.summary}
            </div>
          </div>

          {/* Concepts */}
          {summary.conceptsCovered.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-600 mb-1">Concepts covered</div>
              <div className="flex flex-wrap gap-1">
                {summary.conceptsCovered.map((c, i) => (
                  <span
                    key={i}
                    className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Add a note (optional)
            </label>
            <textarea
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Reflect on what you learned..."
              className="w-full text-xs border border-gray-300 rounded p-2 h-16 resize-none"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-3 py-2 border-t border-gray-200 space-y-1.5">
          <button
            onClick={handleSave}
            disabled={saved}
            className={`w-full text-xs px-3 py-2 rounded-lg transition-colors ${
              saved
                ? 'bg-green-50 text-green-600 border border-green-200'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {saved ? '\u2713 Saved to My Reviews' : 'Save to My Reviews'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleRetry}
              className="flex-1 text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={onComplete}
              className="flex-1 text-xs text-blue-600 border border-blue-300 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Suggestions & Conversation Phases ──────────────────
  const visibleSuggestions = showAllSuggestions
    ? suggestedQuestions
    : suggestedQuestions.slice(0, 3);
  const hasMore = suggestedQuestions.length > 3 && !showAllSuggestions;
  const isInConversation = phase === 'conversation';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between mb-1">
          <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">
            &larr; Back to chat
          </button>
          <span className="text-xs font-medium text-gray-600">Interrogative Elaboration</span>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Suggestions panel */}
        <div className="border-b border-gray-100">
          {isInConversation ? (
            // Collapsed suggestions header
            <button
              onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
              className="w-full px-3 py-2 text-xs text-left text-gray-600 hover:bg-gray-50 flex items-center gap-1"
            >
              {'\uD83D\uDCA1'} Suggestions
              <span className="text-[10px] text-gray-400 ml-1">
                (tap to {suggestionsExpanded ? 'collapse' : 'expand'})
              </span>
              <span className="ml-auto text-[10px] text-gray-400">
                {suggestionsExpanded ? '\u25B2' : '\u25BC'}
              </span>
            </button>
          ) : (
            <div className="px-3 pt-2 pb-1">
              <div className="text-xs font-medium text-gray-700 flex items-center gap-1">
                {'\uD83D\uDCA1'} Suggested questions to ask:
              </div>
            </div>
          )}

          {/* Suggestion chips */}
          {(!isInConversation || suggestionsExpanded) && (
            <div className="px-3 pb-2 space-y-1.5">
              {visibleSuggestions.map((q, i) => {
                const isUsed = usedSuggestions.has(i);
                return (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(i)}
                    disabled={isUsed || isAsking}
                    className={`w-full text-left text-xs border rounded-lg p-2 transition-colors ${
                      isUsed
                        ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-default'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          q.type === 'why'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700'
                        } ${isUsed ? 'opacity-50' : ''}`}
                      >
                        {q.type.toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={isUsed ? 'line-through' : ''}>{q.question}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[10px] text-gray-400">{q.topic}</span>
                          <span
                            className={`text-[10px] px-1 py-0 rounded ${DIFFICULTY_STYLES[q.difficulty] || ''}`}
                          >
                            {q.difficulty}
                          </span>
                        </div>
                      </div>
                      {isUsed && (
                        <span className="text-[10px] text-gray-400 shrink-0">{'\u2713'} asked</span>
                      )}
                    </div>
                  </button>
                );
              })}

              {hasMore && (
                <button
                  onClick={() => setShowAllSuggestions(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 px-1"
                >
                  {'\u25B8'} Show more suggestions ({suggestedQuestions.length - 3})
                </button>
              )}
            </div>
          )}
        </div>

        {/* "Or type your own" divider (suggestions phase only) */}
        {!isInConversation && (
          <div className="px-3 py-2 text-center text-[10px] text-gray-400">
            &mdash; or type your own question &mdash;
          </div>
        )}

        {/* Conversation messages */}
        {isInConversation && (
          <div className="px-3 py-2 space-y-2">
            {conversation.map((msg, i) => (
              <div key={i}>
                <div className="text-[10px] text-gray-400 mb-0.5">
                  {msg.role === 'user' ? 'You' : 'Tutor'}
                  {msg.wasSuggested && <span className="ml-1 text-blue-400">(suggested)</span>}
                </div>
                <div
                  className={`text-xs rounded-lg p-2 ${
                    msg.role === 'user'
                      ? 'bg-blue-50 border border-blue-200 text-gray-800'
                      : 'bg-gray-50 border border-gray-200 text-gray-700'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isAsking && (
              <div>
                <div className="text-[10px] text-gray-400 mb-0.5">Tutor</div>
                <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-2 text-gray-500 italic animate-pulse">
                  Tutor is thinking...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-3 py-2 border-t border-gray-200 space-y-1.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmitInput();
              }
            }}
            placeholder={isInConversation ? 'Ask a follow-up...' : 'Ask about this text...'}
            disabled={isAsking}
            className="flex-1 text-xs border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
          />
          <button
            onClick={handleSubmitInput}
            disabled={isAsking || !inputValue.trim() || inputValue.trim().length < 5}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {'\u27A4'}
          </button>
        </div>

        {/* Wrap up button (only when in conversation) */}
        {isInConversation && conversation.length >= 2 && (
          <button
            onClick={handleWrapUp}
            disabled={isAsking}
            className="w-full text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {'\u2705'} I&apos;m done &mdash; wrap up
          </button>
        )}
      </div>
    </div>
  );
}

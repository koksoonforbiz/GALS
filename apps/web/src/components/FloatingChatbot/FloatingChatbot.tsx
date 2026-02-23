import { useState, useRef, useEffect } from 'react';
import { usePageContext } from '../../contexts/PageContext';
import { PracticeTestingView } from '../PracticeTestingView';
import { InterrogativeElaborationView } from '../InterrogativeElaborationView';
import { StepwiseLearningView } from '../StepwiseLearningView';
import { DistributedPracticeGenerateView } from '../DistributedPracticeGenerateView';

// ─── Types ─────────────────────────────────────────────────

type ChatbotMode =
  | 'chat'
  | 'practice-testing'
  | 'distributed-practice'
  | 'stepwise-learning'
  | 'interrogative-elaboration';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ─── Page Type Icons ───────────────────────────────────────

const PAGE_TYPE_CONFIG = {
  lesson: { icon: '📖', label: 'Lesson' },
  quiz: { icon: '📝', label: 'Quiz' },
  reading: { icon: '📄', label: 'Reading' },
  dashboard: { icon: '🏠', label: 'Dashboard' },
  'review-queue': { icon: '🔄', label: 'Review Queue' },
  assessments: { icon: '📋', label: 'Assessments' },
  other: { icon: '📌', label: 'Page' },
};

// ─── Component ─────────────────────────────────────────────

export function FloatingChatbot() {
  const { pageType, courseId, contentId, contentTitle, selectedText, clearSelectedText } =
    usePageContext();

  // UI State
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Chatbot State
  const [mode, setMode] = useState<ChatbotMode>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content:
        "Hi! I'm your learning assistant. Select some text from the page and use one of the learning strategies below, or ask me a question!",
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [savedSelectedText, setSavedSelectedText] = useState<string | null>(null);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Save selected text when an intervention is started
  const handleStartIntervention = (interventionMode: ChatbotMode) => {
    setSavedSelectedText(selectedText);
    setMode(interventionMode);
  };

  // Return to chat mode
  const handleBackToChat = () => {
    setMode('chat');
    setSavedSelectedText(null);
  };

  // Complete intervention
  const handleInterventionComplete = () => {
    setMode('chat');
    setSavedSelectedText(null);
    clearSelectedText();

    // Add completion message
    const modeLabels: Record<ChatbotMode, string> = {
      chat: '',
      'practice-testing': 'Practice Testing',
      'distributed-practice': 'Distributed Practice',
      'stepwise-learning': 'Stepwise Learning',
      'interrogative-elaboration': 'Interrogative Elaboration',
    };

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Great job completing the ${modeLabels[mode]} activity! Feel free to select more text or ask me a question.`,
        timestamp: new Date(),
      },
    ]);
  };

  // Handle chat send
  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');

    // Add placeholder response (chat functionality coming later)
    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          'Chat functionality coming soon! For now, try selecting some text from the page and using one of the learning strategies below.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 500);
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Get current page config
  const pageConfig = PAGE_TYPE_CONFIG[pageType] || PAGE_TYPE_CONFIG.other;

  // Text to use for interventions (either saved or current selection)
  const activeText = savedSelectedText || selectedText;

  // ─── Collapsed State (Floating Button) ───────────────────

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-50"
        aria-label="Open learning assistant"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </button>
    );
  }

  // ─── Minimized State ─────────────────────────────────────

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-2 bg-white border border-gray-200 rounded-full shadow-lg px-4 py-2 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-gray-700">Learning Assistant</span>
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
    );
  }

  // ─── Expanded State (Full Panel) ─────────────────────────

  return (
    <div className="fixed bottom-6 right-6 w-[400px] h-[550px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-50">
      {/* ─── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <span className="font-semibold text-sm">Learning Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 hover:bg-white/20 rounded transition-colors"
            aria-label="Minimize"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-white/20 rounded transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ─── Context Indicator ──────────────────────────────── */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>{pageConfig.icon}</span>
          <span className="font-medium">{pageConfig.label}</span>
          {contentTitle && (
            <>
              <span className="text-gray-400">:</span>
              <span className="truncate max-w-[200px]">{contentTitle}</span>
            </>
          )}
        </div>
      </div>

      {/* ─── Selected Text Banner ───────────────────────────── */}
      {activeText && mode === 'chat' && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
                <span className="text-xs font-medium text-amber-700">Selected text</span>
              </div>
              <p className="text-xs text-amber-800 line-clamp-2">
                "{activeText.slice(0, 100)}
                {activeText.length > 100 ? '...' : ''}"
              </p>
            </div>
            <button
              onClick={clearSelectedText}
              className="text-xs text-amber-600 hover:text-amber-800 font-medium shrink-0"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ─── Main Content Area ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4">
        {mode === 'chat' ? (
          // Chat messages
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          // Intervention views
          <div className="h-full">
            {mode === 'practice-testing' && activeText && (
              <PracticeTestingView
                selectedText={activeText}
                courseId={courseId || ''}
                contentId={contentId || ''}
                pageType={pageType}
                onComplete={handleInterventionComplete}
                onBack={handleBackToChat}
              />
            )}
            {mode === 'interrogative-elaboration' && activeText && (
              <InterrogativeElaborationView
                selectedText={activeText}
                courseId={courseId || ''}
                contentId={contentId || ''}
                pageType={pageType}
                onComplete={handleInterventionComplete}
                onBack={handleBackToChat}
              />
            )}
            {mode === 'stepwise-learning' && activeText && (
              <StepwiseLearningView
                selectedText={activeText}
                courseId={courseId || ''}
                contentId={contentId || ''}
                pageType={pageType}
                onComplete={handleInterventionComplete}
                onBack={handleBackToChat}
              />
            )}
            {mode === 'distributed-practice' && activeText && (
              <DistributedPracticeGenerateView
                selectedText={activeText}
                courseId={courseId || ''}
                contentId={contentId || ''}
                pageType={pageType}
                onComplete={handleInterventionComplete}
                onBack={handleBackToChat}
              />
            )}
          </div>
        )}
      </div>

      {/* ─── Intervention Buttons (when text selected in chat mode) ─ */}
      {activeText && mode === 'chat' && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
          <p className="text-xs text-gray-500 mb-2">Apply learning strategy:</p>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleStartIntervention('practice-testing')}
              className="flex-1 px-2 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              title="Practice Testing"
            >
              Practice
            </button>
            <button
              onClick={() => handleStartIntervention('distributed-practice')}
              className="flex-1 px-2 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
              title="Distributed Practice (Flashcards)"
            >
              Flashcards
            </button>
            <button
              onClick={() => handleStartIntervention('stepwise-learning')}
              className="flex-1 px-2 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
              title="Stepwise Learning"
            >
              Stepwise
            </button>
            <button
              onClick={() => handleStartIntervention('interrogative-elaboration')}
              className="flex-1 px-2 py-1.5 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
              title="Interrogative Elaboration"
            >
              Elaborate
            </button>
          </div>
        </div>
      )}

      {/* ─── Chat Input (only in chat mode) ─────────────────── */}
      {mode === 'chat' && (
        <div className="px-4 py-3 border-t border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim()}
              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

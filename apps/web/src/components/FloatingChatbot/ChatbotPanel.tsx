import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageContext } from '../../contexts/PageContext';
import { api } from '../../lib/api';
import { ReviewTabView } from './ReviewTabView';
import { PracticeTestingView } from './interventions/PracticeTestingView';
import { InterrogativeElaborationView } from './interventions/InterrogativeElaborationView';
import { StepwiseLearningView } from './interventions/StepwiseLearningView';
import { DistributedPracticeView } from './interventions/DistributedPracticeView';
import type { ChatbotMode, ChatMessage, SaveForReviewInput } from './types';
import {
  GraduationCap,
  BookOpen,
  TextSelect,
  Clock,
  BookMarked,
  SendHorizontal,
  Minus,
  Maximize2,
  Minimize2,
  X,
  FlaskConical,
  Layers,
  Footprints,
  MessageCircleQuestion,
} from 'lucide-react';

const PAGE_TYPE_LABELS: Record<string, string> = {
  lesson: 'Lesson',
  quiz: 'Quiz',
  reading: 'Reading',
  dashboard: 'Dashboard',
  'review-tab': 'Review',
  other: 'Page',
};

interface ChatbotPanelProps {
  onMinimize: () => void;
  onToggleMaximize: () => void;
  isMaximized: boolean;
}

export function ChatbotPanel({ onMinimize, onToggleMaximize, isMaximized }: ChatbotPanelProps) {
  const { pageType, courseId, contentId, contentTitle, selectedText, clearSelectedText } =
    usePageContext();

  const navigate = useNavigate();

  const [mode, setMode] = useState<ChatbotMode>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dueCount, setDueCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Save-for-Review Handler ──────────────────────────────
  const handleSaveForReview = useCallback(
    async (data: SaveForReviewInput) => {
      setSaveStatus('saving');
      try {
        await api.post('/learning-interventions/saved-reviews', {
          ...data,
          courseId: courseId || '',
          contentId: contentId || undefined,
          pageType,
        });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [courseId, contentId, pageType],
  );

  // Fetch due cards count
  useEffect(() => {
    api
      .get<{ dueToday: number }>('/learning-interventions/distributed-practice/stats')
      .then((stats) => setDueCount(stats.dueToday))
      .catch(() => {});
  }, [mode]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputValue,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Chat coming soon. Select text and try a learning strategy!',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInputValue('');
  };

  const handleInterventionClick = (type: ChatbotMode) => {
    if (!selectedText || !courseId) return;
    setMode(type);
  };

  const handleBackToChat = () => {
    setMode('chat');
  };

  // ─── Review Tab Mode ────────────────────────────────────
  if (mode === 'review-tab') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={true}
        />
        <ReviewTabView onBack={handleBackToChat} />
      </div>
    );
  }

  // ─── Practice Testing Mode ──────────────────────────────
  if (mode === 'practice-testing') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <PracticeTestingView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Interrogative Elaboration Mode ─────────────────────
  if (mode === 'interrogative-elaboration') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <InterrogativeElaborationView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Stepwise Learning Mode ─────────────────────────────
  if (mode === 'stepwise-learning') {
    // Check for resumable session
    let resumeSessionId: string | null = null;
    try {
      const stored = localStorage.getItem(`stepwise_session_${courseId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Only resume if less than 24 hours old
        if (parsed?.sessionId && Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          resumeSessionId = parsed.sessionId;
        } else {
          localStorage.removeItem(`stepwise_session_${courseId}`);
        }
      }
    } catch {
      // ignore localStorage errors
    }

    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <StepwiseLearningView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          resumeSessionId={resumeSessionId}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Distributed Practice Mode ──────────────────────────
  if (mode === 'distributed-practice') {
    return (
      <div className="flex flex-col h-full bg-white">
        <PanelHeader
          onMinimize={onMinimize}
          onToggleMaximize={onToggleMaximize}
          isMaximized={isMaximized}
          onReviewTab={() => setMode('review-tab')}
          isReviewTab={false}
        />
        <DistributedPracticeView
          selectedText={selectedText || ''}
          courseId={courseId || ''}
          contentId={contentId}
          pageType={pageType}
          contentTitle={contentTitle || ''}
          onComplete={handleBackToChat}
          onBack={handleBackToChat}
          onSaveForReview={handleSaveForReview}
        />
      </div>
    );
  }

  // ─── Chat Mode ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white">
      <PanelHeader
        onMinimize={onMinimize}
        onToggleMaximize={onToggleMaximize}
        isMaximized={isMaximized}
        onReviewTab={() => setMode('review-tab')}
        isReviewTab={false}
      />

      {/* Context indicator */}
      <div className="px-3 py-1.5 border-b border-gray-100 text-xs text-gray-500 bg-gray-50 flex items-center gap-1.5">
        <BookOpen size={14} />
        <span>
          {PAGE_TYPE_LABELS[pageType] || 'Page'}
          {contentTitle ? `: ${contentTitle}` : ''}
        </span>
      </div>

      {/* Selected text banner */}
      {selectedText && (
        <div className="px-3 py-1.5 border-b border-yellow-200 bg-yellow-50 flex items-center gap-2 text-xs">
          <span className="text-gray-600 truncate flex-1 inline-flex items-center gap-1">
            <TextSelect size={14} className="shrink-0" />
            &quot;{selectedText.slice(0, 60)}
            {selectedText.length > 60 ? '...' : ''}&quot;
          </span>
          <button
            onClick={clearSelectedText}
            className="text-gray-400 hover:text-gray-600 whitespace-nowrap"
          >
            Clear
          </button>
        </div>
      )}

      {/* Due cards banner */}
      {dueCount > 0 && (
        <button
          onClick={() => navigate('/student/review-queue')}
          className="w-full px-3 py-1.5 border-b border-blue-200 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 transition-colors text-left flex items-center gap-2"
        >
          <Clock size={14} />
          <span>
            You have {dueCount} card{dueCount !== 1 ? 's' : ''} due!
          </span>
          <span className="ml-auto text-blue-500">Go to Review Queue &rarr;</span>
        </button>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">
            <div className="mb-2 flex justify-center"><GraduationCap size={28} className="text-gray-400" /></div>
            <p>Hi! I&apos;m your learning assistant.</p>
            <p className="mt-1">Select text on the page and use a learning strategy below.</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-lg text-xs ${
                  msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Intervention buttons (show when text is selected) */}
      {selectedText && (
        <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
          <div className="text-xs text-gray-500 mb-1.5">Apply learning strategy:</div>
          {!courseId && (
            <div className="text-[10px] text-amber-600 mb-1">
              Navigate to a course to use learning strategies.
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <InterventionButton
              label="Practice"
              icon={<FlaskConical size={12} />}
              onClick={() => handleInterventionClick('practice-testing')}
              disabled={!courseId}
            />
            <InterventionButton
              label="Distributed"
              icon={<Layers size={12} />}
              onClick={() => handleInterventionClick('distributed-practice')}
              disabled={!courseId}
            />
            <InterventionButton
              label="Step"
              icon={<Footprints size={12} />}
              onClick={() => handleInterventionClick('stepwise-learning')}
              disabled={!courseId}
            />
            <InterventionButton
              label="Elab"
              icon={<MessageCircleQuestion size={12} />}
              onClick={() => handleInterventionClick('interrogative-elaboration')}
              disabled={!courseId}
            />
          </div>
        </div>
      )}

      {/* Save status indicator */}
      {saveStatus !== 'idle' && (
        <div
          className={`px-3 py-1 text-xs text-center ${
            saveStatus === 'saving'
              ? 'bg-blue-50 text-blue-600'
              : saveStatus === 'saved'
                ? 'bg-green-50 text-green-600'
                : 'bg-red-50 text-red-600'
          }`}
        >
          {saveStatus === 'saving' && 'Saving to Review Tab...'}
          {saveStatus === 'saved' && 'Saved to Review Tab!'}
          {saveStatus === 'error' && 'Failed to save. Try again.'}
        </div>
      )}

      {/* Chat input */}
      <div className="px-3 py-2 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 text-xs border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            <SendHorizontal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function PanelHeader({
  onMinimize,
  onToggleMaximize,
  isMaximized,
  onReviewTab,
  isReviewTab,
}: {
  onMinimize: () => void;
  onToggleMaximize: () => void;
  isMaximized: boolean;
  onReviewTab: () => void;
  isReviewTab: boolean;
}) {
  return (
    <div className="chatbot-drag-handle flex items-center justify-between px-3 py-2 bg-blue-600 text-white cursor-grab active:cursor-grabbing select-none rounded-t-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GraduationCap size={18} />
        <span>Learning Assistant</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onReviewTab();
          }}
          className={`w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors ${
            isReviewTab ? 'bg-blue-500' : ''
          }`}
          title="My Reviews"
        >
          <BookMarked size={14} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMinimize();
          }}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleMaximize();
          }}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMinimize();
          }}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-blue-500 transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function InterventionButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-2.5 py-1 rounded-full transition-colors inline-flex items-center gap-1 ${
        disabled
          ? 'bg-gray-100 border border-gray-200 text-gray-400 cursor-not-allowed'
          : 'bg-white border border-gray-300 text-gray-700 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

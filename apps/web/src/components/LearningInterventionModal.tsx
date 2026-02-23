import { useState } from 'react';
import { PracticeTestingView } from './PracticeTestingView';

type InterventionType =
  | 'PRACTICE_TESTING'
  | 'DISTRIBUTED_PRACTICE'
  | 'STEPWISE_LEARNING'
  | 'INTERROGATIVE_ELABORATION';

interface LearningInterventionModalProps {
  selectedText: string;
  courseId: string;
  contentId: string;
  isOpen: boolean;
  onClose: () => void;
}

const INTERVENTION_BUTTONS: Array<{
  type: InterventionType;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    type: 'PRACTICE_TESTING',
    label: 'Practice Testing',
    icon: '📝',
    description: 'Generate quiz questions to test your understanding',
  },
  {
    type: 'DISTRIBUTED_PRACTICE',
    label: 'Distributed Practice',
    icon: '📅',
    description: 'Create spaced repetition flashcards for long-term retention',
  },
  {
    type: 'STEPWISE_LEARNING',
    label: 'Stepwise Learning',
    icon: '🪜',
    description: 'Break down complex concepts into digestible steps',
  },
  {
    type: 'INTERROGATIVE_ELABORATION',
    label: 'Interrogative Elaboration',
    icon: '🤔',
    description: 'Generate "why" and "how" questions to deepen understanding',
  },
];

export function LearningInterventionModal({
  selectedText,
  courseId,
  contentId,
  isOpen,
  onClose,
}: LearningInterventionModalProps) {
  const [activeIntervention, setActiveIntervention] = useState<InterventionType | null>(null);

  if (!isOpen) return null;

  const handleInterventionClick = (type: InterventionType) => {
    setActiveIntervention(type);
  };

  const handleClose = () => {
    setActiveIntervention(null);
    onClose();
  };

  const handleClearSelection = () => {
    setActiveIntervention(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Learning Intervention</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Selected Text Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Selected Text:
              </h3>
              <button
                onClick={handleClearSelection}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear Selection
              </button>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-32 overflow-y-auto">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedText}</p>
            </div>
            <p className="mt-1 text-xs text-gray-400">{selectedText.length} characters selected</p>
          </div>

          {/* Intervention Selection */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              Choose an intervention:
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {INTERVENTION_BUTTONS.map((intervention) => (
                <button
                  key={intervention.type}
                  onClick={() => handleInterventionClick(intervention.type)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    activeIntervention === intervention.type
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl">{intervention.icon}</span>
                    <span className="font-medium text-gray-900">{intervention.label}</span>
                  </div>
                  <p className="text-xs text-gray-500">{intervention.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Active Intervention Content Area */}
          {activeIntervention && (
            <div
              className={
                activeIntervention === 'PRACTICE_TESTING'
                  ? ''
                  : 'bg-gray-50 border border-gray-200 rounded-lg p-6'
              }
            >
              {activeIntervention === 'PRACTICE_TESTING' && (
                <PracticeTestingView
                  selectedText={selectedText}
                  courseId={courseId}
                  contentId={contentId}
                  onComplete={handleClose}
                  onBack={() => setActiveIntervention(null)}
                />
              )}
              {activeIntervention === 'DISTRIBUTED_PRACTICE' && (
                <div className="text-center text-gray-500">
                  <p>Distributed Practice coming in Stage 3...</p>
                </div>
              )}
              {activeIntervention === 'STEPWISE_LEARNING' && (
                <div className="text-center text-gray-500">
                  <p>Stepwise Learning coming in Stage 4...</p>
                </div>
              )}
              {activeIntervention === 'INTERROGATIVE_ELABORATION' && (
                <div className="text-center text-gray-500">
                  <p>Interrogative Elaboration coming in Stage 5...</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer - hidden for now, will be used in later stages */}
        {/* <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Generate
            </button>
          </div>
        </div> */}
      </div>
    </div>
  );
}

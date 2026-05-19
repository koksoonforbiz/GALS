export interface GenerateQuestionsDto {
  courseId: string;
  sourceDocumentIds: string[];
  questionTypes: string[]; // ["mcq", "true_false", "short_answer", "open_ended"]
  questionCount: number; // 1-30
  difficultyMix?: { easy: number; medium: number; hard: number };
  additionalInstructions?: string;
}

export interface ReviewQuestionDto {
  action: 'approve' | 'reject' | 'edit';
  editedQuestion?: {
    questionText?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    knowledgeTags?: string[];
    options?: { label: string; text: string; isCorrect: boolean }[];
    answerKey?: Record<string, unknown>;
  };
}

export interface GradeOpenEndedDto {
  questionId: string;
  studentAnswer: string;
  courseId: string;
  feedbackLevels: string[]; // HattieFeedbackLevel[]
}

export interface RegenerateDto {
  count: number;
}

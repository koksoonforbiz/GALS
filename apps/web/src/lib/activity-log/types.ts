export type ActivityAction =
  | 'SESSION_START'
  | 'SESSION_END'
  | 'SESSION_HEARTBEAT'
  | 'MODULE_OPENED'
  | 'MODULE_ITEM_VIEWED'
  | 'KC_GRAPH_VIEWED'
  | 'ASSESSMENT_STARTED'
  | 'QUESTION_VIEWED'
  | 'QUESTION_ANSWERED'
  | 'ASSESSMENT_SUBMITTED'
  | 'ASSESSMENT_GRADED'
  | 'DIALOGUE_SESSION_STARTED'
  | 'DIALOGUE_MESSAGE_SENT'
  | 'DIALOGUE_MESSAGE_RECEIVED'
  | 'DIALOGUE_SESSION_ENDED'
  | 'INTERVENTION_TRIGGERED'
  | 'INTERVENTION_VIEWED'
  | 'INTERVENTION_COMPLETED'
  | 'INTERVENTION_DISMISSED'
  | 'SPACED_REP_CARD_VIEWED'
  | 'SPACED_REP_CARD_RATED'
  | 'STUDY_MATERIAL_UPLOADED'
  | 'STUDY_GUIDE_GENERATED'
  | 'STUDIO_OUTPUT_REQUESTED'
  | 'STUDIO_OUTPUT_VIEWED'
  | 'MASTERY_UPDATED'
  | 'FEEDBACK_RECEIVED';

export interface ActivityEvent {
  action: ActivityAction;
  occurredAt: string; // ISO string

  courseId?: string;
  moduleId?: string;
  moduleItemId?: string;
  assessmentId?: string;
  attemptId?: string;
  questionId?: string;
  dialogueSessionId?: string;
  interventionId?: string;
  kcId?: string;

  metadata?: Record<string, unknown>;
}

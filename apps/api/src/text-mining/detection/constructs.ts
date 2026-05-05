export type LabelType = 'binary' | 'ordinal' | 'engagement';

export interface Construct {
  key: string;
  displayName: string;
  labelType: LabelType;
  feasibility: 1 | 2 | 3 | 4 | 5;
  topicSpecific: boolean;
  needsRetrieval: boolean;
  warning: string | null;
}

export const CONSTRUCTS: Construct[] = [
  {
    key: 'metacognition_general',
    displayName: 'Metacognition (general)',
    labelType: 'binary',
    feasibility: 5,
    topicSpecific: false,
    needsRetrieval: false,
    warning: null,
  },
  {
    key: 'metacognitive_monitoring',
    displayName: 'Metacognitive monitoring',
    labelType: 'binary',
    feasibility: 5,
    topicSpecific: false,
    needsRetrieval: false,
    warning: 'Cross-domain transfer drops AUC 0.10-0.20',
  },
  {
    key: 'attention_regulation',
    displayName: 'Attention / mind-wandering',
    labelType: 'binary',
    feasibility: 2,
    topicSpecific: false,
    needsRetrieval: false,
    warning: 'Text-only kappa ceiling around 0.21',
  },
  {
    key: 'working_memory',
    displayName: 'Working memory load',
    labelType: 'ordinal',
    feasibility: 2,
    topicSpecific: false,
    needsRetrieval: false,
    warning: 'Text-only WM detection is weak; pair with keystroke features for production',
  },
  {
    key: 'cognitive_flexibility',
    displayName: 'Cognitive flexibility',
    labelType: 'binary',
    feasibility: 1,
    topicSpecific: false,
    needsRetrieval: false,
    warning: 'Surface marker; not validated as EF set-shifting',
  },
  {
    key: 'confusion',
    displayName: 'Confusion',
    labelType: 'binary',
    feasibility: 5,
    topicSpecific: false,
    needsRetrieval: false,
    warning: null,
  },
  {
    key: 'frustration',
    displayName: 'Frustration',
    labelType: 'binary',
    feasibility: 4,
    topicSpecific: false,
    needsRetrieval: false,
    warning: null,
  },
  {
    key: 'engagement',
    displayName: 'Engagement / off-task',
    labelType: 'engagement',
    feasibility: 4,
    topicSpecific: true,
    needsRetrieval: true,
    warning: null,
  },
  {
    key: 'boredom',
    displayName: 'Boredom',
    labelType: 'binary',
    feasibility: 2,
    topicSpecific: false,
    needsRetrieval: false,
    warning: "GoEmotions excluded boredom; D'Mello 2008 ceiling 69%",
  },
];

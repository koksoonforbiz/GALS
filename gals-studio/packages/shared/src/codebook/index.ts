/**
 * The default hierarchical, versioned codebook. Seeds: BROMP behavior + Pekrun
 * affect, plus EF-event and motivation dimensions from the methods review.
 *
 * Shortcuts: affect on 1-9, behavior on q w e r t y u, EF events on
 * a s d f g h j k, motivation on z x c v.
 */

export type Dimension = 'affect' | 'behavior' | 'ef_event' | 'motivation';

export interface CodeDef {
  key: string;
  label: string;
  dimension: Dimension;
  color: string;
  shortcut: string;
  definition: string;
  inclusion?: string;
  exclusion?: string;
  /** affect/behavior are single-valued per window; ef_event/motivation are multi. */
  cardinality: 'single' | 'multi';
  /** annotation anchoring: window-level vs point/range. */
  anchor: 'window' | 'point' | 'range';
}

export interface Codebook {
  name: string;
  version: string;
  dimensions: Record<Dimension, { label: string; cardinality: 'single' | 'multi'; anchor: CodeDef['anchor'] }>;
  codes: CodeDef[];
}

const affect = (key: string, label: string, shortcut: string, color: string, definition: string, inclusion?: string, exclusion?: string): CodeDef =>
  ({ key, label, dimension: 'affect', color, shortcut, definition, inclusion, exclusion, cardinality: 'single', anchor: 'window' });

const behavior = (key: string, label: string, shortcut: string, color: string, definition: string, inclusion?: string, exclusion?: string): CodeDef =>
  ({ key, label, dimension: 'behavior', color, shortcut, definition, inclusion, exclusion, cardinality: 'single', anchor: 'window' });

const ef = (key: string, label: string, shortcut: string, color: string, definition: string): CodeDef =>
  ({ key, label, dimension: 'ef_event', color, shortcut, definition, cardinality: 'multi', anchor: 'point' });

const mot = (key: string, label: string, shortcut: string, color: string, definition: string): CodeDef =>
  ({ key, label, dimension: 'motivation', color, shortcut, definition, cardinality: 'multi', anchor: 'range' });

export const DEFAULT_CODEBOOK: Codebook = {
  name: 'GALS Default Codebook',
  version: '1.0',
  dimensions: {
    affect: { label: 'Affect', cardinality: 'single', anchor: 'window' },
    behavior: { label: 'Behavior', cardinality: 'single', anchor: 'window' },
    ef_event: { label: 'EF Event', cardinality: 'multi', anchor: 'point' },
    motivation: { label: 'Motivation', cardinality: 'multi', anchor: 'range' },
  },
  codes: [
    // AFFECT (Pekrun / BROMP-aligned; exactly one primary per window)
    affect('engaged_concentration', 'Engaged Concentration', '1', '#16a34a',
      'Focused, absorbed, on-task flow.', 'Sustained attention to task; visible effort.', 'Not mere on-task behavior without engagement cues.'),
    affect('confusion', 'Confusion', '2', '#f59e0b',
      'Uncertainty / impasse; may be productive.', 'Re-reading, hesitation, puzzled expression.', 'Do not treat instantaneous confusion as alarm — productive confusion is good.'),
    affect('frustration', 'Frustration', '3', '#dc2626',
      'Blocked goal, irritation.', 'Repeated failed attempts, agitation.', 'Distinguish from transient confusion.'),
    affect('boredom', 'Boredom', '4', '#6b7280',
      'Disengagement, low arousal.', 'Idle, wandering attention, sighs.', 'Not the same as off-task (that is behavior).'),
    affect('delight', 'Delight', '5', '#0ea5e9',
      'Positive surprise / satisfaction.', 'Smiling after success.', ''),
    affect('surprise', 'Surprise', '6', '#8b5cf6',
      'Brief startle / unexpected event reaction.', '', ''),
    affect('anxiety', 'Anxiety', '7', '#db2777',
      'Worry, test/performance pressure.', '', ''),
    affect('neutral', 'Neutral', '8', '#94a3b8',
      'No clear affect.', '', ''),
    affect('unclear', 'Unclear', '9', '#cbd5e1',
      'Insufficient evidence to code affect.', 'Use to avoid forced false positives.', ''),

    // BEHAVIOR (BROMP; exactly one per window)
    behavior('on_task', 'On Task', 'q', '#16a34a', 'Working on the assigned activity.'),
    behavior('on_task_conversation', 'On-Task Conversation', 'w', '#22c55e', 'Talking/chatting about the task.'),
    behavior('off_task_idle', 'Off-Task Idle', 'e', '#9ca3af', 'Disengaged, doing nothing.'),
    behavior('off_task_tab_switch', 'Off-Task Tab Switch', 'r', '#f97316', 'Switched to unrelated tab/app.'),
    behavior('off_task_social', 'Off-Task Social', 't', '#f59e0b', 'Off-task social interaction.'),
    behavior('gaming_the_system', 'Gaming the System', 'y', '#ef4444', 'Systematic guessing/abuse of help to advance.'),
    behavior('wtf_behavior', 'WTF Behavior', 'u', '#7c3aed', 'Behavior unrelated to the task in unexpected ways.'),

    // EF EVENT (point annotations, multiple per window)
    ef('task_initiation_failure', 'Task Initiation Failure', 'a', '#dc2626', 'Failure to start after prompt/opportunity.'),
    ef('distraction_onset', 'Distraction Onset', 's', '#f97316', 'Moment attention leaves the task.'),
    ef('distraction_recovery', 'Distraction Recovery', 'd', '#22c55e', 'Moment attention returns to the task.'),
    ef('plan_articulation', 'Plan Articulation', 'f', '#0ea5e9', 'Student states a plan/strategy.'),
    ef('goal_abandonment', 'Goal Abandonment', 'g', '#ef4444', 'Gives up a stated goal.'),
    ef('help_seeking', 'Help Seeking', 'h', '#8b5cf6', 'Requests help (chatbot, teacher, peer).'),
    ef('self_correction', 'Self Correction', 'j', '#16a34a', 'Catches and fixes own error.'),
    ef('strategy_switch', 'Strategy Switch', 'k', '#06b6d4', 'Changes approach mid-task.'),

    // MOTIVATION INDICATOR (point or range)
    mot('high_effort_episode', 'High-Effort Episode', 'z', '#16a34a', 'Sustained visible effort.'),
    mot('effort_withdrawal', 'Effort Withdrawal', 'x', '#f59e0b', 'Effort visibly drops.'),
    mot('persistence_after_failure', 'Persistence After Failure', 'c', '#0ea5e9', 'Keeps trying after a failure.'),
    mot('giving_up', 'Giving Up', 'v', '#dc2626', 'Stops trying.'),
  ],
};

export const codeByKey = (key: string): CodeDef | undefined =>
  DEFAULT_CODEBOOK.codes.find((c) => c.key === key);

export const codesForDimension = (d: Dimension): CodeDef[] =>
  DEFAULT_CODEBOOK.codes.filter((c) => c.dimension === d);

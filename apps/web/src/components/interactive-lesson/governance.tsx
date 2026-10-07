/**
 * Phase 6 learner-facing governance and nudges for interactive lessons:
 * - ConsentPanel: the plain-language notice (plan 6.2 #2) and the three
 *   text-capture choices (6.2 #1). Nothing is pre-ticked; no decision = no
 *   consent. The learner can reopen it from the lesson bar and change or
 *   revoke a choice at any time.
 * - NudgeCard: a rule-triggered nudge (6.1) that says why it appeared and can
 *   be dismissed. Nudges only exist when a researcher enables a policy.
 */
import { useState } from 'react';
import type { TextConsentDecision } from '@ats/shared';

export interface ConsentChoice {
  answerText: boolean;
  promptsAndOutputs: boolean;
  researchUse: boolean;
}

export function ConsentPanel({
  current,
  onSave,
  onClose,
}: {
  current: TextConsentDecision | null;
  onSave: (c: ConsentChoice) => Promise<void>;
  onClose?: () => void;
}) {
  const [choice, setChoice] = useState<ConsentChoice>({
    answerText: current?.answerText ?? false,
    promptsAndOutputs: current?.promptsAndOutputs ?? false,
    researchUse: current?.researchUse ?? false,
  });
  const [saving, setSaving] = useState(false);
  const toggle = (k: keyof ConsentChoice) => setChoice((c) => ({ ...c, [k]: !c[k] }));
  return (
    <div className="box concept il-consent" role="dialog" aria-label="What this course records">
      <div className="box-title">What this course records, and your choices</div>
      <p>
        While you work through this course, GALS records <b>what you do</b>: which slides you open
        and for how long, when you save an answer or reveal a reference, your confidence ratings,
        self-scores, and how you use the Prompt Lab (runs, versions, tests, copy and paste between
        the AI output and your answers). It records <b>how long</b> your answers are, but not their
        wording unless you agree below. It never records keystrokes or clipboard contents.
      </p>
      <p>
        <b>Why:</b> to give you feedback on how you work with AI, and — if you agree — for research
        on how working adults learn to prompt. Results are reported without your name.
      </p>
      <label className="il-check">
        <input type="checkbox" checked={choice.answerText} onChange={() => toggle('answerText')} />{' '}
        Keep the text of my saved answers, predictions and reflections in the activity record.
      </label>
      <label className="il-check">
        <input
          type="checkbox"
          checked={choice.promptsAndOutputs}
          onChange={() => toggle('promptsAndOutputs')}
        />{' '}
        Keep my Prompt Lab prompts and the AI outputs after I log out. (If not, they are kept only
        for this session.)
      </label>
      <label className="il-check">
        <input
          type="checkbox"
          checked={choice.researchUse}
          onChange={() => toggle('researchUse')}
        />{' '}
        Use my course data, without my name, for research.
      </label>
      <p className="pl-muted">
        You can change any of these later from “Privacy & data” at the top of the lesson.
      </p>
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(choice);
            } finally {
              setSaving(false);
            }
          }}
        >
          Save my choices
        </button>
        {onClose && (
          <button type="button" className="btn secondary" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}

export interface Nudge {
  id: string;
  ruleId: string;
  message: string;
  rationale: string;
  slideKey: string | null;
}

export function NudgeCard({
  nudge,
  onAccept,
  onDismiss,
  onGoToSlide,
}: {
  nudge: Nudge;
  onAccept: () => void;
  onDismiss: () => void;
  onGoToSlide?: () => void;
}) {
  const [why, setWhy] = useState(false);
  return (
    <div className="il-nudge" role="status" aria-live="polite">
      <div className="il-nudge-msg">{nudge.message}</div>
      {why && <div className="il-nudge-why">Why you are seeing this: {nudge.rationale}</div>}
      <div className="il-nudge-actions">
        {onGoToSlide && (
          <button type="button" onClick={onGoToSlide}>
            Go to that slide
          </button>
        )}
        <button type="button" onClick={onAccept}>
          OK
        </button>
        <button type="button" onClick={() => setWhy((w) => !w)}>
          {why ? 'Hide why' : 'Why?'}
        </button>
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
  );
}

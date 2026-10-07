/**
 * One React component per slide type of the prompting course. Behaviour,
 * gates and wording reproduce docs/process-mining/course_slides.html
 * (render() and textGate()) exactly; only persistence changes — saved work
 * goes to the server via `save`, not localStorage.
 *
 * Every free-text field sits under `data-replay-redact` so DOM replay
 * snapshots never carry learner text (PHASE0_DISCOVERY.md decision (f)).
 */
import { useMemo, useState } from 'react';
import type { LessonMcqOption, LessonSessionMeta, LessonSlide } from '@ats/shared';
import { LESSON_GATES } from './gates';
import type { SlideFields } from './useLessonData';
import { mcqOrder } from './mcqOrder';
import type { LessonEventName } from './lessonEvents';
import { PromptLab } from './prompt-lab/PromptLab';

export type { LessonEventName };

export type LessonEmit = (name: LessonEventName, data?: Record<string, unknown>) => void;

export interface SlideProps {
  slide: LessonSlide;
  session: LessonSessionMeta;
  index: number;
  total: number;
  fields: SlideFields;
  save: (patch: SlideFields) => void;
  emit: LessonEmit;
  onAdvance: () => void;
  /** The session's self-score criteria, shown early on the Objectives slide. */
  sessionCriteria?: string[];
  /** For the Prompt Lab on exercise/task/stretch slides. */
  itemId: string;
  sessionId: string | null;
  readOnly?: boolean;
}

function Lab(p: SlideProps) {
  return (
    <PromptLab
      itemId={p.itemId}
      slide={p.slide}
      fields={p.fields}
      save={p.save}
      emit={p.emit}
      sessionId={p.sessionId}
      readOnly={p.readOnly}
    />
  );
}

const PHASE: Record<string, string> = {
  objectives: 'Objectives',
  think: 'Activate',
  theory: 'Theory',
  figure: 'Theory',
  example: 'Theory',
  predict: 'Theory',
  mcq: 'Theory',
  misconceptions: 'Theory',
  concept: 'Theory',
  check: 'Theory',
  exercise: 'Apply · core',
  task: 'Apply · core',
  ai: 'Apply · core',
  stretch: 'Stretch · optional',
  selfscore: 'Reflect',
  reflect: 'Reflect',
};

const html = (h: string | undefined) => ({ __html: h ?? '' });
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function SlideLabel({
  slide,
  session,
  index,
  total,
}: Pick<SlideProps, 'slide' | 'session' | 'index' | 'total'>) {
  const label = session.appendix ? 'Appendix' : `Session ${session.id}`;
  return (
    <div className="slide-label">
      <b>{label}</b>
      {slide.t !== 'title' && (
        <span className={slide.lab ? 'lab-tag' : ''}>
          {slide.lab ? 'Lab · take-home' : PHASE[slide.t]}
        </span>
      )}
      <span className="num">
        {index + 1} / {total}
      </span>
    </div>
  );
}

/** Fires `attempt_started` once, on the learner's first keystroke in a field. */
function useFirstInput(emit: LessonEmit, fieldKey: string) {
  const [started, setStarted] = useState(false);
  return () => {
    if (started) return;
    setStarted(true);
    emit('attempt_started', { fieldKey });
  };
}

/**
 * Optional 1–5 confidence rating (Phase 2.2 #3; workbook CONFIDENCE_RATED,
 * enables calibration M23). One tap, can be changed, never required.
 */
function ConfidenceRating({
  value,
  timing,
  onRate,
}: {
  value: number | undefined;
  timing: 'before' | 'after';
  onRate: (v: number) => void;
}) {
  return (
    <div className="confidence" role="group" aria-label="Confidence rating">
      <span>
        {timing === 'before'
          ? 'How confident are you in your reasoning? (optional)'
          : 'How confident were you in your prediction? (optional)'}
      </span>
      {[1, 2, 3, 4, 5].map((v) => (
        <button
          key={v}
          type="button"
          className={value === v ? 'sel' : ''}
          aria-pressed={value === v}
          onClick={() => onRate(v)}
        >
          {v}
        </button>
      ))}
      <span className="scale">1 = guessing · 5 = certain</span>
    </div>
  );
}

// ── text-gated boxes: think / predict / reflect ──────────────────────────

function TextGate({
  kind,
  fields,
  save,
  emit,
  onSaved,
}: {
  kind: 'think' | 'predict' | 'reflect';
  fields: SlideFields;
  save: SlideProps['save'];
  emit: LessonEmit;
  onSaved?: () => void;
}) {
  const savedText = str(fields.text);
  const [value, setValue] = useState(savedText);
  const [status, setStatus] = useState<{ text: string; ok: boolean }>(
    savedText ? { text: 'Saved', ok: true } : { text: '', ok: false },
  );
  const firstInput = useFirstInput(emit, kind);
  const placeholder =
    kind === 'think'
      ? 'Write your prediction before reading on…'
      : kind === 'predict'
        ? 'Commit to a prediction, then reveal…'
        : 'Write your reflection…';
  const label =
    kind === 'think'
      ? 'Save prediction and continue'
      : kind === 'predict'
        ? 'Save and reveal'
        : 'Save reflection';
  const onClick = () => {
    if (value.trim().length < LESSON_GATES[kind]) {
      setStatus({ text: 'Write at least a sentence first.', ok: false });
      return;
    }
    save({ text: value });
    emit(`${kind}_submitted`, { chars: value.length, text: value, fieldKey: kind });
    setStatus({ text: 'Saved', ok: true });
    onSaved?.();
  };
  return (
    <div data-replay-redact="">
      <textarea
        data-field-key={kind}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          firstInput();
          setValue(e.target.value);
        }}
      />
      <div className="actions">
        <button type="button" className="btn" onClick={onClick}>
          {label}
        </button>
        <span className={`status${status.ok ? ' ok' : ''}`}>{status.text}</span>
      </div>
    </div>
  );
}

function ThinkSlide(p: SlideProps) {
  return (
    <div className="box think">
      <div className="box-title">{p.slide.box}</div>
      <div dangerouslySetInnerHTML={html(p.slide.prompt)} />
      <TextGate kind="think" fields={p.fields} save={p.save} emit={p.emit} onSaved={p.onAdvance} />
      <div className="locked-note">
        The theory that follows is more useful once you have committed to a prediction.
      </div>
    </div>
  );
}

/**
 * Reflection, split into the two parts every session's prompt has: the
 * session-specific appraisal, then the fixed implementation intention
 * ("In my next real task, I will …"). The split feeds rule M22; the
 * course's gate (≥ 20 characters in total) is unchanged.
 */
function ReflectSlide(p: SlideProps) {
  const parts = (p.fields.parts ?? {}) as { appraisal?: string; implementationIntention?: string };
  const [appraisal, setAppraisal] = useState(parts.appraisal ?? str(p.fields.text));
  const [intention, setIntention] = useState(parts.implementationIntention ?? '');
  const saved = Boolean(p.fields.text);
  const [status, setStatus] = useState<{ text: string; ok: boolean }>(
    saved ? { text: 'Saved', ok: true } : { text: '', ok: false },
  );
  const firstInput = useFirstInput(p.emit, 'reflect');
  const onClick = () => {
    const text = [appraisal, intention].filter((x) => x.trim()).join('\n\n');
    if (text.trim().length < LESSON_GATES.reflect) {
      setStatus({ text: 'Write at least a sentence first.', ok: false });
      return;
    }
    const nextParts = { appraisal, implementationIntention: intention };
    p.save({ text, parts: nextParts });
    p.emit('reflect_submitted', {
      chars: text.length,
      text,
      parts: nextParts,
      fieldKey: 'reflect',
    });
    setStatus({ text: 'Saved', ok: true });
  };
  return (
    <div className="box task">
      <div className="box-title">{p.slide.box}</div>
      <div dangerouslySetInnerHTML={html(p.slide.prompt)} />
      <div data-replay-redact="">
        <label className="part-label">Your reflection</label>
        <textarea
          data-field-key="reflect"
          placeholder="Write your reflection…"
          value={appraisal}
          onChange={(e) => {
            firstInput();
            setAppraisal(e.target.value);
          }}
        />
        <label className="part-label">
          In my next real task, I will [specific behaviour] when [trigger], and I will judge it by
          [observable measure].
        </label>
        <textarea
          className="mini"
          data-field-key="reflect-intention"
          placeholder="In my next real task, I will…"
          value={intention}
          onChange={(e) => {
            firstInput();
            setIntention(e.target.value);
          }}
        />
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={onClick}>
          Save reflection
        </button>
        <span className={`status${status.ok ? ' ok' : ''}`}>{status.text}</span>
      </div>
    </div>
  );
}

function PredictSlide(p: SlideProps) {
  const [open, setOpen] = useState(Boolean(p.fields.text));
  return (
    <div className="box predict">
      <div className="box-title">{p.slide.box}</div>
      <div dangerouslySetInnerHTML={html(p.slide.prompt)} />
      <TextGate
        kind="predict"
        fields={p.fields}
        save={p.save}
        emit={p.emit}
        onSaved={() => {
          setOpen(true);
          p.emit('predict_revealed', { auto: true });
        }}
      />
      <div
        className={`reveal${open ? ' open' : ''}`}
        dangerouslySetInnerHTML={html(p.slide.reveal)}
      />
      {open && (
        <ConfidenceRating
          value={p.fields.confidenceAfter as number | undefined}
          timing="after"
          onRate={(v) => {
            p.save({ confidenceAfter: v });
            p.emit('confidence_rated', { value: v, timing: 'after' });
          }}
        />
      )}
    </div>
  );
}

// ── Pause and check ──────────────────────────────────────────────────────

function CheckItem({ k, item, p }: { k: number; item: { q: string; a: string }; p: SlideProps }) {
  const qk = `q${k + 1}`;
  const saved = str(p.fields[qk]);
  const [value, setValue] = useState(saved);
  const [isSaved, setIsSaved] = useState(Boolean(saved));
  const [status, setStatus] = useState(saved ? 'Saved' : '');
  const [open, setOpen] = useState(false);
  const [miss, setMiss] = useState(str(p.fields[`${qk}-miss`]));
  const firstInput = useFirstInput(p.emit, qk);
  return (
    <div className={`qa${open ? ' open' : ''}`} data-replay-redact="">
      <div className="q">
        {k + 1}. <span dangerouslySetInnerHTML={html(item.q)} />
      </div>
      <textarea
        className="mini"
        data-field-key={qk}
        placeholder="Your answer…"
        value={value}
        onChange={(e) => {
          firstInput();
          setValue(e.target.value);
        }}
      />
      <div className="actions">
        <button
          type="button"
          className="btn secondary save"
          onClick={() => {
            if (value.trim().length < LESSON_GATES.checkAnswer) {
              setStatus('Write at least a sentence first.');
              return;
            }
            p.save({ [qk]: value });
            p.emit('check_answered', {
              question: k + 1,
              chars: value.length,
              text: value,
              fieldKey: qk,
            });
            setIsSaved(true);
            setStatus('Saved');
          }}
        >
          Save answer
        </button>
        <button
          type="button"
          className="show"
          disabled={!isSaved}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) p.emit('check_revealed', { question: k + 1 });
          }}
        >
          {open ? 'Hide answer' : 'Show answer'}
        </button>
        <span className="status">{status}</span>
      </div>
      <div className="a">
        <span dangerouslySetInnerHTML={html(item.a)} />
        <div className="after">
          <label>What I missed or would change:</label>
          <textarea
            className="mini short"
            data-field-key={`${qk}-miss`}
            placeholder="One sentence…"
            value={miss}
            onChange={(e) => setMiss(e.target.value)}
          />
          <button
            type="button"
            className="btn secondary savemiss"
            onClick={() => {
              p.save({ [`${qk}-miss`]: miss });
              p.emit('check_missed_noted', {
                question: k + 1,
                chars: miss.length,
                text: miss,
                fieldKey: `${qk}-miss`,
              });
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckSlide(p: SlideProps) {
  const items = (p.slide.items ?? []) as Array<{ q: string; a: string }>;
  return (
    <>
      <h2>Pause and check</h2>
      <p>Write 1–3 sentences for each question; the answer unlocks once your response is saved.</p>
      <div className="box check">
        {items.map((it, k) => (
          <CheckItem key={k} k={k} item={it} p={p} />
        ))}
      </div>
    </>
  );
}

// ── MCQ ──────────────────────────────────────────────────────────────────

function McqSlide(p: SlideProps) {
  const options = (p.slide.options ?? []) as LessonMcqOption[];
  const order = useMemo(() => mcqOrder(p.slide.key, options.length), [p.slide.key, options.length]);
  const savedWhy = str(p.fields.why);
  const answered = p.fields.mcq as { option: number; correct: boolean } | undefined;
  const [why, setWhy] = useState(savedWhy);
  const [unlocked, setUnlocked] = useState(Boolean(savedWhy));
  const [status, setStatus] = useState('');
  const [choice, setChoice] = useState<number | null>(answered ? answered.option - 1 : null);
  const firstInput = useFirstInput(p.emit, 'why');
  const chosen = choice != null ? options[choice] : undefined;
  return (
    <>
      <h2>Check your reasoning</h2>
      <div className="mcq">
        <p dangerouslySetInnerHTML={html(p.slide.q)} />
        <div data-replay-redact="">
          <textarea
            className="mini"
            data-field-key="why"
            placeholder="Before choosing: in one sentence, what principle decides this?"
            value={why}
            onChange={(e) => {
              firstInput();
              setWhy(e.target.value);
            }}
          />
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              if (why.trim().length < LESSON_GATES.mcqRationale) {
                setStatus('Write one sentence first.');
                return;
              }
              p.save({ why });
              p.emit('mcq_rationale', { chars: why.length, text: why, fieldKey: 'why' });
              setUnlocked(true);
              setStatus('Options unlocked');
            }}
          >
            Save reasoning and unlock options
          </button>
          <span className="status">{status}</span>
        </div>
        {unlocked && (choice == null || p.fields.confidence != null) && (
          <ConfidenceRating
            value={p.fields.confidence as number | undefined}
            timing="before"
            onRate={(v) => {
              if (choice != null) return; // "before answering" only
              p.save({ confidence: v });
              p.emit('confidence_rated', { value: v, timing: 'before' });
            }}
          />
        )}
        {order.map((k) => {
          const o = options[k]!;
          let cls = 'opt';
          if (choice != null && (k === choice || (!chosen?.ok && o.ok)))
            cls += o.ok ? ' right' : ' wrong';
          return (
            <button
              key={k}
              type="button"
              className={cls}
              disabled={!unlocked || choice != null}
              onClick={() => {
                if (choice != null) return;
                setChoice(k);
                p.save({ mcq: { option: k + 1, correct: o.ok } });
                p.emit('mcq_answered', {
                  option: k + 1,
                  correct: o.ok,
                  attemptNo: 1,
                  misconceptionId: o.misconceptionId ?? null,
                  misconceptionTagStatus: o.misconceptionTagStatus ?? null,
                  confidence: typeof p.fields.confidence === 'number' ? p.fields.confidence : null,
                });
              }}
              dangerouslySetInnerHTML={html(o.t)}
            />
          );
        })}
        <div className={`fb${chosen ? ' show' : ''}`}>
          {chosen && (
            <>
              <strong>{chosen.ok ? 'Correct.' : 'Not quite.'}</strong>{' '}
              <span dangerouslySetInnerHTML={html(chosen.fb)} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ── Misconceptions ───────────────────────────────────────────────────────

interface MiscState {
  choice?: 'agree' | 'disagree';
  because?: string;
  changed?: 'yes' | 'no';
  revealed?: boolean;
}

function MiscItem({
  k,
  item,
  p,
}: {
  k: number;
  item: { claim: string; truth: string };
  p: SlideProps;
}) {
  const ik = `m${k + 1}`;
  const saved = (p.fields[ik] ?? {}) as MiscState;
  const [choice, setChoice] = useState<MiscState['choice']>(saved.choice);
  const [because, setBecause] = useState(saved.because ?? '');
  const [open, setOpen] = useState(Boolean(saved.choice && saved.revealed));
  const [changed, setChanged] = useState<MiscState['changed']>(saved.changed);
  const firstInput = useFirstInput(p.emit, ik);
  const canReveal = Boolean(choice) && because.trim().length >= LESSON_GATES.misconceptionReason;
  return (
    <div className={`item${open ? ' open' : ''}`}>
      <div className="claim" dangerouslySetInnerHTML={html(item.claim)} />
      <div className="commit" data-replay-redact="">
        {(['agree', 'disagree'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={choice === v ? 'sel' : ''}
            onClick={() => setChoice(v)}
          >
            {v === 'agree' ? 'Agree' : 'Disagree'}
          </button>
        ))}
        <input
          type="text"
          data-field-key={ik}
          placeholder="because…"
          value={because}
          onChange={(e) => {
            firstInput();
            setBecause(e.target.value);
          }}
        />
        <button
          type="button"
          className="btn secondary reveal-btn"
          disabled={!canReveal}
          onClick={() => {
            // Course parity: commit and reveal happen in one click.
            p.save({ [ik]: { choice, because, revealed: true } });
            p.emit('misconception_committed', {
              item: k + 1,
              choice,
              chars: because.length,
              text: because,
              fieldKey: ik,
            });
            setOpen(true);
            p.emit('misconception_opened', { item: k + 1, auto: true });
          }}
        >
          Reveal
        </button>
      </div>
      <div className="truth">
        <span dangerouslySetInnerHTML={html(item.truth)} />
        <div className="after">
          <label>Did your reason change?</label>
          {(['yes', 'no'] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={changed === c ? 'sel' : ''}
              onClick={() => {
                setChanged(c);
                p.save({ [ik]: { choice, because, changed: c, revealed: true } });
                p.emit('misconception_changed', { item: k + 1, changed: c });
              }}
            >
              {c === 'yes' ? 'Yes' : 'No'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MisconceptionsSlide(p: SlideProps) {
  const items = (p.slide.items ?? []) as Array<{ claim: string; truth: string }>;
  return (
    <>
      <h2>Common misconceptions</h2>
      <div className="misc">
        <p className="hint">
          For each claim: choose Agree or Disagree and give a reason. The explanation unlocks once
          both are saved.
        </p>
        {items.map((it, k) => (
          <MiscItem key={k} k={k} item={it} p={p} />
        ))}
      </div>
    </>
  );
}

// ── Exercise (results box + analysis template) ───────────────────────────

/**
 * Task and stretch slides: in the HTML these only described work done in
 * an external AI tool and captured nothing. Here they get the Prompt Lab
 * plus a short "what I learned" box (RESULTS_RECORDED), as in plan §3.2 #6.
 */
function LabTaskSlide(p: SlideProps) {
  const saved = str(p.fields.text);
  const [value, setValue] = useState(saved);
  const [status, setStatus] = useState(saved ? 'Saved' : '');
  const firstInput = useFirstInput(p.emit, 'results');
  return (
    <div className={`box ${p.slide.t}`}>
      <div className="box-title">{p.slide.box}</div>
      <div dangerouslySetInnerHTML={html(p.slide.html)} />
      <Lab {...p} />
      <div className="res-label">What I learned (results, numbers, what failed and why).</div>
      <div data-replay-redact="">
        <textarea
          className="mini"
          data-field-key="results"
          placeholder="What I learned…"
          value={value}
          onChange={(e) => {
            firstInput();
            setValue(e.target.value);
          }}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (value.trim().length < LESSON_GATES.results) {
              setStatus('Record your results first (a few lines).');
              return;
            }
            p.save({ text: value });
            p.emit('results_submitted', { chars: value.length, text: value, fieldKey: 'results' });
            setStatus('Saved');
          }}
        >
          Save
        </button>
        <span className="status">{status}</span>
      </div>
    </div>
  );
}

function ExerciseSlide(p: SlideProps) {
  const saved = str(p.fields.text);
  const [value, setValue] = useState(saved);
  const [isSaved, setIsSaved] = useState(Boolean(saved));
  const [status, setStatus] = useState(saved ? 'Saved' : '');
  const [open, setOpen] = useState(false);
  const firstInput = useFirstInput(p.emit, 'results');
  return (
    <div className="box ai">
      <div className="box-title">{p.slide.box}</div>
      <div dangerouslySetInnerHTML={html(p.slide.html)} />
      <Lab {...p} />
      <div className="res-label">
        Record your results here (numbers, run counts, model/version) before opening the analysis
        template.
      </div>
      <div data-replay-redact="">
        <textarea
          data-field-key="results"
          placeholder="Results…"
          value={value}
          onChange={(e) => {
            firstInput();
            setValue(e.target.value);
          }}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (value.trim().length < LESSON_GATES.results) {
              setStatus('Record your results first (a few lines).');
              return;
            }
            p.save({ text: value });
            p.emit('results_submitted', { chars: value.length, text: value, fieldKey: 'results' });
            setStatus('Saved');
            setIsSaved(true);
          }}
        >
          Save results
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={!isSaved}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) p.emit('expect_revealed');
          }}
        >
          {open ? 'Hide analysis template' : 'Open analysis template'}
        </button>
        <span className="status">{status}</span>
      </div>
      <div
        className={`reveal${open ? ' open' : ''}`}
        dangerouslySetInnerHTML={html(p.slide.expect)}
      />
    </div>
  );
}

// ── Self-score ───────────────────────────────────────────────────────────

function SelfScoreSlide(p: SlideProps) {
  const criteria = p.slide.criteria ?? [];
  const scores = (p.fields.scores ?? {}) as Record<string, number>;
  const total = criteria.reduce(
    (sum, _c, k) => sum + (scores[k] != null ? Number(scores[k]) : 0),
    0,
  );
  return (
    <>
      <h2>Score yourself</h2>
      <p>
        0 = not done · 1 = partly · 2 = fully. Be honest; this is for you and for the study, not a
        grade.
      </p>
      <div className="box task score">
        <table>
          <tbody>
            {criteria.map((c, k) => (
              <tr key={k}>
                <td dangerouslySetInnerHTML={html(c)} />
                <td>
                  {[0, 1, 2].map((v) => (
                    <label key={v}>
                      <input
                        type="radio"
                        name={`${p.slide.key}-${k}`}
                        value={v}
                        checked={scores[k] === v}
                        onChange={() => {
                          p.save({ scores: { ...scores, [k]: v } });
                          p.emit('selfscore_set', { criterion: k + 1, value: v });
                        }}
                      />{' '}
                      {v}
                    </label>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="total">
          Total: {total} / {criteria.length * 2}
        </div>
      </div>
    </>
  );
}

// ── Static slides ────────────────────────────────────────────────────────

function TitleSlide({ session }: SlideProps) {
  return (
    <>
      <h2>{session.title}</h2>
      <div className="covers">Covers {session.covers}</div>
      <p className="big-q" dangerouslySetInnerHTML={html(session.bigq)} />
      {!session.appendix && (
        <>
          <div className="rhythm">
            <div>
              <b>Activate</b>
              <i>5 min · commit to a prediction</i>
            </div>
            <div>
              <b>Theory</b>
              <i>25 min · read, predict, check</i>
            </div>
            <div>
              <b>Apply</b>
              <i>20–25 min · core experiments (labs are take-home)</i>
            </div>
            <div>
              <b>Reflect</b>
              <i>5 min · score and transfer</i>
            </div>
          </div>
          <div className="core">
            <b>60-minute core path</b>
            <ol>
              {session.core.map((x, i) => (
                <li key={i} dangerouslySetInnerHTML={html(x)} />
              ))}
            </ol>
            <span>Everything labelled Lab or Stretch is take-home.</span>
          </div>
        </>
      )}
    </>
  );
}

function FigureSlide({ slide }: SlideProps) {
  return (
    <figure className="fig">
      <div
        className="fig-svg"
        role="img"
        aria-label={(slide.caption ?? '').replace(/<[^>]+>/g, '')}
        dangerouslySetInnerHTML={html(slide.svg)}
      />
      <figcaption dangerouslySetInnerHTML={html(slide.caption)} />
      {slide.alt && (
        <details className="fig-alt">
          <summary>Text description of this figure</summary>
          <p dangerouslySetInnerHTML={html(slide.alt)} />
        </details>
      )}
      {slide.notice && (
        <div className="fig-notice">
          <b>What to notice</b>
          <ul>
            {slide.notice.map((x, i) => (
              <li key={i} dangerouslySetInnerHTML={html(x)} />
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}

function SlideBody(p: SlideProps) {
  const { slide } = p;
  switch (slide.t) {
    case 'title':
      return <TitleSlide {...p} />;
    case 'objectives':
      return (
        <>
          <h2>Learning objectives</h2>
          <p>By the end of this session you will be able to:</p>
          <ul>
            {((slide.items ?? []) as string[]).map((x, i) => (
              <li key={i} dangerouslySetInnerHTML={html(x)} />
            ))}
          </ul>
          {/* Phase 2.2 #5: the session's self-score criteria shown up front,
              so REQUIREMENTS_VIEWED is observable (dwell on this slide). */}
          {p.sessionCriteria && p.sessionCriteria.length > 0 && (
            <div className="box concept success-criteria">
              <div className="box-title">What counts as success in this session</div>
              <p>
                You will score yourself on these at the end (0 = not done · 1 = partly · 2 = fully):
              </p>
              <ul>
                {p.sessionCriteria.map((c, i) => (
                  <li key={i} dangerouslySetInnerHTML={html(c)} />
                ))}
              </ul>
            </div>
          )}
        </>
      );
    case 'theory':
      return (
        <>
          <h2 dangerouslySetInnerHTML={html(slide.heading)} />
          <div dangerouslySetInnerHTML={html(slide.html)} />
        </>
      );
    case 'figure':
      return <FigureSlide {...p} />;
    case 'example':
    case 'ai':
      return (
        <div className={`box ${slide.t}`}>
          <div className="box-title">{slide.box}</div>
          <div dangerouslySetInnerHTML={html(slide.html)} />
        </div>
      );
    case 'task':
    case 'stretch':
      return <LabTaskSlide {...p} />;
    case 'concept':
      return (
        <>
          <h2>Key idea</h2>
          <div className="box concept">
            <p dangerouslySetInnerHTML={html(slide.html)} />
          </div>
        </>
      );
    case 'check':
      return <CheckSlide {...p} />;
    case 'think':
      return <ThinkSlide {...p} />;
    case 'reflect':
      return <ReflectSlide {...p} />;
    case 'predict':
      return <PredictSlide {...p} />;
    case 'mcq':
      return <McqSlide {...p} />;
    case 'misconceptions':
      return <MisconceptionsSlide {...p} />;
    case 'exercise':
      return <ExerciseSlide {...p} />;
    case 'selfscore':
      return <SelfScoreSlide {...p} />;
    default:
      return null;
  }
}

export function Slide(p: SlideProps) {
  const cls = `slide${p.slide.t === 'title' ? ' sec-title' : ''}${p.slide.t === 'figure' ? ' fig-slide' : ''}`;
  return (
    <section className={cls} data-slide-key={p.slide.key} data-slide-type={p.slide.t}>
      <div className="slide-inner">
        <SlideLabel slide={p.slide} session={p.session} index={p.index} total={p.total} />
        <SlideBody {...p} />
      </div>
    </section>
  );
}

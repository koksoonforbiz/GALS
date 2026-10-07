/**
 * Mapping rules M01–M35 + M03b (Process Mining Library v2, Mapping sheet),
 * as small pure functions over one session's ordered raw actions.
 *
 * Every output is a *candidate* learning event (workbook evidence class:
 * none is validated in GALS yet). Rules whose inputs this course never
 * emits are registered with `notApplicable` so the coverage report shows
 * them as "no input" instead of silently dropping them (plan Phase 4 #6).
 *
 * Course-specific readings (docs/process-mining/PHASE0_DISCOVERY.md):
 * - Reveals are gated behind the learner's own attempt → M15, never M10.
 * - predict / misconception reveals are automatic (`auto: true`).
 * - Every misconception claim is false, so "agree" is the wrong commit (M16).
 */
import { type Draft, type EngineInput, type RawAction, type RuleDef, tOutMs } from './types';

// ── helpers ───────────────────────────────────────────────────────────────

const slideOf = (a: RawAction) => (typeof a.meta.slideKey === 'string' ? a.meta.slideKey : null);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? NaN));
const itemOf = (a: RawAction) => (a.meta.item == null ? '' : String(a.meta.item));
const is = (a: RawAction, ...actions: string[]) => actions.includes(a.action);

function draft(ruleId: string, sources: RawAction[], extra: Partial<Draft> = {}): Draft {
  const first = sources[0]!;
  const last = sources[sources.length - 1]!;
  return {
    ruleId,
    start: Math.min(...sources.map((s) => s.at)),
    end: Math.max(...sources.map((s) => s.at)),
    sources,
    moduleItemId: first.moduleItemId ?? last.moduleItemId,
    slideKey: slideOf(first) ?? slideOf(last),
    ...extra,
  };
}

/** A SLIDE_EXITED event as a reading interval [at − dwell, at]. */
function exitDraft(
  ruleId: string,
  exit: RawAction,
  outcome: string,
  extra: Record<string, unknown> = {},
): Draft {
  const dwell = num(exit.meta.dwellMs) || 0;
  return {
    ...draft(ruleId, [exit], { outcome }),
    start: exit.at - dwell,
    end: exit.at,
    detail: { dwellMs: dwell, slideType: exit.meta.slideType, ...extra },
  };
}

/** Minimum characters the course gate demands for each commit action (course_slides.html). */
const GATE_MIN: Record<string, number> = {
  PREDICTION_COMMITTED: 20,
  SELF_CHECK_SUBMITTED: 10,
  RATIONALE_SUBMITTED: 15,
  RESULTS_RECORDED: 20,
  BELIEF_COMMITTED: 8,
  REFLECTION_SUBMITTED: 20,
};

const COMMIT_ACTIONS = Object.keys(GATE_MIN);
const CONTENT_TYPES = new Set(['theory', 'figure', 'example', 'concept', 'title']);

/** The reveal kind that follows each commit action, for M15/M24 pairing. */
function revealKindFor(commit: RawAction): string | null {
  if (commit.action === 'PREDICTION_COMMITTED' && commit.meta.kind === 'predict') return 'predict';
  if (commit.action === 'SELF_CHECK_SUBMITTED') return 'check';
  if (commit.action === 'RESULTS_RECORDED' && commit.meta.slideType === 'exercise') return 'expect';
  if (commit.action === 'BELIEF_COMMITTED') return 'misconception';
  return null;
}

/**
 * Time-based neighbours: the nearest action after/before `from` within the
 * window, *including* equal timestamps (excluding `from` itself). Commit
 * and automatic reveal share a millisecond; rows logged before `seq`
 * existed can be stored in either order, so index order is not trusted.
 */
function findAfter(
  actions: RawAction[],
  from: RawAction,
  window: number,
  pred: (a: RawAction) => boolean,
): RawAction | undefined {
  return actions.find((a) => a !== from && a.at >= from.at && a.at - from.at <= window && pred(a));
}

function findBefore(
  actions: RawAction[],
  from: RawAction,
  window: number,
  pred: (a: RawAction) => boolean,
): RawAction | undefined {
  let best: RawAction | undefined;
  for (const a of actions) {
    if (a === from || a.at > from.at || from.at - a.at > window || !pred(a)) continue;
    best = a; // actions are ordered, so the last match is the nearest
  }
  return best;
}

const sameSlide = (a: RawAction, b: RawAction) =>
  a.moduleItemId === b.moduleItemId && slideOf(a) === slideOf(b);
const sameSlideItem = (a: RawAction, b: RawAction) => sameSlide(a, b) && itemOf(a) === itemOf(b);

/** True when a commit is a low-effort candidate (M24 thresholds). */
function isLowEffort(c: RawAction, p: EngineInput['params']): boolean {
  const min = GATE_MIN[c.action];
  if (min == null) return false;
  const chars = num(c.meta.chars);
  const ms = num(c.meta.msOnSlide);
  return (
    Number.isFinite(chars) && Number.isFinite(ms) && chars <= min + p.eps_chars && ms < p.T_rapid
  );
}

/** Visit numbers recomputed server-side: prior sessions + order within this one. */
function visitNumbers(input: EngineInput): Map<RawAction, number> {
  const counts = new Map(input.prior.visits);
  const out = new Map<RawAction, number>();
  for (const a of input.actions) {
    if (a.action !== 'SLIDE_ENTERED') continue;
    const key = `${a.moduleItemId}|${slideOf(a)}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    out.set(a, n);
  }
  return out;
}

/** Commits that re-save an already-committed slide/item: the course's ANSWER_REVISED. */
function revisions(input: EngineInput): RawAction[] {
  const seen = new Set(input.prior.commits);
  const out: RawAction[] = [];
  for (const a of input.actions) {
    if (!COMMIT_ACTIONS.includes(a.action)) continue;
    const key = `${a.moduleItemId}|${slideOf(a)}|${itemOf(a)}`;
    if (seen.has(key)) out.push(a);
    seen.add(key);
  }
  return out;
}

// ── rules ─────────────────────────────────────────────────────────────────

const M01: RuleDef = {
  id: 'M01',
  inputs: ['SLIDE_EXITED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    const firstAttempt = new Map<string, number>();
    for (const a of actions) {
      if (a.action === 'ATTEMPT_STARTED' && a.moduleItemId && !firstAttempt.has(a.moduleItemId)) {
        firstAttempt.set(a.moduleItemId, a.at);
      }
    }
    for (const a of actions) {
      if (a.action !== 'SLIDE_EXITED') continue;
      const type = a.meta.slideType;
      if (type !== 'objectives' && type !== 'selfscore') continue;
      if (num(a.meta.dwellMs) < params.T_orient) continue;
      const attempt = a.moduleItemId ? firstAttempt.get(a.moduleItemId) : undefined;
      if (attempt != null && attempt < a.at) continue; // after an attempt → M14, not orientation
      out.push(
        exitDraft(
          'M01',
          a,
          type === 'objectives' ? 'objectives_and_criteria' : 'rubric_before_attempt',
        ),
      );
    }
    return out;
  },
};

const M02: RuleDef = {
  id: 'M02',
  inputs: ['PROMPT_GOAL_DECLARED'],
  run: ({ actions }) =>
    actions
      .filter((a) => a.action === 'PROMPT_GOAL_DECLARED')
      .map((a) => draft('M02', [a], { outcome: 'goal_declared' })),
};

/** M03 first reading, M03b re-reading, M21 knowledge-based regulation. */
function readingRules(input: EngineInput): Draft[] {
  const { actions, params } = input;
  const visits = visitNumbers(input);
  const revs = revisions(input);
  const out: Draft[] = [];
  for (const exit of actions) {
    if (exit.action !== 'SLIDE_EXITED' || !CONTENT_TYPES.has(String(exit.meta.slideType))) continue;
    if (num(exit.meta.dwellMs) < params.T_read) continue;
    const enter = findBefore(
      actions,
      exit,
      Number.POSITIVE_INFINITY,
      (a) => a.action === 'SLIDE_ENTERED' && sameSlide(a, exit),
    );
    const visitNo = enter ? (visits.get(enter) ?? 1) : 1;
    if (visitNo <= 1) {
      out.push(exitDraft('M03', exit, 'first_reading', { visitNo }));
      continue;
    }
    const revision = revs.find(
      (r) =>
        r.moduleItemId === exit.moduleItemId && r.at > exit.at && r.at - exit.at <= params.W_seq,
    );
    if (revision) {
      out.push({
        ...draft('M21', [exit, revision], { outcome: 'revisit_then_revision' }),
        start: exit.at - num(exit.meta.dwellMs),
        detail: { visitNo, revisedSlide: slideOf(revision), revisedAction: revision.action },
      });
    } else {
      out.push(exitDraft('M03b', exit, 're_reading', { visitNo }));
    }
  }
  return out;
}

const M03: RuleDef = {
  id: 'M03',
  inputs: ['SLIDE_EXITED'],
  run: (i) => readingRules(i).filter((d) => d.ruleId === 'M03'),
};
const M03b: RuleDef = {
  id: 'M03b',
  inputs: ['SLIDE_ENTERED'],
  run: (i) => readingRules(i).filter((d) => d.ruleId === 'M03b'),
};
const M21: RuleDef = {
  id: 'M21',
  inputs: ['SLIDE_ENTERED'],
  run: (i) => readingRules(i).filter((d) => d.ruleId === 'M21'),
};

const M04: RuleDef = {
  id: 'M04',
  inputs: ['RATIONALE_SUBMITTED'],
  run: ({ actions }) =>
    actions
      .filter((a) => a.action === 'RATIONALE_SUBMITTED')
      .map((a) =>
        draft('M04', [a], { outcome: 'self_explanation', detail: { chars: a.meta.chars } }),
      ),
};

const M05: RuleDef = {
  id: 'M05',
  inputs: ['PREDICTION_COMMITTED'],
  run: ({ actions, params }) =>
    actions
      .filter((a) => a.action === 'PREDICTION_COMMITTED' && !isLowEffort(a, params))
      .map((a) =>
        draft('M05', [a], {
          outcome: String(a.meta.kind ?? 'prediction'),
          detail: { chars: a.meta.chars },
        }),
      ),
};

const M06: RuleDef = {
  id: 'M06',
  inputs: ['MCQ_ANSWERED', 'RESULTS_RECORDED'],
  run: ({ actions }) =>
    actions
      .filter((a) => is(a, 'MCQ_ANSWERED', 'RESULTS_RECORDED'))
      .map((a) =>
        draft('M06', [a], { outcome: a.action === 'MCQ_ANSWERED' ? 'answer' : 'results' }),
      ),
};

const M07: RuleDef = {
  id: 'M07',
  inputs: ['MCQ_ANSWERED'],
  run: ({ actions }) =>
    actions
      .filter((a) => a.action === 'MCQ_ANSWERED')
      .map((a) =>
        draft('M07', [a], {
          outcome: a.meta.correct === true ? 'correct' : 'incorrect',
          detail: { option: a.meta.option, misconceptionId: a.meta.misconceptionId ?? null },
        }),
      ),
};

const M08: RuleDef = {
  id: 'M08',
  inputs: ['CHATBOT_MESSAGE_SENT'],
  // The docked chatbot stays beside the lesson (decision #8). The help type
  // comes from the M33 classifier when available, otherwise 'untyped'. The
  // activity row has no message id, so classifications match by time.
  run: ({ actions, classifications = [] }) =>
    actions
      .filter((a) => a.action === 'CHATBOT_MESSAGE_SENT')
      .map((a) => {
        const c = classifications
          .filter(
            (x) =>
              x.sourceType === 'chatbot_message' &&
              Math.abs(x.at - a.at) <= CLASSIFICATION_MATCH_MS,
          )
          .sort((x, y) => Math.abs(x.at - a.at) - Math.abs(y.at - a.at))[0];
        return draft('M08', [a], {
          outcome: c?.label ?? 'untyped',
          detail: { hasSelection: a.meta.hasSelection ?? null, classified: Boolean(c) },
        });
      }),
};

const CLASSIFICATION_MATCH_MS = 10_000;

const M33: RuleDef = {
  id: 'M33',
  inputs: ['PROMPT_SUBMITTED', 'CHATBOT_MESSAGE_SENT'],
  // One event per classified prompt in the session. Stays a candidate until
  // human–LLM κ passes and a researcher marks M33 validated.
  run: ({ classifications = [] }) =>
    classifications.map((c) => ({
      ruleId: 'M33',
      outcome: c.label,
      start: c.at,
      end: c.at,
      sources: [],
      detail: { sourceType: c.sourceType, sourceId: c.sourceId },
    })),
};

const M13: RuleDef = {
  id: 'M13',
  inputs: ['CONFIDENCE_RATED'],
  run: ({ actions }) =>
    actions
      .filter((a) => a.action === 'CONFIDENCE_RATED')
      .map((a) =>
        draft('M13', [a], {
          outcome: 'judgement_of_confidence',
          detail: { value: a.meta.value, timing: a.meta.timing },
        }),
      ),
};

const M14: RuleDef = {
  id: 'M14',
  inputs: ['CRITERION_SELF_SCORED', 'SELF_CHECK_SUBMITTED', 'SLIDE_EXITED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    const attempted = new Set<string>();
    for (const a of actions) {
      if (a.action === 'ATTEMPT_STARTED' && a.moduleItemId) attempted.add(a.moduleItemId);
      if (a.action === 'CRITERION_SELF_SCORED')
        out.push(
          draft('M14', [a], {
            outcome: 'self_scored',
            detail: { criterion: a.meta.criterion, value: a.meta.value },
          }),
        );
      if (a.action === 'SELF_CHECK_SUBMITTED')
        out.push(draft('M14', [a], { outcome: 'self_check' }));
      if (
        a.action === 'SLIDE_EXITED' &&
        a.meta.slideType === 'selfscore' &&
        a.moduleItemId &&
        attempted.has(a.moduleItemId) &&
        num(a.meta.dwellMs) >= params.T_orient
      ) {
        out.push(exitDraft('M14', a, 'rubric_after_attempt'));
      }
    }
    return out;
  },
};

const M15: RuleDef = {
  id: 'M15',
  inputs: ['REFERENCE_REVEALED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    const done = new Set<string>();
    for (const rev of actions) {
      if (rev.action !== 'REFERENCE_REVEALED') continue;
      const kind = String(rev.meta.revealKind);
      if (kind === 'misconception') continue; // M16
      const key = `${rev.moduleItemId}|${slideOf(rev)}|${itemOf(rev)}`;
      if (done.has(key)) continue;
      const commit = findBefore(
        actions,
        rev,
        params.W_seq,
        (a) => revealKindFor(a) === kind && sameSlideItem(a, rev),
      );
      if (!commit) continue;
      done.add(key);
      const gap =
        kind === 'check'
          ? findAfter(
              actions,
              rev,
              params.W_seq,
              (a) => a.action === 'GAP_NOTED' && sameSlideItem(a, rev) && num(a.meta.chars) > 0,
            )
          : undefined;
      out.push(
        draft('M15', gap ? [commit, rev, gap] : [commit, rev], {
          outcome: gap ? 'self_identified_gap' : 'reference_exposure',
          detail: {
            revealKind: kind,
            auto: rev.meta.auto === true,
            gapPromptAvailable: kind === 'check',
            msSinceCommit: rev.meta.msSinceCommit ?? rev.at - commit.at,
          },
        }),
      );
    }
    return out;
  },
};

const M16: RuleDef = {
  id: 'M16',
  inputs: ['BELIEF_COMMITTED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    for (const c of actions) {
      if (c.action !== 'BELIEF_COMMITTED') continue;
      const rev = findAfter(
        actions,
        c,
        params.W_seq,
        (a) =>
          a.action === 'REFERENCE_REVEALED' &&
          a.meta.revealKind === 'misconception' &&
          sameSlideItem(a, c),
      );
      if (!rev) continue;
      // last stated answer to "Did your reason change?" within the window
      let revised: RawAction | undefined;
      for (const a of actions) {
        if (a.at < rev.at || a.at - rev.at > params.W_seq) continue;
        if (a.action === 'BELIEF_REVISED' && sameSlideItem(a, c)) revised = a;
      }
      const wrongCommit = c.meta.choice === 'agree'; // every course claim is a misconception
      const changed = revised?.meta.changed;
      const outcome = !revised
        ? 'no_revision_reported'
        : changed === 'yes'
          ? wrongCommit
            ? 'regulation'
            : 'reason_refined'
          : wrongCommit
            ? 'persistent_misconception'
            : 'confirmation';
      out.push(
        draft('M16', revised ? [c, rev, revised] : [c, rev], {
          outcome,
          detail: { choice: c.meta.choice, changed: changed ?? null },
        }),
      );
    }
    return out;
  },
};

/** Off-task intervals from idle events and visibility logs (M25), interruptions (M20). */
function offTaskIntervals(
  input: EngineInput,
): Array<{ start: number; end: number | null; source: string; actions: RawAction[] }> {
  const out: Array<{ start: number; end: number | null; source: string; actions: RawAction[] }> =
    [];
  let idle: RawAction | null = null;
  for (const a of input.actions) {
    if (a.action === 'IDLE_STARTED') idle = a;
    if (a.action === 'IDLE_ENDED' && idle) {
      const idleMs = num(a.meta.idleMs);
      out.push({
        start: Number.isFinite(idleMs) ? a.at - idleMs : idle.at,
        end: a.at,
        source: 'idle',
        actions: [idle, a],
      });
      idle = null;
    }
  }
  if (idle) out.push({ start: idle.at, end: null, source: 'idle', actions: [idle] });
  let hiddenSince: number | null = null;
  let hiddenState = '';
  for (const v of input.visibility) {
    const away = v.state === 'hidden' || v.state === 'blurred';
    if (away && hiddenSince == null) {
      hiddenSince = v.at;
      hiddenState = v.state;
    } else if (!away && hiddenSince != null) {
      out.push({ start: hiddenSince, end: v.at, source: hiddenState, actions: [] });
      hiddenSince = null;
    }
  }
  if (hiddenSince != null)
    out.push({ start: hiddenSince, end: null, source: hiddenState, actions: [] });
  return out.sort((a, b) => a.start - b.start);
}

const M25: RuleDef = {
  id: 'M25',
  inputs: ['IDLE_STARTED', 'SLIDE_ENTERED'],
  run: (input) =>
    offTaskIntervals(input)
      .filter((iv) => iv.end != null && iv.end - iv.start >= input.params.T_idle)
      .map((iv) => ({
        ruleId: 'M25',
        outcome: iv.source,
        start: iv.start,
        end: iv.end!,
        sources: iv.actions,
        detail: { durationMs: iv.end! - iv.start, excludedFromTimeOnTask: true },
      })),
};

const M20: RuleDef = {
  id: 'M20',
  inputs: ['IDLE_STARTED', 'SLIDE_ENTERED'],
  run: (input) => {
    const out: Draft[] = [];
    const lastAction = input.actions[input.actions.length - 1];
    for (const iv of offTaskIntervals(input)) {
      if (iv.end == null) {
        // Nothing after the learner left: abandonment *candidate* (adults get interrupted).
        if (
          !lastAction ||
          lastAction.at <= iv.start + 1000 ||
          lastAction.action === 'IDLE_STARTED'
        ) {
          out.push({
            ruleId: 'M20',
            outcome: 'abandon_candidate',
            start: iv.start,
            end: iv.start,
            sources: iv.actions,
            detail: { source: iv.source },
          });
        }
      } else if (iv.end - iv.start >= input.params.T_idle) {
        out.push({
          ruleId: 'M20',
          outcome: 'interruption_resumed',
          start: iv.start,
          end: iv.end,
          sources: iv.actions,
          detail: { source: iv.source, durationMs: iv.end - iv.start },
        });
      }
    }
    return out;
  },
};

const M22: RuleDef = {
  id: 'M22',
  inputs: ['REFLECTION_SUBMITTED'],
  run: ({ actions }) => {
    const out: Draft[] = [];
    for (const a of actions) {
      if (a.action !== 'REFLECTION_SUBMITTED') continue;
      const parts = (a.meta.partChars ?? {}) as Record<string, number>;
      out.push(draft('M22', [a], { outcome: 'self_appraisal', detail: { partChars: parts } }));
      if ((parts.implementationIntention ?? 0) > 0) {
        out.push(
          draft('M22', [a], {
            outcome: 'forward_planning',
            detail: { chars: parts.implementationIntention },
          }),
        );
      }
    }
    return out;
  },
};

const M23: RuleDef = {
  id: 'M23',
  inputs: ['CONFIDENCE_RATED'],
  // Workbook: compute per learner over a module, not per item. Here per
  // module item (one session) for the pairs available in this session; the
  // Phase 5 outcome export aggregates across sessions.
  run: ({ actions }) => {
    const byItem = new Map<string, { conf: number; correct: boolean; sources: RawAction[] }[]>();
    for (const ans of actions) {
      if (ans.action !== 'MCQ_ANSWERED') continue;
      const conf = [...actions]
        .reverse()
        .find(
          (a) =>
            a.action === 'CONFIDENCE_RATED' &&
            a.meta.timing === 'before' &&
            sameSlide(a, ans) &&
            a.at <= ans.at,
        );
      if (!conf) continue;
      const key = ans.moduleItemId ?? '';
      const list = byItem.get(key) ?? [];
      list.push({
        conf: num(conf.meta.value),
        correct: ans.meta.correct === true,
        sources: [conf, ans],
      });
      byItem.set(key, list);
    }
    const out: Draft[] = [];
    for (const [, pairs] of byItem) {
      const p = pairs.map((x) => (x.conf - 1) / 4); // 1–5 → 0–1
      const c = pairs.map((x) => (x.correct ? 1 : 0));
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const bias = mean(p) - mean(c);
      const absolute = mean(p.map((v, i) => Math.abs(v - c[i]!)));
      out.push(
        draft(
          'M23',
          pairs.flatMap((x) => x.sources),
          {
            outcome: bias > 0.25 ? 'overconfident' : bias < -0.25 ? 'underconfident' : 'calibrated',
            detail: {
              pairs: pairs.length,
              bias: Math.round(bias * 1000) / 1000,
              absoluteAccuracy: Math.round(absolute * 1000) / 1000,
            },
          },
        ),
      );
    }
    return out;
  },
};

const M24: RuleDef = {
  id: 'M24',
  inputs: ['PREDICTION_COMMITTED', 'SELF_CHECK_SUBMITTED', 'RESULTS_RECORDED', 'BELIEF_COMMITTED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    for (const c of actions) {
      if (!isLowEffort(c, params)) continue;
      const kind = revealKindFor(c);
      if (!kind) continue;
      const rev = findAfter(
        actions,
        c,
        params.W_seq,
        (a) =>
          a.action === 'REFERENCE_REVEALED' && a.meta.revealKind === kind && sameSlideItem(a, c),
      );
      if (!rev) continue;
      out.push(
        draft('M24', [c, rev], {
          outcome: 'low_effort_candidate',
          detail: { chars: c.meta.chars, gateMin: GATE_MIN[c.action], msOnSlide: c.meta.msOnSlide },
        }),
      );
    }
    return out;
  },
};

// ── AI interaction (Prompt Lab) ───────────────────────────────────────────

const M26: RuleDef = {
  id: 'M26',
  inputs: ['PROMPT_SUBMITTED'],
  run: ({ actions }) => {
    const out: Draft[] = [];
    const seen = new Set<string>();
    for (const p of actions) {
      if (p.action !== 'PROMPT_SUBMITTED') continue;
      const key = `${p.moduleItemId}|${slideOf(p)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const before = actions.filter((a) => a.at <= p.at && sameSlide(a, p));
      const settings = before.find((a) => a.action === 'RUN_SETTINGS_RECORDED');
      const goal = before.find((a) => a.action === 'PROMPT_GOAL_DECLARED');
      if (settings && goal)
        out.push(
          draft(
            'M26',
            [settings, goal, p].sort((a, b) => a.at - b.at),
            { outcome: 'planned_ai_task' },
          ),
        );
    }
    return out;
  },
};

const M27: RuleDef = {
  id: 'M27',
  inputs: ['PROMPT_VERSION_SAVED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    for (const v of actions) {
      if (v.action !== 'PROMPT_VERSION_SAVED') continue;
      const ratio = num(v.meta.editRatioFromPrev);
      if (!(ratio > 0)) continue;
      const judged = findBefore(
        actions,
        v,
        params.W_seq,
        (a) => is(a, 'OUTPUT_RATED', 'TEST_RESULT_RECORDED') && sameSlide(a, v),
      );
      if (!judged) continue;
      const viewed = findBefore(
        actions,
        judged,
        params.W_seq,
        (a) =>
          a.action === 'AI_OUTPUT_VIEWED' &&
          sameSlide(a, judged) &&
          num(a.meta.dwellMs) >= tOutMs(params, num(a.meta.responseWords) || 0),
      );
      if (!viewed) continue;
      out.push(
        draft('M27', [viewed, judged, v], {
          outcome: 'evaluation_driven_revision',
          detail: { editRatio: ratio, judgedBy: judged.action },
        }),
      );
    }
    return out;
  },
};

const M28: RuleDef = {
  id: 'M28',
  inputs: ['PROMPT_SUBMITTED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    const submits = actions.filter(
      (a) => a.action === 'PROMPT_SUBMITTED' && a.meta.declaredExperiment !== true,
    );
    for (const p of submits) {
      const view = actions.find(
        (a) => a.action === 'AI_OUTPUT_VIEWED' && a.meta.runId === p.meta.runId,
      );
      if (!view) continue;
      const words = num(view.meta.responseWords) || 0;
      if (num(view.meta.dwellMs) >= tOutMs(params, words)) continue;
      const next = findAfter(
        actions,
        p,
        params.W_seq,
        (a) =>
          sameSlide(a, p) &&
          a.meta.runId !== p.meta.runId &&
          ((a.action === 'PROMPT_SUBMITTED' && a.meta.declaredExperiment !== true) ||
            (a.action === 'OUTPUT_REGENERATED' && a.meta.declaredExperiment !== true)),
      );
      if (!next) continue;
      const judged = actions.some(
        (a) =>
          a.at > p.at &&
          a.at < next.at &&
          sameSlide(a, p) &&
          is(a, 'OUTPUT_RATED', 'TEST_RESULT_RECORDED', 'OUTPUT_VERIFIED'),
      );
      if (judged) continue;
      out.push(
        draft('M28', [p, view, next], {
          outcome: 'unreflective_regeneration_candidate',
          detail: { dwellMs: view.meta.dwellMs, tOutMs: tOutMs(params, words) },
        }),
      );
    }
    return out;
  },
};

const M29: RuleDef = {
  id: 'M29',
  inputs: ['TEST_CASE_RUN'],
  run: ({ actions }) => {
    const byVersion = new Map<
      string,
      { cases: Set<string>; sources: RawAction[]; judged: boolean }
    >();
    for (const a of actions) {
      if (!is(a, 'TEST_CASE_RUN', 'TEST_RESULT_RECORDED')) continue;
      const v = String(a.meta.versionId ?? '');
      if (!v) continue;
      const e = byVersion.get(v) ?? { cases: new Set(), sources: [], judged: false };
      if (a.action === 'TEST_CASE_RUN') e.cases.add(String(a.meta.testCaseKey));
      else e.judged = true;
      e.sources.push(a);
      byVersion.set(v, e);
    }
    const out: Draft[] = [];
    for (const [versionId, e] of byVersion) {
      if (e.cases.size >= 2 && e.judged) {
        out.push(
          draft('M29', e.sources, {
            outcome: 'systematic_testing',
            detail: { versionId, cases: e.cases.size },
          }),
        );
      }
    }
    return out;
  },
};

const M30: RuleDef = {
  id: 'M30',
  inputs: ['OUTPUT_VERIFIED'],
  run: ({ actions }) => {
    const out: Draft[] = [];
    for (const v of actions) {
      if (v.action !== 'OUTPUT_VERIFIED') continue;
      const viewed = actions.find(
        (a) => a.action === 'AI_OUTPUT_VIEWED' && a.meta.runId === v.meta.runId && a.at <= v.at,
      );
      out.push(
        draft('M30', viewed ? [viewed, v] : [v], { outcome: String(v.meta.verdict ?? 'verified') }),
      );
    }
    return out;
  },
};

/** M31 passive reliance / M32 active use, from AI-matched pastes. */
function relianceRules({ actions, params }: EngineInput): Draft[] {
  const out: Draft[] = [];
  for (const p of actions) {
    if (p.action !== 'OUTPUT_PASTED' || p.meta.matchesAiOutput !== true) continue;
    const edited = findAfter(
      actions,
      p,
      params.W_seq,
      (a) =>
        a.action === 'OUTPUT_EDITED' &&
        a.meta.targetField === p.meta.targetField &&
        sameSlide(a, p),
    );
    const ratio = edited ? num(edited.meta.editRatio) : 0;
    if (edited && ratio >= params.E_edit) {
      out.push(
        draft('M32', [p, edited], {
          outcome: 'active_use',
          detail: { editRatio: ratio, targetField: p.meta.targetField },
        }),
      );
      continue;
    }
    const verified = findAfter(
      actions,
      p,
      params.W_seq,
      (a) => a.action === 'OUTPUT_VERIFIED' && a.meta.runId === p.meta.runId,
    );
    if (!verified) {
      out.push(
        draft('M31', edited ? [p, edited] : [p], {
          outcome: 'passive_reliance_candidate',
          detail: { editRatio: edited ? ratio : null, targetField: p.meta.targetField },
        }),
      );
    }
  }
  return out;
}

const M31: RuleDef = {
  id: 'M31',
  inputs: ['OUTPUT_PASTED'],
  run: (i) => relianceRules(i).filter((d) => d.ruleId === 'M31'),
};
const M32: RuleDef = {
  id: 'M32',
  inputs: ['OUTPUT_PASTED'],
  run: (i) => relianceRules(i).filter((d) => d.ruleId === 'M32'),
};

const M34: RuleDef = {
  id: 'M34',
  inputs: ['INTERVENTION_TRIGGERED'],
  run: ({ actions, params }) => {
    const out: Draft[] = [];
    for (const t of actions) {
      if (t.action !== 'INTERVENTION_TRIGGERED') continue;
      const matches = (a: RawAction) =>
        t.interventionId ? a.interventionId === t.interventionId : true;
      const done = findAfter(
        actions,
        t,
        params.W_seq,
        (a) => a.action === 'INTERVENTION_COMPLETED' && matches(a),
      );
      const viewed = findAfter(
        actions,
        t,
        params.W_seq,
        (a) => a.action === 'INTERVENTION_VIEWED' && matches(a),
      );
      const end = done ?? viewed;
      out.push(
        draft('M34', end ? [t, end] : [t], {
          outcome: done ? 'completed' : viewed ? 'viewed_only' : 'not_taken_up',
          detail: {
            triggerReason: t.meta.triggerReason ?? null,
            interventionType: t.meta.interventionType ?? null,
          },
        }),
      );
    }
    return out;
  },
};

const M35: RuleDef = {
  id: 'M35',
  inputs: ['TRANSFER_TASK_SUBMITTED'],
  // Independent outcome (no AI access). The score itself lives in
  // transfer_task_scores and is joined in the outcomes export.
  run: ({ actions }) =>
    actions
      .filter((a) => a.action === 'TRANSFER_TASK_SUBMITTED')
      .map((a) =>
        draft('M35', [a], { outcome: 'transfer_submitted', detail: { chars: a.meta.chars } }),
      ),
};

// Rules with no input in this course (registered for the coverage report).
const na = (id: string, inputs: string[], why: string): RuleDef => ({
  id,
  inputs,
  notApplicable: why,
  run: () => [],
});

export const RULES: RuleDef[] = [
  M01,
  M02,
  M03,
  M03b,
  M04,
  M05,
  M06,
  M07,
  M08,
  na('M09', ['HINT_OPENED'], 'No hints in this course.'),
  na(
    'M10',
    ['SOLUTION_REQUESTED'],
    'Course reveals are gated behind the learner’s own attempt — mapped to M15, never M10.',
  ),
  na('M11', ['MCQ_ANSWERED'], 'One answer per MCQ: repeated failure on an item cannot occur.'),
  na(
    'M12',
    ['INTERVENTION_DISMISSED', 'HELP_DISMISSED'],
    'INTERVENTION_DISMISSED is never emitted yet (Phase 6 nudges will emit it).',
  ),
  M13,
  M14,
  M15,
  M16,
  na('M17', ['PLAN_EDITED'], 'No study planner in this course.'),
  na('M18', ['RETRY_STARTED'], 'No retry path after an incorrect answer.'),
  na('M19', ['RESOURCE_CHANGED'], 'No resource/strategy switch events.'),
  M20,
  M21,
  M22,
  M23,
  M24,
  M25,
  M26,
  M27,
  M28,
  M29,
  M30,
  M31,
  M32,
  M33,
  M34,
  M35,
];

export function runRules(input: EngineInput): Draft[] {
  return RULES.flatMap((r) => r.run(input)).sort(
    (a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId),
  );
}

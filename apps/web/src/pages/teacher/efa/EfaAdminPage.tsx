import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  EfaProgressOccasion,
  EfaProgressStudent,
  EfaProgressView,
  EfaSettings,
  EfaSettingsView,
} from '@ats/shared';
import { api, ApiError } from '../../../lib/api';

/**
 * EF assessment for one course (staff, admin bundle): settings and gate
 * placement, the progress dashboard with the administration log and the
 * audited actions (unlock gate, reset puzzle, reopen occasion), and rater
 * assignments. Coding and exports live on the coding page.
 */

const TASKS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'] as const;
const TASK_NAME: Record<string, string> = {
  w1: 'W1 Number repetition (digit span)',
  w2: 'W2 Letters and numbers (LNS)',
  w3: 'W3 Plus–minus',
  w4: 'W4 Word lists (fluency)',
  w5: 'W5 Finishing sentences (Hayling)',
  w6: 'W6 Colours (Stroop)',
  w7: 'W7 Trails (TMT)',
};
const OCC = ['T0', 'T1', 'T2'] as const;
const OCC_PLACE: Record<(typeof OCC)[number], string> = {
  T0: 'before',
  T1: 'before',
  T2: 'after',
};
type Tab = 'settings' | 'progress' | 'raters';

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

export function EfaAdminPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const [tab, setTab] = useState<Tab>('progress');

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <Link to={`/teacher/courses/${courseId}`} className="text-sm text-blue-600 hover:underline">
          ← Back to course
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">EF assessment</h1>
        <p className="mt-1 text-sm text-gray-600">
          Students see this as “Attention and memory puzzles”. Names of tasks and constructs below
          are staff-only.
        </p>
      </div>
      <div className="flex gap-2 border-b">
        {(['progress', 'settings', 'raters'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${
              tab === t
                ? 'border-blue-600 font-medium text-blue-700'
                : 'border-transparent text-gray-600'
            }`}
          >
            {t}
          </button>
        ))}
        <Link
          to={`/teacher/courses/${courseId}/efa/coding`}
          className="ml-auto px-3 py-2 text-sm text-blue-600 hover:underline"
        >
          Coding and exports →
        </Link>
      </div>
      {tab === 'settings' && <SettingsTab courseId={courseId!} />}
      {tab === 'progress' && <ProgressTab courseId={courseId!} />}
      {tab === 'raters' && <RatersTab courseId={courseId!} />}
    </div>
  );
}

// ── settings ──────────────────────────────────────────────────────────────

function SettingsTab({ courseId }: { courseId: string }) {
  const [view, setView] = useState<EfaSettingsView | null>(null);
  const [form, setForm] = useState<EfaSettings | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    void api
      .get<EfaSettingsView>(`/efa-admin/courses/${courseId}/settings`)
      .then((v) => {
        setView(v);
        setForm(v);
      })
      .catch((e) => setNote(message(e, 'Could not load settings')));
  }, [courseId]);

  if (!view || !form) return <p className="text-sm text-gray-500">{note || 'Loading…'}</p>;
  const started = view.gates.some((g) => g.completions > 0);

  const save = async () => {
    setNote('');
    try {
      const body: EfaSettings = {
        enabledOccasions: form.enabledOccasions,
        enabledTasks: form.enabledTasks,
        showDiagnosisItem: form.showDiagnosisItem,
        adexiAtT2: form.adexiAtT2,
        t2MinMinutesAfterPrevious: form.t2MinMinutesAfterPrevious,
        positions: form.positions,
      };
      const v = await api.put<EfaSettingsView>(`/efa-admin/courses/${courseId}/settings`, body);
      setView(v);
      setForm(v);
      setNote('Saved. Gates placed.');
    } catch (e) {
      setNote(message(e, 'Could not save'));
    }
  };

  return (
    <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 text-sm">
      {view.usingDefaults && (
        <p className="rounded bg-amber-50 px-3 py-2 text-amber-800">
          Not set up yet: these are the defaults. Saving places the gates in the course.
        </p>
      )}
      {started && (
        <p className="rounded bg-amber-50 px-3 py-2 text-amber-800">
          Students have already passed some gates. Changing tasks or positions now affects only what
          is still ahead of them; a disabled occasion with completions is kept as not required.
        </p>
      )}

      <section>
        <h2 className="font-semibold text-gray-900">Occasions</h2>
        <div className="mt-2 space-y-2">
          {OCC.map((o) => (
            <div key={o} className="flex flex-wrap items-center gap-3">
              <label className="flex w-28 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.enabledOccasions[o]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      enabledOccasions: { ...form.enabledOccasions, [o]: e.target.checked },
                    })
                  }
                />
                {o}
              </label>
              <span className="text-gray-500">{OCC_PLACE[o]}</span>
              <select
                disabled={!form.enabledOccasions[o]}
                value={form.positions[o] ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    positions: { ...form.positions, [o]: e.target.value || null },
                  })
                }
                className="rounded border px-2 py-1 disabled:opacity-50"
              >
                <option value="">choose a session…</option>
                {view.modules.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-gray-900">Puzzles</h2>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {TASKS.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabledTasks.includes(t)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    enabledTasks: e.target.checked
                      ? TASKS.filter((x) => x === t || form.enabledTasks.includes(x))
                      : form.enabledTasks.filter((x) => x !== t),
                  })
                }
              />
              {TASK_NAME[t]}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold text-gray-900">Options</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.showDiagnosisItem}
            onChange={(e) => setForm({ ...form, showDiagnosisItem: e.target.checked })}
          />
          Ask the diagnosis item (A13) at T0
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.adexiAtT2}
            onChange={(e) => setForm({ ...form, adexiAtT2: e.target.checked })}
          />
          Repeat “How you usually are” (ADEXI) at T2
        </label>
        <label className="flex items-center gap-2">
          T2 may start only
          <input
            type="number"
            min={0}
            value={form.t2MinMinutesAfterPrevious}
            onChange={(e) =>
              setForm({ ...form, t2MinMinutesAfterPrevious: Number(e.target.value) || 0 })
            }
            className="w-20 rounded border px-2 py-1"
          />
          minutes after the student’s last course activity
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          disabled={!form.enabledTasks.length}
          className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save settings
        </button>
        {note && <span className="text-gray-700">{note}</span>}
      </div>

      {view.gates.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-900">Gates in this course</h2>
          <table className="mt-2 text-xs">
            <tbody>
              {view.gates.map((g) => (
                <tr key={g.id} className="border-t">
                  <td className="py-1 pr-3">{g.occasion}</td>
                  <td className="pr-3">{g.kind}</td>
                  <td className="pr-3">
                    {g.position === 'AFTER_MODULE' ? 'after' : 'before'}{' '}
                    {view.modules.find((m) => m.id === g.moduleId)?.title}
                  </td>
                  <td className="pr-3">#{g.sequence}</td>
                  <td className="pr-3">{g.required ? 'required' : 'not required'}</td>
                  <td>{g.completions} passed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

// ── progress ──────────────────────────────────────────────────────────────

type Action =
  | { kind: 'unlock'; gateId: string; label: string; student: EfaProgressStudent }
  | { kind: 'reset'; runId: string; label: string; student: EfaProgressStudent }
  | { kind: 'reopen'; occasionId: string; label: string; student: EfaProgressStudent };

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  in_progress: 'bg-blue-100 text-blue-800',
  interrupted: 'bg-amber-100 text-amber-800',
  skipped: 'bg-gray-200 text-gray-700',
  pending: 'bg-gray-100 text-gray-600',
};

function runFlags(flags: Record<string, unknown> | null, skipReason: string | null) {
  const out: string[] = [];
  if (skipReason) out.push(skipReason.replace(/_/g, ' '));
  if (!flags) return out;
  if (flags.interrupted) out.push('interrupted');
  if (flags.items_reexposed) out.push('items re-exposed');
  if (Array.isArray(flags.discontinued)) out.push(`discontinued ${flags.discontinued.join('/')}`);
  return out;
}

function ProgressTab({ courseId }: { courseId: string }) {
  const [data, setData] = useState<EfaProgressView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(
    () =>
      api
        .get<EfaProgressView>(`/efa-admin/courses/${courseId}/progress`)
        .then(setData)
        .catch((e) => setNote(message(e, 'Could not load progress'))),
    [courseId],
  );
  useEffect(() => void load(), [load]);

  const confirm = async () => {
    if (!action) return;
    try {
      const url =
        action.kind === 'unlock'
          ? `/course-gates/${action.gateId}/students/${action.student.studentId}/unlock`
          : action.kind === 'reset'
            ? `/efa-admin/runs/${action.runId}/reset`
            : `/efa-admin/occasions/${action.occasionId}/reopen`;
      await api.post(url, { reason });
      setNote(`${action.label} — done for ${action.student.name}.`);
      setAction(null);
      setReason('');
      await load();
    } catch (e) {
      setNote(message(e, 'Action failed'));
    }
  };

  if (!data) return <p className="text-sm text-gray-500">{note || 'Loading…'}</p>;
  if (!data.gates.length)
    return (
      <p className="text-sm text-gray-600">
        No EF gates in this course yet — set it up under Settings.
      </p>
    );

  return (
    <div className="space-y-3">
      {note && <p className="rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">{note}</p>}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm" data-testid="efa-progress">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Student</th>
              {data.gates.map((g) => (
                <th key={g.id} className="px-3 py-2">
                  {g.label}
                </th>
              ))}
              <th className="px-3 py-2">Occasions</th>
            </tr>
          </thead>
          <tbody>
            {data.students.map((s) => (
              <Fragment key={s.studentId}>
                <tr className="border-t align-top">
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setOpen(open === s.studentId ? null : s.studentId)}
                      className="text-left font-medium text-blue-700 hover:underline"
                    >
                      {s.name}
                    </button>
                    <div className="text-xs text-gray-500">{s.email}</div>
                  </td>
                  {s.gates.map((g, i) => (
                    <td key={g.gateId} className="px-3 py-2">
                      {g.done ? (
                        <span title={g.reason ?? undefined} className="text-green-700">
                          ✓{g.source === 'override' ? ' (unlocked)' : ''}
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            setAction({
                              kind: 'unlock',
                              gateId: g.gateId,
                              label: `Unlock ${data.gates[i]!.label}`,
                              student: s,
                            })
                          }
                          className="rounded border px-2 py-0.5 text-xs hover:bg-gray-50"
                        >
                          Unlock…
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">
                    {s.occasions.map((o) => (
                      <div key={o.occasionId}>
                        {o.occasion}: {o.status.replace(/_/g, ' ')} · form {o.form ?? '—'} · order{' '}
                        {o.orderCode ?? '—'}
                      </div>
                    ))}
                    {!s.occasions.length && <span className="text-gray-400">not started</span>}
                  </td>
                </tr>
                {open === s.studentId &&
                  s.occasions.map((o) => (
                    <tr key={o.occasionId} className="bg-gray-50">
                      <td colSpan={data.gates.length + 2} className="px-3 py-3">
                        <OccasionDetail occasion={o} student={s} onAction={setAction} />
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
            <h3 className="font-semibold text-gray-900">
              {action.label} — {action.student.name}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {action.kind === 'reset'
                ? 'The student will do this puzzle again with the same items (flagged as re-exposed).'
                : action.kind === 'reopen'
                  ? 'The student can continue where they stopped.'
                  : 'The student can go on without completing this step.'}{' '}
              This is recorded with your name and the reason.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              className="mt-3 h-20 w-full rounded border p-2 text-sm"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAction(null)}
                className="rounded border px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                disabled={reason.trim().length < 5}
                onClick={() => void confirm()}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OccasionDetail({
  occasion: o,
  student,
  onAction,
}: {
  occasion: EfaProgressOccasion;
  student: EfaProgressStudent;
  onAction: (a: Action) => void;
}) {
  const open = o.status !== 'completed' && o.status !== 'abandoned';
  const d = o.log.device as { userAgent?: string; viewportW?: number; viewportH?: number } | null;
  const flags = o.flags ?? {};
  return (
    <div className="grid gap-4 text-xs md:grid-cols-2">
      <div>
        <h4 className="font-semibold text-gray-800">
          {o.occasion} administration log
          {o.status === 'abandoned' && (
            <button
              onClick={() =>
                onAction({
                  kind: 'reopen',
                  occasionId: o.occasionId,
                  label: `Reopen ${o.occasion}`,
                  student,
                })
              }
              className="ml-2 rounded border px-2 py-0.5 font-normal hover:bg-white"
            >
              Reopen…
            </button>
          )}
        </h4>
        <dl className="mt-1 grid grid-cols-[10rem_1fr] gap-x-2 gap-y-0.5 text-gray-700">
          <dt>Status</dt>
          <dd>{o.status.replace(/_/g, ' ')}</dd>
          <dt>Form / order / slot</dt>
          <dd>
            {o.form ?? '—'} / {o.orderCode ?? '—'} / {o.slot ?? '—'}
          </dd>
          <dt>Started</dt>
          <dd>{when(o.log.startedAt)}</dd>
          <dt>Questionnaire done</dt>
          <dd>{when(o.log.questionnaireDoneAt)}</dd>
          <dt>Completed</dt>
          <dd>{when(o.log.completedAt)}</dd>
          {o.log.abandonedAt && (
            <>
              <dt>Expired</dt>
              <dd>{when(o.log.abandonedAt)}</dd>
            </>
          )}
          <dt>Gap since course activity</dt>
          <dd>
            {o.log.gapSincePreviousActivityMin == null
              ? '—'
              : `${o.log.gapSincePreviousActivityMin} min`}
          </dd>
          <dt>Full screen</dt>
          <dd>
            {o.log.fullscreenAccepted == null ? '—' : o.log.fullscreenAccepted ? 'yes' : 'no'}
          </dd>
          <dt>Camera/eye sensing</dt>
          <dd>{o.log.sensingPaused ? 'paused' : 'on'}</dd>
          <dt>Focus lost (total)</dt>
          <dd>{o.log.focusLostSec} s</dd>
          <dt>Colour check</dt>
          <dd>
            {flags.colourCheckFailed === true
              ? 'failed (colours skipped)'
              : flags.colourCheckFailed === false
                ? 'passed'
                : '—'}
          </dd>
          <dt>Device</dt>
          <dd className="break-all">
            {d ? `${d.viewportW ?? '?'}×${d.viewportH ?? '?'} · ${d.userAgent ?? ''}` : '—'}
          </dd>
          <dt>Scoring version</dt>
          <dd>{o.log.scoringVersion ?? '—'}</dd>
        </dl>
      </div>
      <div>
        <h4 className="font-semibold text-gray-800">Puzzles</h4>
        <table className="mt-1 w-full">
          <tbody>
            {o.runs.map((r) => (
              <tr key={r.runId} className="border-t">
                <td className="py-1 pr-2">{TASK_NAME[r.task] ?? r.task}</td>
                <td className="pr-2">
                  <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[r.status] ?? ''}`}>
                    {r.status}
                  </span>
                  {r.attempts > 1 && (
                    <span className="ml-1 text-gray-500">attempt {r.attempt}</span>
                  )}
                </td>
                <td className="pr-2 text-gray-600">{runFlags(r.flags, r.skipReason).join(', ')}</td>
                <td className="text-right">
                  {open && !r.resetReason && r.status !== 'skipped' && (
                    <button
                      onClick={() =>
                        onAction({
                          kind: 'reset',
                          runId: r.runId,
                          label: `Reset ${r.task.toUpperCase()}`,
                          student,
                        })
                      }
                      className="rounded border px-2 py-0.5 hover:bg-white"
                    >
                      Reset…
                    </button>
                  )}
                  {r.resetReason && <span className="text-gray-500">reset</span>}
                </td>
              </tr>
            ))}
            {!o.runs.length && (
              <tr>
                <td className="text-gray-400">none yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── raters ────────────────────────────────────────────────────────────────

function RatersTab({ courseId }: { courseId: string }) {
  type Staff = { id: string; name: string; email: string; role: string };
  const [staff, setStaff] = useState<Staff[]>([]);
  const [assigned, setAssigned] = useState<{ w4: string[]; w5: string[] } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    void api
      .get<{ staff: Staff[]; assignments: { w4: string[]; w5: string[] } }>(
        `/efa-admin/courses/${courseId}/raters`,
      )
      .then((r) => {
        setStaff(r.staff);
        setAssigned(r.assignments);
      })
      .catch((e) => setNote(message(e, 'Could not load raters')));
  }, [courseId]);

  if (!assigned) return <p className="text-sm text-gray-500">{note || 'Loading…'}</p>;
  const toggle = (t: 'w4' | 'w5', id: string) =>
    setAssigned({
      ...assigned,
      [t]: assigned[t].includes(id) ? assigned[t].filter((x) => x !== id) : [...assigned[t], id],
    });
  const save = async () => {
    try {
      const r = await api.put<{ assignments: { w4: string[]; w5: string[] } }>(
        `/efa-admin/courses/${courseId}/raters`,
        assigned,
      );
      setAssigned(r.assignments);
      setNote('Saved.');
    } catch (e) {
      setNote(message(e, 'Could not save'));
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm">
      <p className="text-gray-600">
        Two raters code each entry. Choose at least two people per puzzle; with none chosen, the
        course owner and admins code it. Assigned raters who do not own the course can use the
        coding queue only.
      </p>
      <table className="mt-3">
        <thead className="text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="py-1 pr-6">Staff</th>
            <th className="pr-4">W4 word lists</th>
            <th>W5 sentences</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="py-1 pr-6">
                {p.name} <span className="text-xs text-gray-500">{p.email}</span>
              </td>
              {(['w4', 'w5'] as const).map((t) => (
                <td key={t}>
                  <input
                    type="checkbox"
                    checked={assigned[t].includes(p.id)}
                    onChange={() => toggle(t, p.id)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void save()}
          className="rounded bg-blue-600 px-4 py-1.5 text-white hover:bg-blue-700"
        >
          Save raters
        </button>
        {(['w4', 'w5'] as const).some((t) => assigned[t].length === 1) && (
          <span className="text-amber-700">
            A puzzle with one rater cannot reach two codes per entry.
          </span>
        )}
        {note && <span className="text-gray-700">{note}</span>}
      </div>
    </div>
  );
}

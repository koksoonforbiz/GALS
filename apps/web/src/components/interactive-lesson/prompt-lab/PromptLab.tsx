/**
 * Prompt Lab (prompting course, plan Phase 3): the in-GALS replacement for
 * the external AI tool on exercise/task/stretch slides, laid out as the
 * course's own lab steps — plan → prompt → inspect → judge → verify — so
 * prompting behaviour becomes observable (AI-interaction events M26–M33).
 *
 * Prompt and output text are stored server-side in prompt_lab_* tables (the
 * learner's deliberate work, like ChatbotMessage); activity events carry ids
 * and counts only. Every text field is under data-replay-redact.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LessonSlide } from '@ats/shared';
import { api } from '../../../lib/api';
import type { LessonEmit } from '../slides';
import type { SlideFields } from '../useLessonData';
import { rememberOutput, takePaste } from './aiOutputs';
import { editRatio } from './wordDiff';

const REVISION_TAGS = [
  'context',
  'constraint',
  'example',
  'format',
  'role',
  'compression',
  'reasoning',
  'other',
] as const;
const FAILURE_REASONS: Array<[string, string]> = [
  ['missing_fact', 'Missing fact'],
  ['ambiguity', 'Ambiguity'],
  ['instruction_dropped', 'Instruction dropped'],
  ['format', 'Format'],
  ['other', 'Other'],
];
const CRITERIA: Array<[keyof Criteria, string]> = [
  ['correct', 'Correct'],
  ['complete', 'Complete'],
  ['format', 'Follows the requested format'],
];

interface Criteria {
  correct?: number;
  complete?: number;
  format?: number;
}
interface Run {
  id: string;
  promptText: string;
  responseText: string;
  model: string;
  provider: string;
  temperature: number | null;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  versionNo: number | null;
  versionId: string | null;
  testCaseKey: string | null;
  sampleNo: number;
  declaredExperiment: boolean;
  createdAt: string;
}
interface Version {
  id: string;
  versionNo: number;
  promptText: string;
  tokenCount: number;
  revisionTags: string[];
  diffFromPrev: { editRatio: number } | null;
  testResults: Array<{ testCaseKey: string; pass: boolean; failureReason: string | null }>;
}
interface TestCase {
  caseKey: string;
  label: string;
  inputText: string;
}
interface LabSnapshot {
  runs: Run[];
  versions: Version[];
  testCases: TestCase[];
  usage: { runsLastHour: number; runsPerHour: number; tokensLast24h: number; tokensPerDay: number };
  defaultModel: string;
  models: Array<{ id: string; label: string; supportsTemperature: boolean }>;
}

export interface PromptLabProps {
  itemId: string;
  slide: LessonSlide;
  fields: SlideFields;
  save: (patch: SlideFields) => void;
  emit: LessonEmit;
  sessionId: string | null;
  readOnly?: boolean;
}

const approx = (t: string) => Math.ceil(t.length / 4);
const wordsOf = (t: string) => t.split(/\s+/).filter(Boolean).length;

export function PromptLab({
  itemId,
  slide,
  fields,
  save,
  emit,
  sessionId,
  readOnly,
}: PromptLabProps) {
  const plan = (fields.labPlan ?? {}) as { goal?: string; model?: string; temperature?: number };
  const [snap, setSnap] = useState<LabSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState(plan.goal ?? '');
  const [model, setModel] = useState(plan.model ?? '');
  const [temperature, setTemperature] = useState<number | ''>(plan.temperature ?? '');
  const [prompt, setPrompt] = useState(String(fields.labDraft ?? ''));
  const [samples, setSamples] = useState(3);
  const [tags, setTagsState] = useState<string[]>([]);
  // Ref mirror so a save right after a tag toggle never sees stale tags.
  const tagsRef = useRef<string[]>([]);
  const setTags = (update: (cur: string[]) => string[]) => {
    tagsRef.current = update(tagsRef.current);
    setTagsState(tagsRef.current);
  };
  const [guess, setGuess] = useState('');
  const [tokenNote, setTokenNote] = useState('');
  const [shownRunId, setShownRunId] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<Criteria>({});
  const [claim, setClaim] = useState('');
  const [verdict, setVerdict] = useState('');
  const [newCase, setNewCase] = useState({ label: '', inputText: '' });
  const viewing = useRef<{ runId: string; since: number; words: number } | null>(null);

  const base = useMemo(() => ({ moduleItemId: itemId, slideKey: slide.key }), [itemId, slide.key]);

  const load = useCallback(async () => {
    try {
      const data = await api.get<LabSnapshot>(
        `/prompt-lab/me?moduleItemId=${itemId}&slideKey=${encodeURIComponent(slide.key)}`,
      );
      setSnap(data);
      // Runs arrive newest first; remember oldest → newest so the newest
      // output is matched first when a paste is compared.
      [...data.runs].reverse().forEach((r) => rememberOutput(r.id, r.responseText));
      setModel((m) => m || data.defaultModel);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prompt Lab unavailable');
    }
  }, [itemId, slide.key]);

  useEffect(() => {
    if (!readOnly) void load();
  }, [load, readOnly]);

  // AI_OUTPUT_VIEWED: dwell on the displayed output until it changes or the lab unmounts.
  const closeViewing = useCallback(() => {
    const v = viewing.current;
    if (!v) return;
    viewing.current = null;
    const dwellMs = Math.round(performance.now() - v.since);
    if (dwellMs > 0) emit('ai_output_viewed', { runId: v.runId, dwellMs, responseWords: v.words });
  }, [emit]);
  useEffect(() => closeViewing, [closeViewing]);

  const shownRun = snap?.runs.find((r) => r.id === shownRunId) ?? snap?.runs[0] ?? null;
  useEffect(() => {
    if (!shownRun || viewing.current?.runId === shownRun.id) return;
    closeViewing();
    viewing.current = {
      runId: shownRun.id,
      since: performance.now(),
      words: wordsOf(shownRun.responseText),
    };
    setCriteria({});
    setClaim('');
    setVerdict('');
  }, [shownRun, closeViewing]);

  if (readOnly) {
    return (
      <div className="prompt-lab">
        <div className="box-title">Prompt Lab</div>
        <p className="pl-note">
          Students run this exercise here, in GALS, instead of an external AI tool.
        </p>
      </div>
    );
  }
  if (error) return <div className="prompt-lab pl-error">Prompt Lab: {error}</div>;
  if (!snap) return <div className="prompt-lab pl-note">Loading Prompt Lab…</div>;

  const modelSpec = snap.models.find((m) => m.id === model) ?? snap.models[0];
  const latestVersion = snap.versions[snap.versions.length - 1];
  const currentVersion = snap.versions.find((v) => v.promptText === prompt);
  const lastRun = snap.runs[0];

  const savePlan = () => {
    const t = temperature === '' ? undefined : Number(temperature);
    save({ labPlan: { goal, model, temperature: t } });
    if (goal.trim())
      emit('prompt_goal_declared', { chars: goal.length, text: goal, fieldKey: 'goal' });
    emit('run_settings_recorded', { model, temperature: t ?? null });
  };

  const run = async (opts: { samples?: number; testCaseKey?: string; version?: Version } = {}) => {
    const text = opts.version?.promptText ?? prompt;
    if (!text.trim()) return;
    closeViewing();
    setBusy(true);
    const unchanged =
      !opts.testCaseKey && lastRun && lastRun.promptText === text && !lastRun.testCaseKey;
    const version = opts.version ?? currentVersion;
    try {
      const res = await api.post<{ runs: Run[] }>('/prompt-lab/run', {
        ...base,
        promptText: text,
        model: model || undefined,
        temperature:
          modelSpec?.supportsTemperature && temperature !== '' ? Number(temperature) : undefined,
        versionId: version?.id,
        parentRunId: unchanged ? lastRun!.id : undefined,
        testCaseKey: opts.testCaseKey,
        samples: opts.samples ?? 1,
        ...(sessionId ? { sessionId } : {}),
      });
      for (const r of res.runs) {
        rememberOutput(r.id, r.responseText);
        emit('prompt_submitted', {
          runId: r.id,
          versionNo: r.versionNo,
          promptTokens: r.promptTokens,
          model: r.model,
          testCaseKey: r.testCaseKey,
          sampleNo: r.sampleNo,
          declaredExperiment: r.declaredExperiment,
        });
        if (opts.testCaseKey) {
          emit('test_case_run', {
            versionId: version?.id ?? null,
            testCaseKey: opts.testCaseKey,
            runId: r.id,
          });
        }
      }
      if (unchanged || (opts.samples ?? 1) > 1) {
        const parentRunId = unchanged ? lastRun!.id : res.runs[0]?.id;
        for (const r of res.runs.slice(unchanged ? 0 : 1)) {
          emit('output_regenerated', {
            runId: r.id,
            parentRunId,
            declaredExperiment: (opts.samples ?? 1) > 1,
          });
        }
      }
      const pasted = takePaste('prompt');
      if (pasted) {
        emit('output_edited', {
          targetField: 'prompt',
          editRatio: editRatio(pasted.text, text),
          runId: pasted.runId,
        });
      }
      setShownRunId(res.runs[0]?.id ?? null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
      window.setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = async () => {
    if (!prompt.trim()) return;
    const chosen = tagsRef.current;
    const v = await api.post<Version>('/prompt-lab/versions', {
      ...base,
      promptText: prompt,
      revisionTags: chosen,
    });
    emit('prompt_version_saved', {
      versionId: v.id,
      versionNo: v.versionNo,
      tokenCount: v.tokenCount,
      editRatioFromPrev: v.diffFromPrev?.editRatio ?? null,
    });
    if (chosen.length) emit('prompt_revision_tagged', { versionId: v.id, tags: chosen });
    setTags(() => []);
    await load();
  };

  const retag = async (v: Version, tag: string) => {
    const next = v.revisionTags.includes(tag)
      ? v.revisionTags.filter((t) => t !== tag)
      : [...v.revisionTags, tag];
    await api.patch(`/prompt-lab/versions/${v.id}/tags`, { revisionTags: next });
    emit('prompt_revision_tagged', { versionId: v.id, tags: next });
    await load();
  };

  const recordResult = async (v: Version, tc: TestCase, pass: boolean, failureReason?: string) => {
    const lastCaseRun = snap.runs.find((r) => r.versionId === v.id && r.testCaseKey === tc.caseKey);
    await api.post('/prompt-lab/test-results', {
      versionId: v.id,
      testCaseKey: tc.caseKey,
      pass,
      ...(pass ? {} : { failureReason: failureReason || 'other' }),
      ...(lastCaseRun ? { runId: lastCaseRun.id } : {}),
    });
    emit('test_result_recorded', {
      versionId: v.id,
      testCaseKey: tc.caseKey,
      pass,
      failureReason: pass ? null : failureReason,
    });
    await load();
  };

  const saveRating = async () => {
    if (!shownRun || Object.keys(criteria).length === 0) return;
    await api.post('/prompt-lab/ratings', { runId: shownRun.id, criteria });
    emit('output_rated', { runId: shownRun.id, criteria });
  };

  const saveVerification = async () => {
    if (!shownRun || !verdict || !claim.trim()) return;
    await api.post('/prompt-lab/ratings', {
      runId: shownRun.id,
      criteria: {},
      verifiedClaim: claim,
      verifyVerdict: verdict,
    });
    emit('output_verified', { runId: shownRun.id, verdict, claimChars: claim.length });
    setClaim('');
    setVerdict('');
  };

  const addCase = async () => {
    if (!newCase.label.trim() || !newCase.inputText.trim()) return;
    await api.post('/prompt-lab/test-cases', { ...base, ...newCase });
    setNewCase({ label: '', inputText: '' });
    await load();
  };

  return (
    <div className="prompt-lab" data-prompt-lab={slide.key}>
      <div className="box-title">
        Prompt Lab — run this exercise here, not in an external AI tool
      </div>

      {/* 1 · Plan */}
      <section className="pl-step">
        <h4>1 · Plan</h4>
        <div data-replay-redact="">
          <input
            type="text"
            className="pl-input"
            data-field-key="goal"
            placeholder="Goal, audience and output format — one line"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </div>
        <div className="pl-row">
          <label>
            Model{' '}
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {snap.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temperature{' '}
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              className="pl-num"
              disabled={!modelSpec?.supportsTemperature}
              value={temperature}
              onChange={(e) => setTemperature(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="default"
            />
          </label>
          <span className="pl-muted">Tools / browsing: off</span>
          <button type="button" className="btn secondary" onClick={savePlan}>
            Save plan
          </button>
        </div>
      </section>

      {/* 2 · Prompt */}
      <section className="pl-step">
        <h4>2 · Prompt</h4>
        <div data-replay-redact="">
          <textarea
            data-field-key="prompt"
            placeholder="Write your prompt…"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              save({ labDraft: e.target.value });
            }}
          />
        </div>
        <div className="pl-row">
          <span className="pl-muted">
            ≈ {approx(prompt)} tokens (chars ÷ 4)
            {lastRun ? ` · last run: ${lastRun.promptTokens} provider tokens` : ''}
          </span>
          <input
            type="number"
            className="pl-num"
            placeholder="your guess"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
          />
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const tokens = approx(prompt);
              emit('token_count_checked', {
                chars: prompt.length,
                tokens,
                learnerGuess: guess === '' ? null : Number(guess),
              });
              setTokenNote(
                guess === ''
                  ? `≈ ${tokens} tokens`
                  : `≈ ${tokens} tokens — your guess was ${guess}`,
              );
            }}
          >
            Check tokens
          </button>
          {tokenNote && <span className="pl-muted">{tokenNote}</span>}
        </div>
        <div className="pl-row">
          <button
            type="button"
            className="btn"
            disabled={busy || !prompt.trim()}
            onClick={() => void run()}
          >
            {busy ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || !prompt.trim()}
            onClick={() => void run({ samples })}
          >
            Run
          </button>
          <select
            value={samples}
            onChange={(e) => setSamples(Number(e.target.value))}
            aria-label="Samples"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} samples
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn secondary"
            disabled={!prompt.trim()}
            onClick={() => void saveVersion()}
          >
            Save as version {(latestVersion?.versionNo ?? 0) + 1}
          </button>
        </div>
        <div className="pl-tags" aria-label="What changed in this version">
          <span className="pl-muted">What changed:</span>
          {REVISION_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={tags.includes(t) ? 'sel' : ''}
              aria-pressed={tags.includes(t)}
              onClick={() =>
                setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
              }
            >
              {t}
            </button>
          ))}
        </div>
        {snap.versions.length > 0 && (
          <div className="pl-scroll">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Tokens ≈</th>
                  <th>Change</th>
                  <th>What changed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {snap.versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.versionNo}</td>
                    <td>{v.tokenCount}</td>
                    <td>
                      {v.diffFromPrev ? `${Math.round(v.diffFromPrev.editRatio * 100)}%` : '—'}
                    </td>
                    <td>{v.revisionTags.join(', ') || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setPrompt(v.promptText)}
                      >
                        Load
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {latestVersion && (
          <div className="pl-tags" aria-label={`Tags on v${latestVersion.versionNo}`}>
            <span className="pl-muted">Tags on v{latestVersion.versionNo}:</span>
            {REVISION_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={latestVersion.revisionTags.includes(t) ? 'sel' : ''}
                onClick={() => void retag(latestVersion, t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 3 · Inspect */}
      <section className="pl-step">
        <h4>3 · Inspect the output</h4>
        {snap.runs.length === 0 ? (
          <p className="pl-muted">No runs yet.</p>
        ) : (
          <>
            <div className="pl-row">
              <select
                value={shownRun?.id ?? ''}
                onChange={(e) => setShownRunId(e.target.value)}
                aria-label="Run"
              >
                {snap.runs.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    Run {snap.runs.length - i}
                    {r.versionNo ? ` · v${r.versionNo}` : ''}
                    {r.testCaseKey ? ` · ${r.testCaseKey}` : ''}
                    {r.declaredExperiment ? ` · sample ${r.sampleNo}` : ''}
                  </option>
                ))}
              </select>
              {shownRun && (
                <span className="pl-muted">
                  {shownRun.model} · {shownRun.promptTokens}+{shownRun.completionTokens} tokens ·{' '}
                  {(shownRun.latencyMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
            {shownRun && (
              <div
                className="pl-output"
                data-replay-region="ai-output"
                data-gals-ai-output={shownRun.id}
                data-replay-redact=""
                onCopy={() => {
                  const chars = window.getSelection()?.toString().length ?? 0;
                  if (chars > 0) {
                    // The copied run wins a later paste match over identical older outputs.
                    rememberOutput(shownRun.id, shownRun.responseText);
                    emit('output_copied', { runId: shownRun.id, chars });
                  }
                }}
              >
                {shownRun.responseText}
              </div>
            )}
            {shownRun && (
              <div className="pl-row pl-rating">
                {CRITERIA.map(([k, label]) => (
                  <label key={k}>
                    {label}{' '}
                    <select
                      value={criteria[k] ?? ''}
                      onChange={(e) => setCriteria((c) => ({ ...c, [k]: Number(e.target.value) }))}
                    >
                      <option value="">–</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  className="btn secondary"
                  disabled={Object.keys(criteria).length === 0}
                  onClick={() => void saveRating()}
                >
                  Save rating
                </button>
              </div>
            )}
            {shownRun && (
              <div className="pl-row" data-replay-redact="">
                <input
                  type="text"
                  className="pl-input"
                  data-field-key="claim"
                  placeholder="Check one claim in this output against the course pack…"
                  value={claim}
                  onChange={(e) => setClaim(e.target.value)}
                />
                <select
                  value={verdict}
                  onChange={(e) => setVerdict(e.target.value)}
                  aria-label="Verdict"
                >
                  <option value="">verdict…</option>
                  <option value="supported">supported</option>
                  <option value="unsupported">unsupported</option>
                  <option value="unsure">unsure</option>
                </select>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!claim.trim() || !verdict}
                  onClick={() => void saveVerification()}
                >
                  Save check
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* 4 · Judge: test cases × versions */}
      <section className="pl-step">
        <h4>4 · Test each version</h4>
        <div className="pl-row" data-replay-redact="">
          <input
            type="text"
            className="pl-input pl-short"
            placeholder="Test case name (e.g. Question 1)"
            value={newCase.label}
            onChange={(e) => setNewCase((c) => ({ ...c, label: e.target.value }))}
          />
          <input
            type="text"
            className="pl-input"
            data-field-key="testcase"
            placeholder="Question or input to test with…"
            value={newCase.inputText}
            onChange={(e) => setNewCase((c) => ({ ...c, inputText: e.target.value }))}
          />
          <button type="button" className="btn secondary" onClick={() => void addCase()}>
            Add test case
          </button>
        </div>
        {snap.testCases.length > 0 && snap.versions.length > 0 && (
          <div className="pl-scroll">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Version</th>
                  {snap.testCases.map((tc) => (
                    <th key={tc.caseKey}>{tc.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {snap.versions.map((v) => (
                  <tr key={v.id}>
                    <td>v{v.versionNo}</td>
                    {snap.testCases.map((tc) => {
                      const res = v.testResults.find((r) => r.testCaseKey === tc.caseKey);
                      return (
                        <td key={tc.caseKey}>
                          <TestCell
                            result={res}
                            busy={busy}
                            onRun={() => void run({ testCaseKey: tc.caseKey, version: v })}
                            onRecord={(pass, reason) => void recordResult(v, tc, pass, reason)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {snap.testCases.length > 0 && snap.versions.length === 0 && (
          <p className="pl-muted">Save a version to test it on your cases.</p>
        )}
      </section>

      <p className="pl-muted">
        Usage: {snap.usage.runsLastHour}/{snap.usage.runsPerHour} runs this hour ·{' '}
        {snap.usage.tokensLast24h.toLocaleString()}/{snap.usage.tokensPerDay.toLocaleString()}{' '}
        tokens today
      </p>
    </div>
  );
}

function TestCell({
  result,
  busy,
  onRun,
  onRecord,
}: {
  result?: { pass: boolean; failureReason: string | null };
  busy: boolean;
  onRun: () => void;
  onRecord: (pass: boolean, reason?: string) => void;
}) {
  const [reason, setReason] = useState(result?.failureReason ?? 'missing_fact');
  return (
    <div className="pl-cell">
      <button type="button" className="btn secondary" disabled={busy} onClick={onRun}>
        Run
      </button>
      <button
        type="button"
        className={result?.pass === true ? 'sel' : ''}
        onClick={() => onRecord(true)}
      >
        pass
      </button>
      <button
        type="button"
        className={result?.pass === false ? 'sel' : ''}
        onClick={() => onRecord(false, reason)}
      >
        fail
      </button>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Failure reason"
      >
        {FAILURE_REASONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

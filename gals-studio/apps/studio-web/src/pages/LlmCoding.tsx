import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  Play,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../lib/api';

/**
 * LLM-assisted coding of learner utterances (free chatbot chat + elaborative
 * interrogation) across executive-function, affect, motivation and learning-
 * strategy dimensions, using the researcher's own OpenAI or Gemini key.
 */

type Provider = 'openai' | 'gemini';
// Suggested models (the field is typeable — enter any model id the provider serves).
const MODELS: Record<Provider, string[]> = {
  openai: [
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o3',
    'o3-pro',
    'o3-mini',
    'o4-mini',
    'o1',
    'o1-mini',
  ],
  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-pro',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
  ],
};
const BATCH = 10;

const LS = {
  get: (k: string, d = '') => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const csvEsc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const DIM_GROUPS = [
  { label: 'Executive functions', prefix: 'ef_' },
  { label: 'Affective states', prefix: 'affect_' },
  { label: 'Motivation', prefix: 'mot_' },
  { label: 'Learning strategies', prefix: 'strategy_' },
];

export function LlmCoding() {
  const [users, setUsers] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dimensions, setDimensions] = useState<string[]>([]);

  const [provider, setProvider] = useState<Provider>(
    () => LS.get('gals.llm.provider', 'openai') as Provider,
  );
  const [model, setModel] = useState<string>(() => LS.get('gals.llm.model', MODELS.openai[0]));
  const [apiKey, setApiKey] = useState<string>('');

  // editable prompt (template + per-dimension definitions)
  const [template, setTemplate] = useState('');
  const [defs, setDefs] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<{
    template: string;
    definitions: Record<string, string>;
  }>({ template: '', definitions: {} });
  const [showPrompt, setShowPrompt] = useState(false);

  const [utterances, setUtterances] = useState<any[]>([]);
  const [codings, setCodings] = useState<Record<string, any>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .analysisUsers()
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
    api
      .llmDimensions()
      .then((r) => {
        setDimensions(r.dimensions ?? []);
        setDefaults({ template: r.template ?? '', definitions: r.definitions ?? {} });
        const savedT = LS.get('gals.llm.template', '');
        setTemplate(savedT || r.template || '');
        let d: Record<string, string> = { ...(r.definitions ?? {}) };
        const savedD = LS.get('gals.llm.defs', '');
        if (savedD) {
          try {
            d = { ...d, ...JSON.parse(savedD) };
          } catch {
            /* ignore */
          }
        }
        setDefs(d);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (template) LS.set('gals.llm.template', template);
  }, [template]);
  useEffect(() => {
    if (Object.keys(defs).length) LS.set('gals.llm.defs', JSON.stringify(defs));
  }, [defs]);
  const resetPrompt = () => {
    setTemplate(defaults.template);
    setDefs(defaults.definitions);
    LS.set('gals.llm.template', defaults.template);
    LS.set('gals.llm.defs', JSON.stringify(defaults.definitions));
  };
  useEffect(() => {
    setApiKey(LS.get(`gals.llm.key.${provider}`, ''));
    if (!MODELS[provider].includes(model)) setModel(MODELS[provider][0]);
    LS.set('gals.llm.provider', provider);
  }, [provider]);
  useEffect(() => LS.set('gals.llm.model', model), [model]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const columns = useMemo(
    () => [
      'userId',
      'sessionId',
      'utterance',
      'selectedText',
      'source',
      ...dimensions,
      'rationale',
    ],
    [dimensions],
  );

  const run = async () => {
    setError('');
    if (selected.size === 0) return setError('Select at least one learner.');
    if (!apiKey.trim())
      return setError(`Enter your ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key.`);
    LS.set(`gals.llm.key.${provider}`, apiKey.trim());
    setRunning(true);
    setCodings({});
    setStatus('Gathering utterances…');
    try {
      const r = await api.llmUtterances([...selected]);
      const items: any[] = r.utterances ?? [];
      setUtterances(items);
      setProgress({ done: 0, total: items.length });
      if (items.length === 0) {
        setStatus('No user utterances found for the selected learners.');
        setRunning(false);
        return;
      }
      const acc: Record<string, any> = {};
      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH).map((it) => ({
          id: it.id,
          utterance: it.utterance,
          selectedText: it.selectedText,
          source: it.source,
        }));
        setStatus(`Coding ${i + 1}–${Math.min(i + BATCH, items.length)} of ${items.length}…`);
        const res = await api.llmCode({
          provider,
          model: model.trim(),
          apiKey: apiKey.trim(),
          items: batch,
          template,
          definitions: defs,
        });
        for (const row of res.results ?? []) {
          acc[row.id] = row;
          if (row.error && !error) setError(`Some items failed: ${row.error}`);
        }
        setCodings({ ...acc });
        setProgress({ done: Math.min(i + BATCH, items.length), total: items.length });
      }
      setStatus(
        `Done — coded ${Object.values(acc).filter((r: any) => r.coding).length}/${items.length}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    if (utterances.length === 0) return;
    const rows = utterances.map((u) => {
      const c = codings[u.id]?.coding ?? {};
      const base = [u.userId, u.sessionId, u.utterance, u.selectedText, u.source];
      const dims = dimensions.map((d) => (c[d] == null ? '' : c[d]));
      return [...base, ...dims, c.rationale ?? ''];
    });
    const csv = '﻿' + [columns, ...rows].map((r) => r.map(csvEsc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `llm-coding-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  const codedCount = Object.values(codings).filter((r: any) => r?.coding).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Link to="/" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700">
          <ArrowLeft size={14} /> Library
        </Link>
        <span className="inline-flex items-center gap-1 font-semibold">
          <Bot size={15} /> LLM utterance coding
        </span>
        <span className="text-slate-400">· EF · affect · motivation · learning strategies</span>
        <button
          onClick={exportCsv}
          disabled={utterances.length === 0}
          className="ml-auto inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
          title="Export the coded utterances (all users, all sessions) as one CSV"
        >
          <Download size={13} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-3">
        {/* learner selector */}
        <div className="max-h-[82vh] overflow-auto rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
            <span>Learners ({selected.size})</span>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="hover:text-slate-700">
                clear
              </button>
            )}
          </div>
          {users.map((u) => (
            <label
              key={u.userId}
              className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(u.userId)}
                onChange={() => toggle(u.userId)}
              />
              <span className="flex-1 truncate">{u.displayName ?? u.userId.slice(0, 8)}</span>
              <span className="text-xs text-slate-400">{u.sessions}</span>
            </label>
          ))}
          {users.length === 0 && (
            <div className="p-3 text-center text-xs text-slate-400">No users</div>
          )}
        </div>

        <div className="space-y-3">
          {/* provider / model / key */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">Provider</span>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="rounded border border-slate-300 px-2 py-1"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">Model</span>
                <input
                  list="llm-models"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-52 rounded border border-slate-300 px-2 py-1"
                  placeholder="model id"
                />
                <datalist id="llm-models">
                  {MODELS[provider].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  {provider === 'openai' ? 'OpenAI' : 'Gemini'} API key
                </span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1"
                  placeholder="sk-… (kept only in this browser)"
                  autoComplete="off"
                />
              </label>
              <button
                onClick={run}
                disabled={running}
                className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50"
              >
                <Play size={14} /> {running ? 'Coding…' : 'Run coding'}
              </button>
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Pick the state-of-the-art model for the provider (typeable — enter any model id the
              provider serves). The key is stored only in this browser (localStorage) and sent
              directly to the studio server for the call.
            </div>
          </div>

          {/* editable prompt */}
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPrompt((v) => !v)}
                className="inline-flex items-center gap-1 font-semibold text-slate-600"
              >
                {showPrompt ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Prompt (editable)
              </button>
              <span className="text-[11px] text-slate-400">
                the exact prompt sent to the LLM — edit the template &amp; each dimension&apos;s
                definition
              </span>
              {showPrompt && (
                <button
                  onClick={resetPrompt}
                  className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                >
                  reset to default
                </button>
              )}
            </div>
            {showPrompt && (
              <div className="mt-2 space-y-3">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
                    Template — placeholders:{' '}
                    <code>
                      {
                        '{{SOURCE}} {{DEFINITIONS}} {{DIMENSION_KEYS}} {{UTTERANCE}} {{SELECTED_TEXT}}'
                      }
                    </code>
                  </div>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    rows={9}
                    spellCheck={false}
                    className="w-full rounded border border-slate-300 p-2 font-mono text-[11px]"
                  />
                </div>
                {DIM_GROUPS.map((g) => {
                  const dims = dimensions.filter((d) => d.startsWith(g.prefix));
                  if (!dims.length) return null;
                  return (
                    <div key={g.prefix}>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {g.label}
                      </div>
                      <div className="space-y-1">
                        {dims.map((d) => (
                          <div key={d} className="flex items-start gap-2">
                            <span className="mt-1 w-52 shrink-0 truncate font-mono text-[11px] text-slate-500">
                              {d}
                            </span>
                            <input
                              value={defs[d] ?? ''}
                              onChange={(e) => setDefs((m) => ({ ...m, [d]: e.target.value }))}
                              className="flex-1 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="text-[11px] text-slate-400">
                  Every dimension is coded 1 (present) / 0 (absent) in one JSON call per utterance;
                  edits apply to the next run and are remembered in this browser.
                </div>
              </div>
            )}
          </div>

          {/* status / progress */}
          {(running || status || error) && (
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
              {error && (
                <div className="mb-1 flex items-center gap-1 text-rose-600">
                  <TriangleAlert size={13} /> {error}
                </div>
              )}
              {status && <div className="text-slate-600">{status}</div>}
              {progress.total > 0 && (
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-2 rounded bg-emerald-500 transition-all"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* results preview */}
          {utterances.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
              <div className="mb-2 flex items-center gap-2 text-slate-500">
                <span className="font-semibold">
                  {utterances.length} utterances · {codedCount} coded
                </span>
                <span className="text-slate-400">
                  (columns: userId, sessionId, utterance, selectedText, source, {dimensions.length}{' '}
                  dimensions, rationale)
                </span>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 bg-white text-left text-[10px] text-slate-400">
                    <tr>
                      <th className="px-1 py-0.5">user</th>
                      <th className="px-1 py-0.5">source</th>
                      <th className="px-1 py-0.5">utterance</th>
                      <th className="px-1 py-0.5">EF</th>
                      <th className="px-1 py-0.5">affect</th>
                      <th className="px-1 py-0.5">motivation</th>
                      <th className="px-1 py-0.5">strategies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {utterances.slice(0, 300).map((u) => {
                      const c = codings[u.id]?.coding as Record<string, number> | undefined;
                      const on = (prefix: string) =>
                        c
                          ? Object.entries(c)
                              .filter(([k, v]) => k.startsWith(prefix) && v === 1)
                              .map(([k]) => k.slice(prefix.length))
                              .join(', ')
                          : '';
                      return (
                        <tr key={u.id} className="border-t border-slate-100 align-top">
                          <td className="px-1 py-0.5 text-slate-500">{u.user}</td>
                          <td className="px-1 py-0.5">
                            <span
                              className={`rounded px-1 ${u.source === 'free_chat' ? 'bg-sky-50 text-sky-700' : 'bg-teal-50 text-teal-700'}`}
                            >
                              {u.source === 'free_chat' ? 'chat' : 'elab'}
                            </span>
                          </td>
                          <td className="max-w-[280px] truncate px-1 py-0.5" title={u.utterance}>
                            {u.utterance}
                          </td>
                          <td className="px-1 py-0.5 text-indigo-700">{on('ef_')}</td>
                          <td className="px-1 py-0.5 text-amber-700">{on('affect_')}</td>
                          <td className="px-1 py-0.5 text-emerald-700">{on('mot_')}</td>
                          <td className="px-1 py-0.5 text-violet-700">{on('strategy_')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDuration, type ImportReport, type SessionListItem } from '../lib/api';

export function Library() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [webcamOnly, setWebcamOnly] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const codingFileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const { sessions } = await api.sessions();
      setSessions(sessions);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function importByPath() {
    if (!pathInput.trim()) return;
    setImporting(true);
    setReport(null);
    try {
      const r = await api.importPath(pathInput.trim());
      setReport(r);
      await refresh();
    } finally {
      setImporting(false);
    }
  }

  async function importZip(file: File) {
    setImporting(true);
    setReport(null);
    try {
      const r = await api.importZip(file);
      setReport(r);
      await refresh();
    } finally {
      setImporting(false);
    }
  }

  async function del(s: SessionListItem) {
    const alsoCoding = window.confirm(
      `Delete session ${s.userDisplayName ?? s.userId}?\n\nOK = also delete its coding (annotations).\nCancel-then-keep = keep coding.\n\nPress OK to ALSO delete coding, Cancel to keep coding.`,
    );
    await api.deleteSession(s.id, alsoCoding);
    await refresh();
  }

  const courses = useMemo(
    () => [...new Set(sessions.map((s) => s.courseTitle ?? s.courseId))].sort(),
    [sessions],
  );
  const filtered = sessions.filter(
    (s) =>
      (!courseFilter || (s.courseTitle ?? s.courseId) === courseFilter) &&
      (!webcamOnly || s.hasWebcam),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Import bundle
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="/absolute/path/to/session_<id>  (folder or .zip)"
            className="min-w-[360px] flex-1 rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={importByPath}
            disabled={importing}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import path'}
          </button>
          <span className="text-slate-400">or</span>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            Upload .zip…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importZip(e.target.files[0])}
          />
        </div>
        {report && (
          <div
            className={`mt-3 rounded border p-3 text-sm ${report.ok ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}
          >
            <div className="font-semibold">
              {report.ok ? `✓ Imported ${report.sessionId}` : '✗ Import failed'}
            </div>
            {report.ok && (
              <div className="text-slate-600">
                {report.windows} windows · {Object.entries(report.inserted).map(([k, v]) => `${k}:${v}`).join('  ')}
              </div>
            )}
            {report.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-rose-700">
                {report.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            {report.warnings.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-amber-700">
                {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Imported sessions ({filtered.length})
          </h2>
          <div className="flex items-center gap-3 text-sm">
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">All courses</option>
              {courses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={webcamOnly} onChange={(e) => setWebcamOnly(e.target.checked)} />
              webcam only
            </label>
            <button onClick={refresh} className="rounded border border-slate-300 px-2 py-1">
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No sessions yet. Import a bundle produced by <code>gals-export</code>.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Student</th>
                <th className="px-4 py-2">Course</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Streams</th>
                <th className="px-4 py-2">Coding</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">{s.userDisplayName ?? s.userId.slice(0, 8)}</td>
                  <td className="px-4 py-2">{s.courseTitle ?? s.courseId.slice(0, 8)}</td>
                  <td className="px-4 py-2 text-slate-500">{new Date(s.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{fmtDuration(s.durationMs)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    <span title="snapshots">📸 {s.counts.snapshots}</span>{' '}
                    <span title="gaze">👁 {s.counts.gaze}</span>{' '}
                    <span title="emotion">😀 {s.counts.emotion}</span>{' '}
                    <span title="webcam">🎥 {s.counts.webcamSegments}</span>{' '}
                    <span title="messages">💬 {s.counts.messages}</span>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <ProgressPill label="R1" pct={s.coding.pctRater1} />
                      <ProgressPill label="R2" pct={s.coding.pctRater2} />
                      {s.coding.disagreementsPending > 0 && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                          {s.coding.disagreementsPending} ⚔
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400">{s.coding.windows} windows</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <Link to={`/replay/${s.id}`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
                        Replay
                      </Link>
                      <Link to={`/coding/${s.id}`} className="rounded bg-slate-900 px-2 py-1 text-white hover:bg-slate-700">
                        Code
                      </Link>
                      <button onClick={() => del(s)} className="rounded border border-rose-300 px-2 py-1 text-rose-600 hover:bg-rose-50">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Backup coding (durability)</h2>
        <p className="mb-3 text-xs text-slate-500">
          Coding labels are the most valuable artifact. Export them independently of media; restore on any machine.
        </p>
        <div className="flex items-center gap-2">
          <a href={api.exportCodingUrl} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">Export all coding (.zip)</a>
          <button onClick={() => codingFileRef.current?.click()} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Import coding…</button>
          <input ref={codingFileRef} type="file" accept=".zip" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = await api.importCoding(f);
              alert(`Restored: ${JSON.stringify(r.restored ?? r)}`);
              await refresh();
            }} />
        </div>
      </section>
    </div>
  );
}

function ProgressPill({ label, pct }: { label: string; pct: number }) {
  const p = Math.round(pct * 100);
  const color = p >= 100 ? 'bg-emerald-100 text-emerald-700' : p > 0 ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500';
  return <span className={`rounded px-1.5 py-0.5 ${color}`}>{label} {p}%</span>;
}

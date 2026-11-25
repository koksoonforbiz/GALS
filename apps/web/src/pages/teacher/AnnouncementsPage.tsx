/**
 * Post notices to students (2026-11-26): scheduled maintenance (with the
 * window), things to do, security or data incidents, general information.
 * Teachers post to their own courses; admins can also post to every
 * student. Students see them at the top of every page; a notice that needs
 * acknowledgement (security incidents always do) blocks until confirmed.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Kind = 'maintenance' | 'action_required' | 'security_incident' | 'info';
type Severity = 'info' | 'warning' | 'critical';

interface Row {
  id: string;
  kind: Kind;
  severity: Severity;
  title: string;
  body: string;
  courseId: string | null;
  startsAt: string;
  endsAt: string | null;
  maintenanceStart: string | null;
  maintenanceEnd: string | null;
  requireAck: boolean;
  archivedAt: string | null;
  acks: number;
}

interface Course {
  id: string;
  title: string;
}

const KINDS: Array<[Kind, string]> = [
  ['maintenance', 'Scheduled maintenance'],
  ['action_required', 'Action needed'],
  ['security_incident', 'Security or data incident'],
  ['info', 'General notice'],
];

/** <input type="datetime-local"> value (local time) to ISO, or null. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

export function AnnouncementsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    kind: 'maintenance' as Kind,
    severity: 'warning' as Severity,
    title: '',
    body: '',
    courseId: '',
    startsAt: '',
    endsAt: '',
    maintenanceStart: '',
    maintenanceEnd: '',
    requireAck: false,
  });

  const load = () => {
    api
      .get<Row[]>('/announcements')
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    load();
    api
      .get<Course[]>('/courses')
      .then((cs) => setCourses(cs.map((c) => ({ id: c.id, title: c.title }))))
      .catch(() => setCourses([]));
  }, []);

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post('/announcements', {
        kind: form.kind,
        severity: form.severity,
        title: form.title,
        body: form.body,
        courseId: form.courseId || null,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        maintenanceStart: form.kind === 'maintenance' ? toIso(form.maintenanceStart) : null,
        maintenanceEnd: form.kind === 'maintenance' ? toIso(form.maintenanceEnd) : null,
        requireAck: form.requireAck,
      });
      setForm((f) => ({ ...f, title: '', body: '' }));
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const archive = async (id: string) => {
    await api.delete(`/announcements/${id}`);
    load();
  };

  const fmt = (v: string | null) =>
    v ? new Date(v).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }) : '';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Announcements to students</h1>
      <form
        onSubmit={submit}
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 text-sm"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-gray-600">Type</span>
            <select
              className="mt-1 w-full rounded border border-gray-300 p-1.5"
              value={form.kind}
              onChange={(e) => set('kind', e.target.value)}
            >
              {KINDS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-gray-600">Importance</span>
            <select
              className="mt-1 w-full rounded border border-gray-300 p-1.5"
              value={form.kind === 'security_incident' ? 'critical' : form.severity}
              disabled={form.kind === 'security_incident'}
              onChange={(e) => set('severity', e.target.value)}
            >
              <option value="info">Information</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="block">
            <span className="text-gray-600">Who sees it</span>
            <select
              className="mt-1 w-full rounded border border-gray-300 p-1.5"
              value={form.courseId}
              onChange={(e) => set('courseId', e.target.value)}
            >
              <option value="">Every student (admins only)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-gray-600">Title</span>
          <input
            className="mt-1 w-full rounded border border-gray-300 p-1.5"
            value={form.title}
            maxLength={200}
            required
            onChange={(e) => set('title', e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-gray-600">Message (what happens, what students should do)</span>
          <textarea
            className="mt-1 h-28 w-full rounded border border-gray-300 p-1.5"
            value={form.body}
            maxLength={5000}
            required
            onChange={(e) => set('body', e.target.value)}
          />
        </label>
        {form.kind === 'maintenance' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-gray-600">Maintenance starts</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-gray-300 p-1.5"
                value={form.maintenanceStart}
                onChange={(e) => set('maintenanceStart', e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-gray-600">Maintenance ends</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border border-gray-300 p-1.5"
                value={form.maintenanceEnd}
                onChange={(e) => set('maintenanceEnd', e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-gray-600">Show from (empty: now)</span>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded border border-gray-300 p-1.5"
              value={form.startsAt}
              onChange={(e) => set('startsAt', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-gray-600">Hide after (empty: until archived)</span>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded border border-gray-300 p-1.5"
              value={form.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
            />
          </label>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.kind === 'security_incident' || form.requireAck}
            disabled={form.kind === 'security_incident'}
            onChange={(e) => set('requireAck', e.target.checked)}
          />
          <span className="text-gray-700">
            Students must confirm they have read it before they continue
            {form.kind === 'security_incident' ? ' (always for security notices)' : ''}
          </span>
        </label>
        {error && <p className="text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-1.5 text-white disabled:opacity-50"
        >
          {saving ? 'Posting...' : 'Post announcement'}
        </button>
      </form>

      <div className="rounded-lg border border-gray-200 bg-white text-sm">
        <table className="w-full">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="p-2">Notice</th>
              <th className="p-2">Shown</th>
              <th className="p-2">Read</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 align-top">
                <td className="p-2">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-gray-500">
                    {KINDS.find(([k]) => k === r.kind)?.[1]} · {r.severity}
                    {r.courseId ? '' : ' · every student'}
                    {r.maintenanceStart ? ` · maintenance ${fmt(r.maintenanceStart)}` : ''}
                  </div>
                </td>
                <td className="p-2 text-xs text-gray-600">
                  {r.archivedAt
                    ? 'archived'
                    : `${fmt(r.startsAt)}${r.endsAt ? ` to ${fmt(r.endsAt)}` : ''}`}
                </td>
                <td className="p-2 text-xs">{r.acks}</td>
                <td className="p-2 text-right">
                  {!r.archivedAt && (
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => void archive(r.id)}
                    >
                      Archive
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-gray-400" colSpan={4}>
                  No announcements yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

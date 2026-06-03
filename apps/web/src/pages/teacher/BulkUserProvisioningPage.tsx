// Teacher bulk user provisioning + quick enrollment (prompt 02).
//
// Spreadsheet-style editable grid: paste straight from Excel/Sheets,
// per-row inline validation, optional course enrollment in one shot.
// Posts to /user-management/users/bulk-provision and renders per-row
// results in the same grid (green = created, gray = skipped, red =
// error). Never stores or displays passwords beyond the row that the
// teacher just typed — backend never echoes them.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../components/Toast';

// ─── Types ──────────────────────────────────────────────

type RowRole = 'student' | 'teacher' | 'admin';

interface GridRow {
  // Stable client id so React doesn't reorder rows on splice. Not sent
  // to the backend — `rowIndex` in the response is the array index.
  clientId: string;
  email: string;
  loginId: string;
  password: string;
  name: string;
  role: RowRole;
  // Result echoed back from the server after submit.
  result?: BulkProvisionUserResult;
}

interface BulkProvisionUserResult {
  rowIndex: number;
  email: string;
  loginId: string;
  status: 'created' | 'skipped' | 'error';
  userId?: string;
  message?: string;
  enrollment?: {
    status: 'enrolled' | 'already_enrolled' | 'reactivated' | 'error' | 'skipped';
    message?: string;
  };
}

interface BulkProvisionResponse {
  results: BulkProvisionUserResult[];
  summary: {
    created: number;
    skipped: number;
    errored: number;
    enrolled?: number;
  };
}

interface TeacherCourse {
  id: string;
  title: string;
}

// ─── Helpers ────────────────────────────────────────────

// Loose email check for inline validation. The backend re-validates
// with Zod's strict z.string().email() so a malformed value can't
// sneak through.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGIN_ID_RE = /^[A-Za-z0-9._-]+$/;

function newClientId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function blankRow(): GridRow {
  return {
    clientId: newClientId(),
    email: '',
    loginId: '',
    password: '',
    name: '',
    role: 'student',
  };
}

function isRowBlank(r: GridRow): boolean {
  return !r.email.trim() && !r.loginId.trim() && !r.password.trim() && !r.name.trim();
}

function validateRow(r: GridRow): { ok: boolean; errors: Partial<Record<keyof GridRow, string>> } {
  const errors: Partial<Record<keyof GridRow, string>> = {};
  if (!EMAIL_RE.test(r.email.trim())) errors.email = 'Invalid email';
  const lid = r.loginId.trim();
  if (lid.length < 3) errors.loginId = 'Min 3 chars';
  else if (lid.length > 64) errors.loginId = 'Max 64 chars';
  else if (!LOGIN_ID_RE.test(lid)) errors.loginId = 'Only letters/digits/._-';
  if (r.password.length < 8) errors.password = 'Min 8 chars';
  return { ok: Object.keys(errors).length === 0, errors };
}

// Excel/Sheets clipboard format: lines separated by \r?\n, cells by tab.
// Optionally trims surrounding quotes (Sheets quote-wraps cells that
// contain commas). Returns rows × cells.
function parseClipboardGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Drop trailing empty line (typical from "Copy" with a final \n).
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => {
    const cells = line.split('\t');
    return cells.map((c) => c.replace(/^"(.*)"$/, '$1'));
  });
}

// Column order in the grid; pasting into any cell distributes the
// pasted block starting from that column.
const COLUMNS: Array<keyof Pick<GridRow, 'email' | 'loginId' | 'password' | 'name' | 'role'>> = [
  'email',
  'loginId',
  'password',
  'name',
  'role',
];

function isValidRoleString(s: string): s is RowRole {
  return s === 'student' || s === 'teacher' || s === 'admin';
}

// ─── Main page ──────────────────────────────────────────

export function BulkUserProvisioningPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<GridRow[]>(() => [blankRow(), blankRow(), blankRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<BulkProvisionResponse['summary'] | null>(null);

  // Course picker for quick enrollment. Empty string = "do not enroll".
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [enrollCourseId, setEnrollCourseId] = useState<string>('');

  useEffect(() => {
    api
      .get<TeacherCourse[]>('/courses')
      .then(setCourses)
      .catch(() => {
        // Non-fatal — teacher can still create users without enrolling.
      });
  }, []);

  // ─ Row helpers ─

  const updateRow = useCallback((clientId: string, patch: Partial<GridRow>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.clientId === clientId ? { ...r, ...patch, result: undefined } : r,
      ),
    );
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, blankRow()]);
  }, []);

  const addRows = useCallback((n: number) => {
    setRows((prev) => [...prev, ...Array.from({ length: n }, () => blankRow())]);
  }, []);

  const duplicateRow = useCallback((clientId: string) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.clientId === clientId);
      if (idx < 0) return prev;
      const src = prev[idx]!;
      const copy: GridRow = {
        ...src,
        clientId: newClientId(),
        result: undefined,
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }, []);

  const removeRow = useCallback((clientId: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.clientId !== clientId);
      // Always keep at least one editable row visible so the grid
      // doesn't collapse to nothing.
      return next.length > 0 ? next : [blankRow()];
    });
  }, []);

  const clearAll = useCallback(() => {
    setRows([blankRow(), blankRow(), blankRow()]);
    setSummary(null);
  }, []);

  // ─ Paste-from-spreadsheet handler ─

  const handleCellPaste = useCallback(
    (
      e: React.ClipboardEvent<HTMLInputElement | HTMLSelectElement>,
      rowClientId: string,
      colKey: (typeof COLUMNS)[number],
    ) => {
      const text = e.clipboardData.getData('text/plain');
      // Single-cell paste: let the default input behavior win.
      if (!text.includes('\t') && !text.includes('\n')) return;

      e.preventDefault();
      const block = parseClipboardGrid(text);
      if (block.length === 0) return;

      const startCol = COLUMNS.indexOf(colKey);
      if (startCol < 0) return;

      setRows((prev) => {
        const startIdx = prev.findIndex((r) => r.clientId === rowClientId);
        if (startIdx < 0) return prev;
        const next = prev.slice();

        for (let i = 0; i < block.length; i++) {
          const rowIdx = startIdx + i;
          // Auto-expand the grid when the paste runs past the end.
          while (rowIdx >= next.length) next.push(blankRow());

          const cells = block[i]!;
          const target = next[rowIdx]!;
          const patch: Partial<GridRow> = { result: undefined };

          for (let c = 0; c < cells.length; c++) {
            const destColIdx = startCol + c;
            if (destColIdx >= COLUMNS.length) break;
            const colName = COLUMNS[destColIdx]!;
            const raw = (cells[c] ?? '').trim();
            if (colName === 'role') {
              patch.role = isValidRoleString(raw) ? raw : target.role;
            } else {
              patch[colName] = raw;
            }
          }
          next[rowIdx] = { ...target, ...patch };
        }
        return next;
      });
    },
    [],
  );

  // ─ Validation summary ─

  const validation = useMemo(() => {
    const nonBlank = rows.filter((r) => !isRowBlank(r));
    let validCount = 0;
    const perRow = rows.map((r) => {
      if (isRowBlank(r)) return { ok: true, errors: {} as Partial<Record<keyof GridRow, string>> };
      const v = validateRow(r);
      if (v.ok) validCount++;
      return v;
    });
    return { perRow, validCount, total: nonBlank.length };
  }, [rows]);

  const canSubmit = validation.validCount > 0 && validation.validCount === validation.total;

  // ─ Submit ─

  const handleSubmit = async () => {
    const payloadRows = rows
      .filter((r) => !isRowBlank(r))
      .map((r) => ({
        clientId: r.clientId,
        email: r.email.trim(),
        loginId: r.loginId.trim(),
        password: r.password,
        ...(r.name.trim() ? { name: r.name.trim() } : {}),
        role: r.role,
      }));

    if (payloadRows.length === 0) {
      toast('error', 'Add at least one row');
      return;
    }

    setSubmitting(true);
    setSummary(null);
    try {
      const body: {
        rows: Array<{ email: string; loginId: string; password: string; name?: string; role: RowRole }>;
        enrollCourseId?: string;
      } = {
        rows: payloadRows.map(({ clientId: _id, ...rest }) => rest),
      };
      if (enrollCourseId) body.enrollCourseId = enrollCourseId;

      const res = await api.post<BulkProvisionResponse>(
        '/user-management/users/bulk-provision',
        body,
      );

      // Map results back onto rows by index. We submitted only
      // non-blank rows in order, so the response's rowIndex maps to
      // payloadRows[rowIndex].clientId.
      setRows((prev) => {
        const byClient: Record<string, BulkProvisionUserResult> = {};
        for (const r of res.results) {
          const submitted = payloadRows[r.rowIndex];
          if (submitted) byClient[submitted.clientId] = r;
        }
        return prev.map((row) =>
          byClient[row.clientId] ? { ...row, result: byClient[row.clientId] } : row,
        );
      });
      setSummary(res.summary);

      const courseLabel =
        enrollCourseId && courses.find((c) => c.id === enrollCourseId)?.title;
      toast(
        res.summary.errored === 0 ? 'success' : 'error',
        `${res.summary.created} created, ${res.summary.skipped} skipped, ${res.summary.errored} errored` +
          (courseLabel ? ` · ${res.summary.enrolled ?? 0} enrolled in ${courseLabel}` : ''),
      );
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Bulk provisioning failed';
      toast('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ─ Render ─

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Bulk User Provisioning</h2>
        <p className="text-sm text-gray-600 mt-1">
          Paste rows from Excel or Google Sheets into the grid below. Each row creates one user
          with a teacher-assigned login id. Students can log in with either their email or login
          id. Passwords are hashed server-side and never echoed back.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <button
          onClick={addRow}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          type="button"
        >
          + Add row
        </button>
        <button
          onClick={() => addRows(10)}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          type="button"
        >
          + Add 10
        </button>
        <button
          onClick={clearAll}
          className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
          type="button"
        >
          Clear
        </button>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm text-gray-600">Enroll into:</label>
          <select
            value={enrollCourseId}
            onChange={(e) => setEnrollCourseId(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">— (do not enroll) —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status line */}
      <div className="text-xs text-gray-600 mb-2">
        {validation.total === 0 ? (
          <span>No rows entered yet. Tip: paste 3 columns (email, loginId, password) from a spreadsheet.</span>
        ) : (
          <span>
            {validation.validCount} of {validation.total} row{validation.total === 1 ? '' : 's'}{' '}
            valid
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              <th className="px-2 py-2 w-8">#</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Login ID</th>
              <th className="px-2 py-2">Password</th>
              <th className="px-2 py-2">Name (optional)</th>
              <th className="px-2 py-2 w-28">Role</th>
              <th className="px-2 py-2 w-40">Status</th>
              <th className="px-2 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, idx) => {
              const v = validation.perRow[idx]!;
              const blank = isRowBlank(row);
              const result = row.result;
              const rowBg = result
                ? result.status === 'created'
                  ? 'bg-green-50'
                  : result.status === 'skipped'
                    ? 'bg-gray-50'
                    : 'bg-red-50'
                : !blank && !v.ok
                  ? 'bg-yellow-50'
                  : '';
              return (
                <tr key={row.clientId} className={rowBg}>
                  <td className="px-2 py-1 text-xs text-gray-400 align-top">{idx + 1}</td>
                  <td className="px-2 py-1 align-top">
                    <input
                      type="email"
                      value={row.email}
                      onChange={(e) => updateRow(row.clientId, { email: e.target.value })}
                      onPaste={(e) => handleCellPaste(e, row.clientId, 'email')}
                      placeholder="student@example.com"
                      className={`w-full px-2 py-1 text-sm border rounded ${
                        v.errors.email ? 'border-red-300' : 'border-gray-200'
                      }`}
                    />
                    {v.errors.email && (
                      <p className="text-xs text-red-600 mt-0.5">{v.errors.email}</p>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top">
                    <input
                      type="text"
                      value={row.loginId}
                      onChange={(e) => updateRow(row.clientId, { loginId: e.target.value })}
                      onPaste={(e) => handleCellPaste(e, row.clientId, 'loginId')}
                      placeholder="jane.doe"
                      className={`w-full px-2 py-1 text-sm border rounded font-mono ${
                        v.errors.loginId ? 'border-red-300' : 'border-gray-200'
                      }`}
                    />
                    {v.errors.loginId && (
                      <p className="text-xs text-red-600 mt-0.5">{v.errors.loginId}</p>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top">
                    <input
                      type="text"
                      value={row.password}
                      onChange={(e) => updateRow(row.clientId, { password: e.target.value })}
                      onPaste={(e) => handleCellPaste(e, row.clientId, 'password')}
                      placeholder="min 8 chars"
                      className={`w-full px-2 py-1 text-sm border rounded font-mono ${
                        v.errors.password ? 'border-red-300' : 'border-gray-200'
                      }`}
                    />
                    {v.errors.password && (
                      <p className="text-xs text-red-600 mt-0.5">{v.errors.password}</p>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(row.clientId, { name: e.target.value })}
                      onPaste={(e) => handleCellPaste(e, row.clientId, 'name')}
                      placeholder="(defaults to loginId)"
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded"
                    />
                  </td>
                  <td className="px-2 py-1 align-top">
                    <select
                      value={row.role}
                      onChange={(e) =>
                        updateRow(row.clientId, { role: e.target.value as RowRole })
                      }
                      onPaste={(e) => handleCellPaste(e, row.clientId, 'role')}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded"
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 align-top">
                    {result ? (
                      <div className="text-xs">
                        <span
                          className={
                            result.status === 'created'
                              ? 'text-green-700 font-medium'
                              : result.status === 'skipped'
                                ? 'text-gray-700 font-medium'
                                : 'text-red-700 font-medium'
                          }
                        >
                          {result.status}
                        </span>
                        {result.message && (
                          <p className="text-gray-600">{result.message}</p>
                        )}
                        {result.enrollment && (
                          <p
                            className={
                              result.enrollment.status === 'enrolled' ||
                              result.enrollment.status === 'reactivated'
                                ? 'text-green-700'
                                : result.enrollment.status === 'already_enrolled'
                                  ? 'text-gray-700'
                                  : 'text-red-700'
                            }
                          >
                            enroll: {result.enrollment.status}
                            {result.enrollment.message ? ` (${result.enrollment.message})` : ''}
                          </p>
                        )}
                      </div>
                    ) : blank ? (
                      <span className="text-xs text-gray-400">empty</span>
                    ) : v.ok ? (
                      <span className="text-xs text-blue-600">ready</span>
                    ) : (
                      <span className="text-xs text-yellow-700">fix above</span>
                    )}
                  </td>
                  <td className="px-2 py-1 align-top text-right whitespace-nowrap">
                    <button
                      onClick={() => duplicateRow(row.clientId)}
                      className="text-xs text-blue-600 hover:underline mr-2"
                      type="button"
                    >
                      dup
                    </button>
                    <button
                      onClick={() => removeRow(row.clientId)}
                      className="text-xs text-red-600 hover:underline"
                      type="button"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary + submit */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {summary && (
            <span>
              <span className="text-green-700 font-medium">{summary.created} created</span>
              {' · '}
              <span className="text-gray-700 font-medium">{summary.skipped} skipped</span>
              {' · '}
              <span className="text-red-700 font-medium">{summary.errored} errored</span>
              {typeof summary.enrolled === 'number' && (
                <>
                  {' · '}
                  <span className="text-blue-700 font-medium">{summary.enrolled} enrolled</span>
                </>
              )}
            </span>
          )}
        </div>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          type="button"
        >
          {submitting
            ? 'Provisioning…'
            : enrollCourseId
              ? `Create ${validation.validCount} user${validation.validCount === 1 ? '' : 's'} & enroll`
              : `Create ${validation.validCount} user${validation.validCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

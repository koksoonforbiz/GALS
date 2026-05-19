import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { InfoTooltip } from './InfoTooltip';

// ─── Types ──────────────────────────────────────────────

type GateCheckStatus = 'pass' | 'fail' | 'warn';

interface GateCheckDetail {
  id: string;
  label: string;
  description: string;
  status: GateCheckStatus;
  details: string[];
  relatedIds?: string[];
}

interface PublishGateOutput {
  overallPass: boolean;
  checks: GateCheckDetail[];
  meta: {
    courseId: string;
    checkedAt: string;
    approvedKcCount: number;
    edgeCount: number;
    mappingCount: number;
    pageCount: number;
    latestEvalRunId: string | null;
  };
}

interface AuditEntry {
  id: string;
  courseId: string;
  userId: string;
  checks: GateCheckDetail[];
  overallPass: boolean;
  overridden: boolean;
  overrideReason: string | null;
  published: boolean;
  createdAt: string;
}

interface PublishResult {
  published: boolean;
  overridden?: boolean;
  reason?: string;
  checks: GateCheckDetail[];
}

// ─── Helpers ─────────────────────────────────────────────

const STATUS_CONFIG: Record<GateCheckStatus, { icon: string; bg: string; text: string; border: string }> = {
  pass: { icon: 'PASS', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  warn: { icon: 'WARN', bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
  fail: { icon: 'FAIL', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
};

// ─── Component ───────────────────────────────────────────

interface Props {
  courseId: string;
}

export default function PublishGatePanel({ courseId }: Props) {
  const [view, setView] = useState<'checklist' | 'audit'>('checklist');
  const [gateResult, setGateResult] = useState<PublishGateOutput | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // Override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // ─── Fetch Checks ─────────────────────────────────────

  const runChecks = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPublishResult(null);
    try {
      const result = await apiFetch<PublishGateOutput>(
        `/courses/${courseId}/publish-gate/check`,
        { method: 'POST' },
      );
      setGateResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run publish checks');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  const fetchAudit = useCallback(async () => {
    try {
      const entries = await apiFetch<AuditEntry[]>(
        `/courses/${courseId}/publish-gate/audit`,
      );
      setAuditHistory(entries);
    } catch {
      // silently fail
    }
  }, [courseId]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  useEffect(() => {
    if (view === 'audit') fetchAudit();
  }, [view, fetchAudit]);

  // ─── Publish Actions ──────────────────────────────────

  const handlePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const result = await apiFetch<PublishResult>(
        `/courses/${courseId}/publish-gate/publish`,
        { method: 'POST' },
      );
      setPublishResult(result);
      if (result.published) {
        setGateResult((prev) => prev ? { ...prev, checks: result.checks } : prev);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleOverridePublish = async () => {
    if (overrideReason.trim().length < 10) return;
    setPublishing(true);
    setError(null);
    try {
      const result = await apiFetch<PublishResult>(
        `/courses/${courseId}/publish-gate/publish-override`,
        {
          method: 'POST',
          body: JSON.stringify({ overrideReason: overrideReason.trim() }),
        },
      );
      setPublishResult(result);
      setShowOverrideModal(false);
      setOverrideReason('');
      if (result.published) {
        setGateResult((prev) => prev ? { ...prev, checks: result.checks } : prev);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Override publish failed');
    } finally {
      setPublishing(false);
    }
  };

  // ─── Render ───────────────────────────────────────────

  const failCount = gateResult?.checks.filter((c) => c.status === 'fail').length ?? 0;
  const warnCount = gateResult?.checks.filter((c) => c.status === 'warn').length ?? 0;
  const passCount = gateResult?.checks.filter((c) => c.status === 'pass').length ?? 0;

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Publish Gate</h3>
          <p className="text-sm text-gray-500">
            Run pre-publish checks to ensure course structural integrity before publishing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('checklist')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              view === 'checklist'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Checklist
          </button>
          <button
            onClick={() => setView('audit')}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              view === 'audit'
                ? 'bg-blue-100 text-blue-700 font-medium'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Audit Trail
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Publish result banner */}
      {publishResult && (
        <div
          className={`mb-4 p-3 rounded-lg border text-sm ${
            publishResult.published
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {publishResult.published ? (
            <span className="font-medium">
              Course published successfully
              {publishResult.overridden ? ' (with override)' : ''}.
            </span>
          ) : (
            <span className="font-medium">{publishResult.reason}</span>
          )}
        </div>
      )}

      {/* ─── Checklist View ─── */}
      {view === 'checklist' && (
        <>
          {/* Summary bar */}
          {gateResult && (
            <div className="mb-4 flex items-center gap-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
                    gateResult.overallPass
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {gateResult.overallPass ? 'READY' : 'NOT READY'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {passCount > 0 && <span className="text-green-600">{passCount} passed</span>}
                {warnCount > 0 && <span className="text-yellow-600">{warnCount} warning(s)</span>}
                {failCount > 0 && <span className="text-red-600">{failCount} failed</span>}
              </div>
              <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
                <span>{gateResult.meta.approvedKcCount} KCs</span>
                <span>{gateResult.meta.edgeCount} edges</span>
                <span>{gateResult.meta.mappingCount} mappings</span>
                <span>{gateResult.meta.pageCount} pages</span>
              </div>
            </div>
          )}

          {/* Checks list */}
          {loading ? (
            <div className="text-gray-400 py-8 text-center">Running publish gate checks...</div>
          ) : gateResult ? (
            <div className="space-y-3 mb-6">
              {gateResult.checks.map((check) => {
                const cfg = STATUS_CONFIG[check.status];
                return (
                  <div
                    key={check.id}
                    className={`${cfg.bg} border ${cfg.border} rounded-lg p-4`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-xs font-bold px-1.5 py-0.5 rounded ${cfg.text} ${
                              check.status === 'pass'
                                ? 'bg-green-100'
                                : check.status === 'warn'
                                  ? 'bg-yellow-100'
                                  : 'bg-red-100'
                            }`}
                          >
                            {cfg.icon}
                          </span>
                          <span className="text-sm font-semibold text-gray-900">
                            {check.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">{check.description}</p>
                        {check.details.length > 0 && (
                          <ul className="space-y-0.5">
                            {check.details.map((d, i) => (
                              <li key={i} className={`text-xs ${cfg.text}`}>
                                {d}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
            <button
              onClick={runChecks}
              disabled={loading}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              {loading ? 'Checking...' : <>Re-run Checks<span className="ml-1 inline-flex"><InfoTooltip text="Re-execute all structural validation checks against the current course state." /></span></>}
            </button>

            {gateResult?.overallPass && (
              <button
                onClick={handlePublish}
                disabled={publishing || (publishResult?.published ?? false)}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : <>Publish Course<span className="ml-1 inline-flex"><InfoTooltip text="Publish this course to learners. All gate checks must pass first." /></span></>}
              </button>
            )}

            {gateResult && !gateResult.overallPass && (
              <>
                <button
                  className="px-4 py-2 text-sm bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed"
                  title="Fix all failing checks to publish"
                  disabled
                >
                  Publish (blocked)<span className="ml-1 inline-flex"><InfoTooltip text="Publishing is blocked because one or more checks failed. Fix the issues or use Override." warn={true} /></span>
                </button>
                <button
                  onClick={() => setShowOverrideModal(true)}
                  disabled={publishing}
                  className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  Override & Publish<span className="ml-1 inline-flex"><InfoTooltip text="Publish despite failing checks. Requires a written justification that is recorded in the audit trail." warn={true} /></span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ─── Audit Trail View ─── */}
      {view === 'audit' && (
        <div>
          {auditHistory.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              No publish gate runs yet.
            </div>
          ) : (
            <div className="space-y-3">
              {auditHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-white border border-gray-200 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          entry.overallPass
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {entry.overallPass ? 'PASS' : 'FAIL'}
                      </span>
                      {entry.published && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                          Published
                        </span>
                      )}
                      {entry.overridden && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                          Overridden
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {entry.overrideReason && (
                    <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                      <span className="font-medium">Override reason:</span> {entry.overrideReason}
                    </div>
                  )}

                  {/* Compact check summary */}
                  <div className="flex flex-wrap gap-2">
                    {(entry.checks as GateCheckDetail[]).map((check) => {
                      const cfg = STATUS_CONFIG[check.status];
                      return (
                        <span
                          key={check.id}
                          className={`text-xs px-2 py-0.5 rounded ${cfg.bg} ${cfg.text} border ${cfg.border}`}
                          title={check.details.join('\n')}
                        >
                          {check.label}: {check.status.toUpperCase()}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Override Modal ─── */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-2">
              Override Publish Gate
            </h4>
            <p className="text-sm text-gray-500 mb-4">
              One or more publish checks failed. Provide a justification to override and publish anyway.
              This will be recorded in the audit trail.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Override Reason (min 10 characters)
              </label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
                rows={3}
                placeholder="Explain why it's safe to publish despite failing checks..."
              />
              <p className="text-xs text-gray-400 mt-1">
                {overrideReason.trim().length}/10 characters minimum
              </p>
            </div>

            {/* Show failing checks */}
            {gateResult && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs font-medium text-red-700 mb-1">Failing checks:</p>
                <ul className="space-y-0.5">
                  {gateResult.checks
                    .filter((c) => c.status === 'fail')
                    .map((c) => (
                      <li key={c.id} className="text-xs text-red-600">
                        {c.label}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowOverrideModal(false);
                  setOverrideReason('');
                }}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleOverridePublish}
                disabled={publishing || overrideReason.trim().length < 10}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {publishing ? 'Publishing...' : <>Override & Publish<span className="ml-1 inline-flex"><InfoTooltip text="Confirm override publish. Your justification will be permanently recorded." warn={true} /></span></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

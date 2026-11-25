/**
 * Announcements to students (2026-11-26): scheduled maintenance, things to
 * do, security or data incidents, general information. Shown at the top of
 * every page while active. A notice that needs acknowledgement (security
 * incidents always do) blocks the page until the student confirms they
 * read it. Views and acknowledgements are logged (ANNOUNCEMENT_VIEWED /
 * ANNOUNCEMENT_ACKNOWLEDGED) so analysis can explain gaps around downtime.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useActivityLog } from '../../lib/activity-log';

interface Announcement {
  id: string;
  kind: 'maintenance' | 'action_required' | 'security_incident' | 'info';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  maintenanceStart: string | null;
  maintenanceEnd: string | null;
  requireAck: boolean;
  acknowledgedAt: string | null;
}

const KIND_LABEL: Record<Announcement['kind'], string> = {
  maintenance: 'Scheduled maintenance',
  action_required: 'Action needed',
  security_incident: 'Security notice',
  info: 'Notice',
};

const TONE: Record<Announcement['severity'], string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  critical: 'border-red-300 bg-red-50 text-red-900',
};

const REFRESH_MS = 5 * 60_000;
const HIDDEN_KEY = 'gals.announcements.hidden';

/** "Sat 29 Nov, 10:00 pm to Sun 30 Nov, 2:00 am (Singapore time)" */
function window_(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const f = new Intl.DateTimeFormat('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });
  const s = f.format(new Date(start));
  return end ? `${s} to ${f.format(new Date(end))} (Singapore time)` : `${s} (Singapore time)`;
}

export function AnnouncementBanner() {
  const { track } = useActivityLog();
  const [items, setItems] = useState<Announcement[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(HIDDEN_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const viewed = useRef(new Set<string>());

  const load = useCallback(() => {
    api
      .get<Announcement[]>('/announcements/active')
      .then(setItems)
      .catch(() => {
        // Offline or not a student: show nothing.
      });
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    for (const a of items) {
      if (viewed.current.has(a.id)) continue;
      viewed.current.add(a.id);
      track('ANNOUNCEMENT_VIEWED', { metadata: { announcementId: a.id, kind: a.kind } });
    }
  }, [items, track]);

  const acknowledge = async (a: Announcement) => {
    track('ANNOUNCEMENT_ACKNOWLEDGED', { metadata: { announcementId: a.id, kind: a.kind } });
    try {
      await api.post(`/announcements/${a.id}/ack`, {});
    } catch {
      // Logged in the activity stream anyway; retried on the next refresh.
    }
    setItems((xs) =>
      xs.map((x) => (x.id === a.id ? { ...x, acknowledgedAt: new Date().toISOString() } : x)),
    );
  };

  const hide = (id: string) => {
    const next = [...hidden, id];
    setHidden(next);
    try {
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const blocking = items.find((a) => a.requireAck && !a.acknowledgedAt);
  const banners = items.filter(
    (a) => !(a.requireAck && !a.acknowledgedAt) && !hidden.includes(a.id),
  );

  return (
    <>
      {banners.length > 0 && (
        <div className="fixed left-1/2 top-2 z-[110] flex w-[min(44rem,92vw)] -translate-x-1/2 flex-col gap-1.5">
          {banners.map((a) => (
            <div
              key={a.id}
              className={`rounded-lg border px-3 py-2 text-sm shadow ${TONE[a.severity]}`}
              role="status"
              data-testid="announcement-banner"
            >
              <button
                type="button"
                className="float-right ml-2 opacity-60 hover:opacity-100"
                aria-label="Hide"
                onClick={() => hide(a.id)}
              >
                ×
              </button>
              <span className="font-semibold">{KIND_LABEL[a.kind]}: </span>
              <span className="font-medium">{a.title}</span>
              {window_(a.maintenanceStart, a.maintenanceEnd) && (
                <div className="text-xs">When: {window_(a.maintenanceStart, a.maintenanceEnd)}</div>
              )}
              <div className="mt-0.5 whitespace-pre-line text-xs">{a.body}</div>
            </div>
          ))}
        </div>
      )}
      {blocking && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50">
          <div
            className={`w-[min(32rem,92vw)] rounded-lg border bg-white p-4 text-sm shadow-xl`}
            role="alertdialog"
            aria-label={KIND_LABEL[blocking.kind]}
            data-testid="announcement-blocking"
          >
            <div
              className={`mb-2 inline-block rounded px-2 py-0.5 text-xs font-semibold ${TONE[blocking.severity]}`}
            >
              {KIND_LABEL[blocking.kind]}
            </div>
            <p className="mb-1 text-base font-semibold text-gray-900">{blocking.title}</p>
            {window_(blocking.maintenanceStart, blocking.maintenanceEnd) && (
              <p className="mb-1 text-xs text-gray-700">
                When: {window_(blocking.maintenanceStart, blocking.maintenanceEnd)}
              </p>
            )}
            <p className="mb-3 whitespace-pre-line text-gray-800">{blocking.body}</p>
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded bg-blue-600 px-3 py-1.5 text-white"
                onClick={() => void acknowledge(blocking)}
              >
                I have read this
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * All timestamp display across the app renders in Singapore time (UTC+8),
 * regardless of the viewer's browser locale/timezone or where the data was
 * recorded. Storage stays UTC (ISO strings from the API) — only display
 * goes through here.
 */
const TIME_ZONE = 'Asia/Singapore';

function toDate(input: string | number | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

/** Low-level formatter — pass any Intl.DateTimeFormatOptions. */
export function formatSGT(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return toDate(input).toLocaleString('en-SG', { timeZone: TIME_ZONE, ...options });
}

/** e.g. "17 Jul 2026" */
export function formatDateSGT(input: string | number | Date): string {
  return formatSGT(input, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** e.g. "14:05" */
export function formatTimeSGT(input: string | number | Date): string {
  return formatSGT(input, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** e.g. "14:05:32" */
export function formatTimeSecSGT(input: string | number | Date): string {
  return formatSGT(input, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** e.g. "17 Jul 2026, 14:05" */
export function formatDateTimeSGT(input: string | number | Date): string {
  return formatSGT(input, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

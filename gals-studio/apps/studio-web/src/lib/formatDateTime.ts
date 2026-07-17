/**
 * All timestamp display renders in Singapore time (UTC+8), overriding any
 * per-session recorded timezone and the viewer's browser timezone. Storage
 * and any wall-clock-offset math elsewhere are untouched — only display.
 */
const TIME_ZONE = 'Asia/Singapore';

function toDate(input: string | number | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

export function formatSGT(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return toDate(input).toLocaleString('en-SG', { timeZone: TIME_ZONE, ...options });
}

export function formatDateSGT(input: string | number | Date): string {
  return formatSGT(input, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTimeSGT(input: string | number | Date): string {
  return formatSGT(input, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatTimeSecSGT(input: string | number | Date): string {
  return formatSGT(input, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

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

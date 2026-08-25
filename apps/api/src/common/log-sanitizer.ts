/**
 * Neutralizes untrusted input (emails, user-agents, URLs, route params)
 * before it is interpolated into a log message. Strips CR/LF and other
 * control characters so an attacker can't inject fake log lines or forge
 * entries by embedding newlines in a field they control, and caps length
 * so a single field can't blow up log storage.
 */
export function sanitizeForLog(value: unknown, maxLength = 200): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  // eslint-disable-next-line no-control-regex
  const stripped = str.replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ').trim();
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength)}…` : stripped;
}

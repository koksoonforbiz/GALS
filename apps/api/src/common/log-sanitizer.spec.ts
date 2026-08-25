import { sanitizeForLog } from './log-sanitizer';

describe('sanitizeForLog', () => {
  it('passes through an ordinary string unchanged', () => {
    expect(sanitizeForLog('teacher@example.com')).toBe('teacher@example.com');
  });

  it('strips CRLF so a forged log line cannot be injected', () => {
    const malicious = 'attacker\r\n[Nest] FAKE ENTRY: admin login succeeded';
    const result = sanitizeForLog(malicious);
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result).toBe('attacker  [Nest] FAKE ENTRY: admin login succeeded');
  });

  it('strips other control characters (e.g. tab, escape, null byte)', () => {
    const result = sanitizeForLog('a\tb\x1bc\x00d');
    // eslint-disable-next-line no-control-regex
    expect(result).not.toMatch(/[\x00-\x1F\x7F]/);
    expect(result).toBe('a b c d');
  });

  it('truncates long input and marks it as truncated', () => {
    const long = 'x'.repeat(300);
    const result = sanitizeForLog(long, 200);
    expect(result.length).toBe(201); // 200 chars + the truncation marker
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns an empty string for null/undefined rather than the literal text', () => {
    expect(sanitizeForLog(null)).toBe('');
    expect(sanitizeForLog(undefined)).toBe('');
  });

  it('coerces non-string values to strings', () => {
    expect(sanitizeForLog(404)).toBe('404');
    expect(sanitizeForLog(true)).toBe('true');
  });

  it('trims leading/trailing whitespace left behind after stripping control chars', () => {
    expect(sanitizeForLog('\n\n  hello  \n')).toBe('hello');
  });
});

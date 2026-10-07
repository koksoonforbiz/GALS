import { createHash } from 'crypto';
import {
  LESSON_SCHEMA_VERSION,
  type LessonDocument,
  type LessonMcqOption,
  type LessonSlide,
  type LessonSlideType,
} from '@ats/shared';

/**
 * Parses the prompting course's single-file HTML (course_slides.html) into
 * one {@link LessonDocument} per session. Pure — no I/O — so it can be
 * unit-tested and reused by the import script.
 *
 * The course data is a JSON array assigned to `const COURSE=` inside the
 * page's <script>. Slide keys reproduce the HTML's own scheme exactly
 * (`s<sessionId>-<i+1>`, with `s<sessionId>-0` for the generated title
 * slide) so that logs from the HTML version and from GALS line up.
 */

const KNOWN_TYPES: ReadonlySet<string> = new Set<LessonSlideType>([
  'objectives',
  'theory',
  'figure',
  'example',
  'think',
  'predict',
  'mcq',
  'misconceptions',
  'concept',
  'check',
  'exercise',
  'task',
  'ai',
  'stretch',
  'selfscore',
  'reflect',
]);

/**
 * Decision #3 (PHASE0_DISCOVERY.md §11): proposed distractor → misconception
 * tags, keyed by MCQ slide key then ORIGINAL option index (1-based, the
 * index the HTML logs as `mcq_answered.option`). Status stays `proposed`
 * until a researcher approves the mapping.
 */
export const PROPOSED_DISTRACTOR_TAGS: Record<string, Record<number, string>> = {
  's1-9': { 2: 's1-16-m4', 3: 's1-16-m4' },
  's2-12': { 1: 's2-13-m2', 3: 'x-untested-fix' },
  's3-12': { 2: 's3-13-m1', 3: 'x-single-run-verdict' },
  's4-13': { 2: 's4-14-m2', 3: 's4-14-m3' },
  's5-12': { 1: 's5-13-m4', 2: 's5-13-m4' },
  's6-14': { 1: 's6-15-m1', 3: 'x-proxy-for-quality' },
  's7-14': { 1: 's7-15-m1', 3: 's7-15-m2' },
  's8-14': { 1: 's8-15-m2', 2: 's8-15-m1' },
};

interface RawSession {
  id: number;
  title: string;
  covers?: string;
  bigq?: string;
  core?: string[];
  appendix?: boolean;
  slides: Array<Record<string, unknown> & { t: string }>;
}

export interface ParsedCourse {
  title: string;
  sourceSha256: string;
  sessions: LessonDocument[];
}

export class CourseHtmlParseError extends Error {}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Extracts the `const COURSE=[…];` array literal from the page source. */
export function extractCourseJson(html: string): RawSession[] {
  const start = html.indexOf('const COURSE=');
  if (start < 0) throw new CourseHtmlParseError('No `const COURSE=` found in the HTML');
  const arrStart = html.indexOf('[', start);
  // Walk to the matching close bracket, respecting JSON strings, rather
  // than trusting a regex across ~300 KB of embedded HTML/SVG.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrStart; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        const parsed = JSON.parse(html.slice(arrStart, i + 1)) as unknown;
        if (!Array.isArray(parsed)) throw new CourseHtmlParseError('COURSE is not an array');
        return parsed as RawSession[];
      }
    }
  }
  throw new CourseHtmlParseError('Unterminated COURSE array');
}

function extractTitle(html: string): string {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m?.[1]?.trim() || 'Prompting course';
}

function tagOptions(key: string, options: unknown): LessonMcqOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const tags = PROPOSED_DISTRACTOR_TAGS[key] ?? {};
  return options.map((o, idx) => {
    const opt = { ...(o as LessonMcqOption) };
    const tag = tags[idx + 1];
    if (!opt.ok && tag) {
      opt.misconceptionId = tag;
      opt.misconceptionTagStatus = 'proposed';
    }
    return opt;
  });
}

export function parseCourseHtml(html: string, sourceFile = 'course_slides.html'): ParsedCourse {
  const raw = extractCourseJson(html);
  const sourceSha256 = sha256(html);
  const importedAt = new Date().toISOString();

  const sessions = raw.map((sess): LessonDocument => {
    if (typeof sess.id !== 'number' || !Array.isArray(sess.slides)) {
      throw new CourseHtmlParseError(
        `Malformed session entry: ${JSON.stringify(sess).slice(0, 80)}`,
      );
    }
    const titleSlide: LessonSlide = {
      key: `s${sess.id}-0`,
      t: 'title',
      contentHash: sha256(
        JSON.stringify({ title: sess.title, covers: sess.covers, bigq: sess.bigq }),
      ),
    };
    const slides = sess.slides.map((s, i): LessonSlide => {
      if (!KNOWN_TYPES.has(s.t)) {
        throw new CourseHtmlParseError(`Unknown slide type "${s.t}" in session ${sess.id}`);
      }
      const key = `s${sess.id}-${i + 1}`;
      const slide = { ...s, key, contentHash: sha256(JSON.stringify(s)) } as unknown as LessonSlide;
      if (s.t === 'mcq') slide.options = tagOptions(key, s.options);
      return slide;
    });
    return {
      schemaVersion: LESSON_SCHEMA_VERSION,
      source: { file: sourceFile, sha256: sourceSha256, importedAt },
      session: {
        id: sess.id,
        title: sess.title,
        covers: sess.covers ?? '',
        bigq: sess.bigq ?? '',
        core: sess.core ?? [],
        appendix: Boolean(sess.appendix),
      },
      slides: [titleSlide, ...slides],
    };
  });

  return { title: extractTitle(html), sourceSha256, sessions };
}

export interface KeyDrift {
  key: string;
  kind: 'type-changed' | 'content-changed' | 'removed' | 'added';
  detail?: string;
}

/**
 * Compares a previously imported lesson with a fresh parse. Keys are frozen:
 * a key whose slide TYPE changed (or that disappeared) would silently
 * re-point existing logs, so the importer refuses those unless forced.
 * Content edits at a stable key are reported but allowed.
 */
export function diffLessonKeys(previous: LessonDocument, next: LessonDocument): KeyDrift[] {
  const prev = new Map(previous.slides.map((s) => [s.key, s]));
  const nxt = new Map(next.slides.map((s) => [s.key, s]));
  const drift: KeyDrift[] = [];
  for (const [key, p] of prev) {
    const n = nxt.get(key);
    if (!n) drift.push({ key, kind: 'removed' });
    else if (n.t !== p.t) drift.push({ key, kind: 'type-changed', detail: `${p.t} → ${n.t}` });
    else if (n.contentHash !== p.contentHash) drift.push({ key, kind: 'content-changed' });
  }
  for (const key of nxt.keys()) if (!prev.has(key)) drift.push({ key, kind: 'added' });
  return drift;
}

export function isBreakingDrift(drift: KeyDrift[]): boolean {
  return drift.some((d) => d.kind === 'type-changed' || d.kind === 'removed');
}

/** Plain-text rendering of a lesson, for chatbot grounding. */
export function lessonToPlainText(doc: LessonDocument, maxChars = 50_000): string {
  const strip = (h: unknown) =>
    typeof h === 'string'
      ? h
          .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  const parts: string[] = [`${doc.session.title}. ${strip(doc.session.covers)}`];
  for (const s of doc.slides) {
    const bits = [s.heading, s.box, s.html, s.prompt, s.q, s.caption].map(strip).filter(Boolean);
    if (Array.isArray(s.items)) {
      for (const it of s.items) {
        if (typeof it === 'string') bits.push(strip(it));
        else if (it && typeof it === 'object') {
          const o = it as Record<string, unknown>;
          bits.push(strip(o.q ?? o.claim ?? ''));
        }
      }
    }
    if (Array.isArray(s.criteria)) bits.push(...s.criteria.map(strip));
    if (bits.length) parts.push(bits.join(' '));
  }
  return parts.join('\n\n').slice(0, maxChars);
}

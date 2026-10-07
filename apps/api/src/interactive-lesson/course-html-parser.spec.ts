import * as fs from 'fs';
import * as path from 'path';
import {
  CourseHtmlParseError,
  diffLessonKeys,
  extractCourseJson,
  isBreakingDrift,
  lessonToPlainText,
  parseCourseHtml,
  PROPOSED_DISTRACTOR_TAGS,
} from './course-html-parser';

const COURSE_HTML = path.resolve(__dirname, '../../../../docs/process-mining/course_slides.html');

describe('parseCourseHtml — the real prompting course', () => {
  const html = fs.readFileSync(COURSE_HTML, 'utf8');
  const parsed = parseCourseHtml(html);

  it('finds 8 sessions plus the appendix', () => {
    expect(parsed.sessions).toHaveLength(9);
    expect(parsed.sessions.map((s) => s.session.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parsed.sessions[8]!.session.appendix).toBe(true);
  });

  it('reproduces the slide-type counts measured in Phase 0', () => {
    const counts: Record<string, number> = {};
    for (const s of parsed.sessions)
      for (const sl of s.slides) counts[sl.t] = (counts[sl.t] ?? 0) + 1;
    expect(counts).toMatchObject({
      title: 9,
      theory: 50,
      exercise: 20,
      figure: 19,
      stretch: 10,
      objectives: 8,
      think: 8,
      predict: 8,
      mcq: 8,
      example: 8,
      misconceptions: 8,
      concept: 8,
      check: 8,
      task: 8,
      selfscore: 8,
      reflect: 8,
    });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(196);
  });

  it('uses the HTML slide keys (s<session>-<index>, title = -0)', () => {
    const s1 = parsed.sessions[0]!;
    expect(s1.slides[0]).toMatchObject({ key: 's1-0', t: 'title' });
    expect(s1.slides[1]).toMatchObject({ key: 's1-1', t: 'objectives' });
    // Lab 1C — the lab the plan calls "Lab 1.7" — is a task slide at s1-21.
    const lab = s1.slides.find((s) => s.key === 's1-21');
    expect(lab?.t).toBe('task');
    expect(lab?.box).toContain('Lab 1C');
  });

  it('tags every MCQ distractor with a proposed misconception id', () => {
    for (const sess of parsed.sessions) {
      for (const slide of sess.slides.filter((s) => s.t === 'mcq')) {
        expect(PROPOSED_DISTRACTOR_TAGS[slide.key]).toBeDefined();
        for (const opt of slide.options ?? []) {
          if (opt.ok) expect(opt.misconceptionId).toBeUndefined();
          else {
            expect(opt.misconceptionId).toMatch(/^(s\d+-\d+-m\d+|x-[a-z-]+)$/);
            expect(opt.misconceptionTagStatus).toBe('proposed');
          }
        }
      }
    }
  });

  it('is deterministic apart from importedAt', () => {
    const again = parseCourseHtml(html);
    expect(again.sessions.map((s) => s.slides.map((x) => x.contentHash))).toEqual(
      parsed.sessions.map((s) => s.slides.map((x) => x.contentHash)),
    );
  });

  it('grounding text omits reference answers so the chatbot cannot pre-empt a reveal', () => {
    const s1 = parsed.sessions[0]!;
    const text = lessonToPlainText(s1);
    expect(text.length).toBeGreaterThan(1000);
    const check = s1.slides.find((s) => s.t === 'check');
    const firstAnswer = (check?.items?.[0] as { a: string }).a.replace(/<[^>]+>/g, ' ').trim();
    expect(text).not.toContain(firstAnswer.slice(0, 60));
    expect(text).not.toMatch(/<svg/i);
  });
});

describe('extractCourseJson', () => {
  it('handles brackets inside JSON strings', () => {
    const html =
      '<script>const COURSE=[{"id":1,"title":"a ] b [","slides":[]}];\nconst X=1;</script>';
    expect(extractCourseJson(html)).toEqual([{ id: 1, title: 'a ] b [', slides: [] }]);
  });

  it('throws a parse error when the course object is missing', () => {
    expect(() => extractCourseJson('<html></html>')).toThrow(CourseHtmlParseError);
  });

  it('rejects unknown slide types', () => {
    const html = 'const COURSE=[{"id":1,"title":"t","slides":[{"t":"quiz"}]}];';
    expect(() => parseCourseHtml(html)).toThrow(/Unknown slide type "quiz"/);
  });
});

describe('diffLessonKeys — frozen keys', () => {
  const html =
    'const COURSE=[{"id":1,"title":"t","slides":[{"t":"theory","html":"a"},{"t":"mcq","q":"q","options":[]}]}];';
  const base = parseCourseHtml(html).sessions[0]!;

  it('reports a content edit at a stable key as non-breaking', () => {
    const edited = parseCourseHtml(html.replace('"html":"a"', '"html":"b"')).sessions[0]!;
    const drift = diffLessonKeys(base, edited);
    expect(drift).toEqual([{ key: 's1-1', kind: 'content-changed' }]);
    expect(isBreakingDrift(drift)).toBe(false);
  });

  it('treats an inserted slide (which shifts keys) as breaking', () => {
    const inserted = parseCourseHtml(
      html.replace('"slides":[', '"slides":[{"t":"concept","html":"x"},'),
    ).sessions[0]!;
    const drift = diffLessonKeys(base, inserted);
    expect(drift).toEqual(
      expect.arrayContaining([
        { key: 's1-1', kind: 'type-changed', detail: 'theory → concept' },
        { key: 's1-3', kind: 'added' },
      ]),
    );
    expect(isBreakingDrift(drift)).toBe(true);
  });
});

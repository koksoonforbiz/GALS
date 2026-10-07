import type { LessonSlide } from '@ats/shared';

const strip = (h: unknown): string =>
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

/**
 * Plain text of one slide for the chatbot's page context ("use entire
 * page"). Mirrors the API's lessonToPlainText: question/claim text only,
 * never reference answers or reveals, so the chatbot cannot pre-empt the
 * course's commit-before-reveal design.
 */
export function slidePlainText(s: LessonSlide): string {
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
  return bits.filter(Boolean).join('\n\n');
}

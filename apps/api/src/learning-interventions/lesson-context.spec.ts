/**
 * The Learning Assistant grounds on interactive lessons (2026-11-26): the
 * prompting course has no PDFs, so without lesson text it answered with no
 * course material ("not enough information").
 */
import { lessonPlainText } from './learning-interventions.service';

describe('lessonPlainText', () => {
  it('reads every slide, strips HTML, skips layout keys', () => {
    const text = lessonPlainText({
      version: 1,
      session: 1,
      slides: [
        {
          key: 's1-1',
          t: 'title',
          title: 'Prompting basics',
          body: '<p>Why <b>context</b> matters</p>',
        },
        {
          key: 's1-2',
          t: 'mcq',
          question: 'Which is clearer?',
          options: ['A short ask', 'A task with role &amp; format'],
          image: '/img/x.png',
        },
      ],
    });
    expect(text).toBe(
      '[Slide 1] Prompting basics Why context matters\n[Slide 2] Which is clearer? A short ask A task with role & format',
    );
  });

  it('is empty without slides', () => {
    expect(lessonPlainText(null)).toBe('');
    expect(lessonPlainText({ blocks: [] })).toBe('');
  });
});

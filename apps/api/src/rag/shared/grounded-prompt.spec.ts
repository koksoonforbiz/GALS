/**
 * Stage 06 — buildGroundedMessages unit tests.
 *
 * The contract:
 *  1. The verbatim `GROUNDING_CONTRACT` ALWAYS appears in the system
 *     prompt — regardless of persona.
 *  2. Citation labels match the FIXED format (`Source N: name, p.X`
 *     for text, `Figure: name, p.X` for images).
 *  3. Text-only call → user message is a plain string (so older
 *     funnel paths / mocks keep working).
 *  4. With images → user message is a `FunnelContentPart[]` with the
 *     text part FIRST followed by one `image_url` part per image
 *     with a base64 `data:` URL.
 *  5. History is flattened into the user text in the same shape
 *     dialogue + chat both used historically.
 */

import {
  GROUNDING_CONTRACT,
  buildCitationLabel,
  buildGroundedMessages,
} from './grounded-prompt';

describe('buildCitationLabel', () => {
  it('formats text citation with page', () => {
    expect(
      buildCitationLabel({ index: 1, modality: 'text', filename: 'a.pdf', pageNumber: 4 }),
    ).toBe('Source 1: a.pdf, p.4');
  });

  it('formats text citation without page (null page)', () => {
    expect(
      buildCitationLabel({ index: 3, modality: 'text', filename: 'notes.txt', pageNumber: null }),
    ).toBe('Source 3: notes.txt');
  });

  it('formats figure citation', () => {
    expect(
      buildCitationLabel({ index: 0, modality: 'image', filename: 'chart.pdf', pageNumber: 7 }),
    ).toBe('Figure: chart.pdf, p.7');
  });

  it('formats figure citation without page', () => {
    expect(
      buildCitationLabel({ index: 0, modality: 'image', filename: 'fig.png', pageNumber: null }),
    ).toBe('Figure: fig.png');
  });
});

describe('GROUNDING_CONTRACT', () => {
  it('contains the verbatim "only from supplied sources" rule', () => {
    expect(GROUNDING_CONTRACT).toContain('Answer ONLY from the supplied sources');
  });

  it('contains the verbatim citation format spec', () => {
    expect(GROUNDING_CONTRACT).toContain(
      '`[Source N: filename.pdf, p.X]` for text and `[Figure: filename.pdf, p.X]` for visuals',
    );
  });

  it('contains the explicit refuse-when-unsupported rule', () => {
    expect(GROUNDING_CONTRACT).toContain(
      'If the sources do not contain the answer, say so explicitly and do not guess.',
    );
  });

  it('contains the caption-as-hint warning', () => {
    expect(GROUNDING_CONTRACT).toContain('Captions are context, not ground truth');
  });
});

describe('buildGroundedMessages', () => {
  it('always appends the grounding contract to the system prompt', () => {
    const out = buildGroundedMessages({
      systemPersona: 'You are a tutor.',
      contextChunks: [],
      images: [],
      history: [],
      question: 'Hi',
    });
    expect(out.systemPrompt).toContain('You are a tutor.');
    expect(out.systemPrompt).toContain(GROUNDING_CONTRACT);
    // Persona comes BEFORE the contract.
    expect(out.systemPrompt.indexOf('You are a tutor.')).toBeLessThan(
      out.systemPrompt.indexOf(GROUNDING_CONTRACT),
    );
  });

  it('emits a plain-string user message when no images are attached', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [
        {
          id: 'c1',
          text: 'water boils at 100°C at sea level',
          citationLabel: 'Source 1: physics.pdf, p.2',
        },
      ],
      images: [],
      history: [],
      question: 'what is the boiling point?',
    });
    expect(out.messages).toHaveLength(1);
    expect(typeof out.messages[0]!.content).toBe('string');
    expect(out.messages[0]!.content as string).toContain('[Source 1: physics.pdf, p.2]');
    expect(out.messages[0]!.content as string).toContain('water boils at 100°C');
    expect(out.messages[0]!.content as string).toContain('Student: what is the boiling point?');
  });

  it('emits FunnelContentPart[] with one image_url per attached image', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [
        {
          chunkId: 'i1',
          bytes: pngBytes,
          mimeType: 'image/png',
          citationLabel: 'Figure: chart.pdf, p.4',
        },
        {
          chunkId: 'i2',
          bytes: Buffer.from([0xff, 0xd8, 0xff]),
          mimeType: 'image/jpeg',
          citationLabel: 'Figure: chart.pdf, p.5',
        },
      ],
      history: [],
      question: 'what does the chart show?',
    });
    expect(out.messages).toHaveLength(1);
    const content = out.messages[0]!.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(3); // 1 text + 2 images
    expect(content[0]!.type).toBe('text');
    expect(content[1]!.type).toBe('image_url');
    expect(content[2]!.type).toBe('image_url');
    // Image part URLs are base64 data URLs.
    expect(content[1]!.image_url!.url).toMatch(/^data:image\/png;base64,/);
    expect(content[2]!.image_url!.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('falls back to a presigned URL when bytes are absent and URL is http(s)', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [
        {
          chunkId: 'i1',
          presignedUrl: 'https://cdn.example.com/foo.png',
          mimeType: 'image/png',
          citationLabel: 'Figure: foo.pdf, p.1',
        },
      ],
      history: [],
      question: 'q',
    });
    const content = out.messages[0]!.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(content[1]!.image_url!.url).toBe('https://cdn.example.com/foo.png');
  });

  it('silently drops an image when neither bytes nor a usable URL is available', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [
        {
          chunkId: 'i1',
          // No bytes, no http URL — caller is expected to have already
          // degraded this to caption-as-text. We must NOT throw.
          presignedUrl: '/s3/local-only/foo.png', // relative — provider can't fetch
          mimeType: 'image/png',
          citationLabel: 'Figure: foo.pdf, p.1',
        },
      ],
      history: [],
      question: 'q',
    });
    // With no usable image and no text chunks, we collapse to a
    // single plain-string user message (no SOURCES wrapper, no
    // mislabelled "(see attached image)" stub).
    expect(typeof out.messages[0]!.content).toBe('string');
    expect(out.messages[0]!.content).not.toContain('Figure:');
    expect(out.messages[0]!.content).not.toContain('(see attached image)');
    expect(out.messages[0]!.content as string).toContain('Student: q');
  });

  it('emits per-chunk citation labels in the context block', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [
        { id: 'c1', text: 'apples are red', citationLabel: 'Source 1: a.pdf, p.1' },
        { id: 'c2', text: 'bananas are yellow', citationLabel: 'Source 2: b.pdf, p.2' },
      ],
      images: [],
      history: [],
      question: 'colour me up',
    });
    const userText = out.messages[0]!.content as string;
    expect(userText).toContain('[Source 1: a.pdf, p.1]');
    expect(userText).toContain('apples are red');
    expect(userText).toContain('[Source 2: b.pdf, p.2]');
    expect(userText).toContain('bananas are yellow');
  });

  it('emits image citation labels in the context block alongside attached images', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [
        {
          chunkId: 'i1',
          bytes: Buffer.from([0x00]),
          mimeType: 'image/png',
          citationLabel: 'Figure: lecture.pdf, p.3',
          caption: 'bar chart of GDP',
        },
      ],
      history: [],
      question: 'what does the chart show?',
    });
    const parts = out.messages[0]!.content as Array<{ type: string; text?: string }>;
    expect(parts[0]!.text).toContain('[Figure: lecture.pdf, p.3]');
    expect(parts[0]!.text).toContain('(see attached image)');
    expect(parts[0]!.text).toContain('bar chart of GDP');
  });

  it('flattens history into the user text', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [],
      history: [
        { role: 'user', content: 'previous q' },
        { role: 'assistant', content: 'previous a' },
      ],
      question: 'follow-up',
    });
    const text = out.messages[0]!.content as string;
    expect(text).toContain('Student: previous q');
    expect(text).toContain('Assistant: previous a');
    expect(text).toContain('Student: follow-up');
  });

  it('omits the SOURCES block when no chunks or images', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [],
      history: [],
      question: 'q',
    });
    const text = out.messages[0]!.content as string;
    expect(text).not.toContain('--- SOURCES ---');
    expect(text).toContain('Student: q');
  });
});

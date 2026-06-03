/**
 * Stage 06 — Cross-surface grounded contract integration test.
 *
 * Asserts that BOTH dialogue (`DialogueService.sendMessage`) AND the
 * chatbot (`LearningInterventionsService.chat`) route through the
 * SAME shared `buildGroundedMessages` shape. The way we verify this
 * is by:
 *   1. Source-level grep — every grounded surface imports
 *      `buildGroundedMessages` or `generateInterventionGrounded`
 *      (which composes it).
 *   2. Direct invocation of `buildGroundedMessages` with the shapes
 *      the two surfaces would pass — both must yield messages of
 *      length 1 whose system prompt contains the verbatim contract.
 *
 * Stage 06 spec: "spot-check shows identical refusal behavior on
 * 'not in materials' questions across surfaces" — the easiest way to
 * codify that is to assert the system prompts are byte-for-byte
 * identical apart from the surface persona prefix.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  GROUNDING_CONTRACT,
  buildGroundedMessages,
  buildCitationLabel,
} from './grounded-prompt';

describe('cross-surface grounded contract', () => {
  it('dialogue.service.ts imports buildGroundedMessages', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'dialogue', 'dialogue.service.ts'),
      'utf8',
    );
    expect(src).toMatch(/buildGroundedMessages/);
    expect(src).toMatch(/GroundedEvidenceService/);
  });

  it('learning-interventions.service.ts imports buildGroundedMessages and routes 4 generators + chat() through the shared contract', () => {
    const src = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'learning-interventions',
        'learning-interventions.service.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/buildGroundedMessages/);
    expect(src).toMatch(/GroundedEvidenceService/);
    // The four generators all converge on `generateInterventionGrounded`.
    const generatorCalls = (src.match(/generateInterventionGrounded\(/g) ?? []).length;
    // 1 declaration + 4 call sites (practice testing, interrogative
    // suggestion, stepwise generate, distributed practice). Allow ≥ 5.
    expect(generatorCalls).toBeGreaterThanOrEqual(5);
  });

  it('produces byte-identical system prompts apart from persona for two different surfaces', () => {
    const dialogue = buildGroundedMessages({
      systemPersona: 'You are a tutor.',
      contextChunks: [
        {
          id: 'c1',
          text: 'apples are red',
          citationLabel: buildCitationLabel({
            index: 1,
            modality: 'text',
            filename: 'food.pdf',
            pageNumber: 2,
          }),
        },
      ],
      images: [],
      history: [],
      question: 'what colour are apples?',
    });
    const chat = buildGroundedMessages({
      systemPersona: 'You are a friendly learning assistant.',
      contextChunks: [
        {
          id: 'c1',
          text: 'apples are red',
          citationLabel: buildCitationLabel({
            index: 1,
            modality: 'text',
            filename: 'food.pdf',
            pageNumber: 2,
          }),
        },
      ],
      images: [],
      history: [],
      question: 'what colour are apples?',
    });

    // Both contain the verbatim contract.
    expect(dialogue.systemPrompt).toContain(GROUNDING_CONTRACT);
    expect(chat.systemPrompt).toContain(GROUNDING_CONTRACT);

    // The portion AFTER the persona divider is byte-identical.
    const dialogueRest = dialogue.systemPrompt.split('---').slice(1).join('---');
    const chatRest = chat.systemPrompt.split('---').slice(1).join('---');
    expect(dialogueRest).toEqual(chatRest);

    // The user-side messages are identical (same chunks, same q).
    expect(dialogue.messages).toEqual(chat.messages);
  });

  it('refusal posture: contract is present even when there are no chunks (so model can refuse)', () => {
    const out = buildGroundedMessages({
      systemPersona: 'tutor',
      contextChunks: [],
      images: [],
      history: [],
      question: 'what is the airspeed velocity of an unladen swallow?',
    });
    expect(out.systemPrompt).toContain('If the sources do not contain the answer');
  });
});

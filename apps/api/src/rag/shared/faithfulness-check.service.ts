/**
 * Stage 06 — Faithfulness self-check.
 *
 * Flag-gated post-generation pass. Re-prompts the judge (temperature
 * 0) to confirm each claim in the answer is supported by the
 * supplied context. If unsupported claims are found, the caller's
 * policy decides what to do (this PR picks "regenerate once with a
 * stricter instruction" — cleaner UX than silent stripping).
 *
 * Defaults (controlled via env / per-call override):
 *   - chat surface           → OFF (latency-sensitive)
 *   - intervention surface   → ON  (correctness > latency)
 *
 * Triple-defensive: any LLM failure here returns `{ supported: true }`
 * so faithful generations don't get rejected because the judge
 * timed out. The caller logs the outcome regardless.
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm.service';

export interface FaithfulnessInput {
  answer: string;
  /** The same context the generator saw — flattened to text. The
   *  caller assembles this from the original `contextChunks` +
   *  image captions; we don't reach back into the retriever. */
  context: string;
  /** Teacher whose key drives the judge call. */
  teacherId: string;
  /** Optional course id for usage attribution. */
  courseId?: string;
}

export interface FaithfulnessOutcome {
  supported: boolean;
  /** When `supported === false`, the concrete claims the judge said
   *  weren't grounded. May be empty even when supported=false (the
   *  judge said "no" without specifying). */
  unsupportedClaims?: string[];
  /** Whether the judge call actually ran. False ⇒ we degraded to
   *  "supported=true" because the call threw / returned bad JSON. */
  judgeRan: boolean;
  /** Raw judge JSON for debugging — not persisted on the message. */
  rawJudge?: unknown;
}

const FAITHFULNESS_JUDGE_SYSTEM = [
  'You are a faithfulness judge for an educational assistant.',
  'Given a context (the only sources the assistant was allowed to use) and an answer,',
  'decide whether every factual claim in the answer is supported by the context.',
  'A claim is unsupported if the context does not state it, even implicitly.',
  'Citations like [Source 1: ...] or [Figure: ...] are NOT facts themselves — judge the surrounding prose.',
  'Be strict but fair: minor restatements, paraphrases, and reasonable summaries of present facts ARE supported.',
  'Return ONLY valid JSON in this shape:',
  '{ "supported": true | false, "unsupportedClaims": ["claim text", ...] }',
  'If supported=true, "unsupportedClaims" should be an empty array.',
].join('\n');

@Injectable()
export class FaithfulnessCheckService {
  private readonly logger = new Logger(FaithfulnessCheckService.name);

  constructor(private readonly llmService: LlmService) {}

  async checkFaithfulness(input: FaithfulnessInput): Promise<FaithfulnessOutcome> {
    if (!input.answer || input.answer.trim().length === 0) {
      return { supported: true, judgeRan: false };
    }
    if (!input.context || input.context.trim().length === 0) {
      // No context to judge against — there's nothing the answer can
      // be supported by, but we don't want to false-positive every
      // ungrounded chat. The caller decides what to do; we report
      // "didn't run".
      return { supported: true, judgeRan: false };
    }

    const userPrompt = [
      '--- CONTEXT ---',
      input.context.trim(),
      '--- END CONTEXT ---',
      '',
      '--- ANSWER ---',
      input.answer.trim(),
      '--- END ANSWER ---',
    ].join('\n');

    try {
      const result = await this.llmService.callLlmStructured(
        input.teacherId,
        {
          systemPrompt: FAITHFULNESS_JUDGE_SYSTEM,
          messages: [{ role: 'user', content: userPrompt }],
          jsonMode: true,
          temperature: 0,
          maxTokens: 1024,
        },
        {
          feature: 'faithfulness_check',
          courseId: input.courseId,
        },
      );

      const parsed = this.parseJudgeJson(result.content);
      if (!parsed) {
        this.logger.warn(
          'faithfulness_check.fired=true judgeRan=true parseFailed=true — treating as supported',
        );
        return { supported: true, judgeRan: true, rawJudge: result.content };
      }

      const supported = parsed.supported === true;
      const unsupportedClaims = Array.isArray(parsed.unsupportedClaims)
        ? parsed.unsupportedClaims.filter((s): s is string => typeof s === 'string')
        : [];

      return {
        supported,
        unsupportedClaims: supported ? [] : unsupportedClaims,
        judgeRan: true,
        rawJudge: parsed,
      };
    } catch (err) {
      // Triple-defensive: any judge failure ⇒ assume supported so we
      // don't reject correct generations because of a transient
      // provider hiccup.
      this.logger.warn(
        `faithfulness_check.fired=true judgeRan=false reason=${(err as Error)?.message ?? err} — treating as supported`,
      );
      return { supported: true, judgeRan: false };
    }
  }

  private parseJudgeJson(content: string): {
    supported: boolean;
    unsupportedClaims?: unknown;
  } | null {
    if (!content) return null;
    let cleaned = content.trim();
    // Strip code fences if the model wrapped its JSON.
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) cleaned = fenced[1]!.trim();
    try {
      const parsed = JSON.parse(cleaned) as {
        supported: boolean;
        unsupportedClaims?: unknown;
      };
      if (typeof parsed.supported !== 'boolean') return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

/**
 * Build the stricter regenerate instruction we append to the
 * original system prompt when the judge says the first draft had
 * unsupported claims. Exported so unit tests can assert on it AND so
 * different surfaces compose it consistently.
 */
export function buildFaithfulnessRetryAddendum(
  unsupportedClaims: string[],
): string {
  const claimList =
    unsupportedClaims.length > 0
      ? unsupportedClaims.map((c) => `- "${c}"`).join('\n')
      : '- (judge did not list specific claims)';
  return [
    '',
    '---',
    '',
    'FAITHFULNESS RETRY: The previous draft included claims that were NOT supported by the sources. Specifically:',
    claimList,
    'Rewrite your answer. ONLY assert what is directly supported by the sources above. If the sources are insufficient for part of the question, refuse explicitly for that part.',
  ].join('\n');
}

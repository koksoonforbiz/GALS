/**
 * RAGAS-style metric implementations.
 *
 * Each metric is a function that takes a gold item + retrieved chunks +
 * generated answer, then returns `{ score, reasoning? }` on success or
 * `{ score: null, error }` on judge failure. Triple-defensive: a single
 * judge crash scores the row as `null` for that metric and never
 * propagates.
 *
 * The judge is the teacher's configured LLM (the same funnel the
 * production code uses), invoked with `temperature: 0` and a JSON
 * response schema for deterministic parsing.
 */

import type { LlmService } from '../../llm.service';
import type { GoldItem, MetricScore, RetrievedChunkLite, GeneratedAnswer } from '../types';

/** A reusable safe-judge wrapper around `callLlmStructured` that returns
 *  the parsed JSON object on success or throws on failure. Used by each
 *  metric inside its own try/catch so judge errors stay localised. */
async function judgeJson<T>(
  llm: LlmService,
  judgeUserId: string,
  systemPrompt: string,
  userPrompt: string,
  schema: Record<string, unknown>,
): Promise<T> {
  const result = await llm.callLlmStructured(
    judgeUserId,
    {
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      jsonMode: true,
      jsonSchema: schema,
      temperature: 0,
      maxTokens: 1024,
    },
    { feature: 'rag_eval_judge' },
  );

  // The template-fallback path (no API key) returns a flavoured string,
  // not JSON. Detect and refuse so the row scores `null` instead of
  // producing fake structured output.
  if (!result.model) {
    throw new Error('judge llm has no API key configured (template fallback would not return JSON)');
  }

  let content = result.content.trim();
  // Some judges wrap JSON in ```json fences despite the system prompt.
  // Strip them defensively.
  if (content.startsWith('```')) {
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(content) as T;
}

// ─── context_recall ────────────────────────────────────────
//
// Did retrieval surface the chunk(s) needed to answer the question?
// Judge sees the gold question, the gold expected_answer, and the
// retrieved chunk contents. Asks: of the claims in the expected answer,
// what fraction are supported by at least one retrieved chunk?

export async function contextRecall(
  llm: LlmService,
  judgeUserId: string,
  item: GoldItem,
  retrieved: RetrievedChunkLite[],
  _answer: GeneratedAnswer,
): Promise<MetricScore> {
  try {
    if (item.is_refusal) {
      // Recall is undefined for "no answer should exist" rows. Mark
      // null so we don't pollute the aggregate.
      return { score: null, error: 'refusal row — context_recall N/A' };
    }
    if (retrieved.length === 0) {
      return { score: 0, reasoning: 'No chunks retrieved.' };
    }

    const contextBlock = retrieved
      .map((c, i) => `Chunk ${i + 1} (${c.documentName}${c.pageNumber ? `, p.${c.pageNumber}` : ''}):\n${c.content.slice(0, 1200)}`)
      .join('\n\n');

    const sysP =
      'You evaluate retrieval quality. Given a question, a gold expected answer, and the retrieved context, ' +
      'judge what fraction of the discrete factual claims in the expected answer are directly supported by the context. ' +
      'Reply ONLY in JSON: {"supported": int, "total": int, "reasoning": "short"}. Set total to the number of distinct claims, supported to how many of those a context chunk supports.';
    const usrP =
      `Question: ${item.question}\n\nExpected answer:\n${item.expected_answer}\n\nRetrieved context:\n${contextBlock}`;

    const schema = {
      type: 'object',
      properties: {
        supported: { type: 'integer' },
        total: { type: 'integer' },
        reasoning: { type: 'string' },
      },
      required: ['supported', 'total'],
    };

    const out = await judgeJson<{ supported: number; total: number; reasoning?: string }>(
      llm,
      judgeUserId,
      sysP,
      usrP,
      schema,
    );

    if (out.total <= 0) return { score: 1, reasoning: out.reasoning ?? 'no measurable claims' };
    const score = Math.max(0, Math.min(1, out.supported / out.total));
    return { score, reasoning: out.reasoning };
  } catch (err) {
    return { score: null, error: `context_recall judge failed: ${(err as Error).message}` };
  }
}

// ─── context_precision ─────────────────────────────────────
//
// Of the retrieved chunks, what fraction are relevant to the question?
// Judge labels each chunk relevant/not-relevant given the gold question.

export async function contextPrecision(
  llm: LlmService,
  judgeUserId: string,
  item: GoldItem,
  retrieved: RetrievedChunkLite[],
  _answer: GeneratedAnswer,
): Promise<MetricScore> {
  try {
    if (retrieved.length === 0) return { score: 0, reasoning: 'no chunks retrieved' };

    const numbered = retrieved
      .map((c, i) => `Chunk ${i + 1}: ${c.content.slice(0, 800)}`)
      .join('\n\n');

    const sysP =
      'You judge whether each retrieved chunk is relevant to a question. ' +
      'Reply ONLY in JSON: {"relevances": [bool, bool, ...]} with one boolean per chunk in input order.';
    const usrP = `Question: ${item.question}\n\nChunks:\n${numbered}`;

    const schema = {
      type: 'object',
      properties: {
        relevances: { type: 'array', items: { type: 'boolean' } },
      },
      required: ['relevances'],
    };

    const out = await judgeJson<{ relevances: boolean[] }>(llm, judgeUserId, sysP, usrP, schema);
    if (!Array.isArray(out.relevances) || out.relevances.length === 0) {
      return { score: 0, reasoning: 'judge returned no labels' };
    }
    const trueCount = out.relevances.filter(Boolean).length;
    return {
      score: trueCount / out.relevances.length,
      reasoning: `${trueCount}/${out.relevances.length} chunks judged relevant`,
    };
  } catch (err) {
    return { score: null, error: `context_precision judge failed: ${(err as Error).message}` };
  }
}

// ─── faithfulness ──────────────────────────────────────────
//
// Is every claim in the generated answer supported by retrieved context?
// Judge first decomposes the answer into atomic claims, then for each
// labels supported vs unsupported by the context.

export async function faithfulness(
  llm: LlmService,
  judgeUserId: string,
  item: GoldItem,
  retrieved: RetrievedChunkLite[],
  answer: GeneratedAnswer,
): Promise<MetricScore> {
  try {
    if (!answer.text || answer.text.trim().length === 0) {
      return { score: null, error: 'empty answer text' };
    }
    if (item.is_refusal) {
      // Faithfulness is N/A for refusal rows; that's what
      // refusal_correctness covers.
      return { score: null, error: 'refusal row — faithfulness N/A' };
    }
    const contextBlock = retrieved
      .map((c, i) => `Chunk ${i + 1}: ${c.content.slice(0, 1200)}`)
      .join('\n\n') || '(no context)';

    const sysP =
      'You decompose an answer into atomic factual claims, then judge whether each is supported by the supplied context. ' +
      'Reply ONLY in JSON: {"claims": [{"claim": "...", "supported": bool}, ...]}. A claim is supported only if a context chunk asserts it (paraphrase ok); answer-only assertions count as unsupported.';
    const usrP =
      `Question: ${item.question}\n\nAnswer to evaluate:\n${answer.text}\n\nContext:\n${contextBlock}`;

    const schema = {
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              supported: { type: 'boolean' },
            },
            required: ['claim', 'supported'],
          },
        },
      },
      required: ['claims'],
    };

    const out = await judgeJson<{ claims: Array<{ claim: string; supported: boolean }> }>(
      llm,
      judgeUserId,
      sysP,
      usrP,
      schema,
    );
    if (!Array.isArray(out.claims) || out.claims.length === 0) {
      return { score: 1, reasoning: 'no claims extracted (vacuous)' };
    }
    const supported = out.claims.filter((c) => c.supported).length;
    return {
      score: supported / out.claims.length,
      reasoning: `${supported}/${out.claims.length} claims supported`,
    };
  } catch (err) {
    return { score: null, error: `faithfulness judge failed: ${(err as Error).message}` };
  }
}

// ─── answer_relevancy ──────────────────────────────────────
//
// Does the answer actually address the question? Cheap rubric:
// judge gives 0..1 on how directly the answer answers the question
// (independent of correctness — faithfulness covers correctness).

export async function answerRelevancy(
  llm: LlmService,
  judgeUserId: string,
  item: GoldItem,
  _retrieved: RetrievedChunkLite[],
  answer: GeneratedAnswer,
): Promise<MetricScore> {
  try {
    if (!answer.text || answer.text.trim().length === 0) {
      return { score: 0, reasoning: 'empty answer' };
    }
    const sysP =
      'You judge how directly an answer addresses a question. Score from 0.0 (totally off-topic / unresponsive) to 1.0 (directly and fully addresses the question). ' +
      'Correctness is irrelevant for this metric — only on-topic-ness. Reply ONLY in JSON: {"score": 0..1, "reasoning": "short"}.';
    const usrP = `Question: ${item.question}\n\nAnswer:\n${answer.text}`;

    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['score'],
    };
    const out = await judgeJson<{ score: number; reasoning?: string }>(
      llm,
      judgeUserId,
      sysP,
      usrP,
      schema,
    );
    const clamped = Math.max(0, Math.min(1, Number(out.score)));
    return { score: clamped, reasoning: out.reasoning };
  } catch (err) {
    return { score: null, error: `answer_relevancy judge failed: ${(err as Error).message}` };
  }
}

// ─── refusal_correctness ───────────────────────────────────
//
// For rows tagged `is_refusal`, the only acceptable answer is a refusal
// ("not in materials" / "I don't have that"). For non-refusal rows we
// inversely reward NOT refusing.

const REFUSAL_PATTERNS = [
  /not enough info/i,
  /not_enough_info/i,
  /don'?t have/i,
  /cannot answer/i,
  /cannot determine/i,
  /no information/i,
  /not provided/i,
  /not (available|in|covered) (in|by)? (the|your|my)? (provided )?(materials?|sources?|documents?|context|upload)/i,
  /not (mentioned|discussed|addressed)/i,
  /insufficient (sources?|information|materials?)/i,
  /unable to (find|answer|determine)/i,
];

function looksLikeRefusal(answer: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(answer));
}

export async function refusalCorrectness(
  llm: LlmService,
  judgeUserId: string,
  item: GoldItem,
  _retrieved: RetrievedChunkLite[],
  answer: GeneratedAnswer,
): Promise<MetricScore> {
  try {
    if (!answer.text) {
      return { score: item.is_refusal ? 1 : 0, reasoning: 'empty answer' };
    }
    // Cheap regex first.
    const regexSaysRefusal = looksLikeRefusal(answer.text);
    if (item.is_refusal) {
      if (regexSaysRefusal) return { score: 1, reasoning: 'regex detected refusal' };
    } else {
      if (!regexSaysRefusal) return { score: 1, reasoning: 'non-refusal row, did not refuse' };
    }

    // Fall back to LLM judge for ambiguous cases.
    const sysP =
      'You judge whether an answer is declining/refusing to answer because the source material does not contain the information needed. ' +
      'Reply ONLY in JSON: {"refused": bool, "reasoning": "short"}. A polite "I don\'t see that in your materials" counts as refused; making up an answer or answering only with general knowledge does NOT.';
    const usrP = `Question: ${item.question}\n\nAnswer:\n${answer.text}`;
    const schema = {
      type: 'object',
      properties: { refused: { type: 'boolean' }, reasoning: { type: 'string' } },
      required: ['refused'],
    };
    const out = await judgeJson<{ refused: boolean; reasoning?: string }>(
      llm,
      judgeUserId,
      sysP,
      usrP,
      schema,
    );
    const want = !!item.is_refusal;
    const got = !!out.refused;
    return { score: want === got ? 1 : 0, reasoning: out.reasoning };
  } catch (err) {
    return { score: null, error: `refusal_correctness judge failed: ${(err as Error).message}` };
  }
}

// ─── citation_validity ─────────────────────────────────────
//
// Do emitted citations point to chunks that were actually retrieved?
// Pure deterministic check — no LLM needed.

export async function citationValidity(
  _llm: LlmService,
  _judgeUserId: string,
  _item: GoldItem,
  retrieved: RetrievedChunkLite[],
  answer: GeneratedAnswer,
): Promise<MetricScore> {
  try {
    if (answer.citations.length === 0) {
      // No citations emitted. If retrieval also returned nothing, that's
      // consistent — score 1. Otherwise score null so we don't conflate
      // "no citations" with "bad citations".
      if (retrieved.length === 0) return { score: 1, reasoning: 'no citations and no retrieval' };
      return { score: null, error: 'no citations emitted by surface' };
    }
    const retrievedDocs = new Set(retrieved.map((c) => c.documentName.toLowerCase()));
    let valid = 0;
    for (const cite of answer.citations) {
      if (retrievedDocs.has(cite.documentName.toLowerCase())) valid += 1;
    }
    return {
      score: valid / answer.citations.length,
      reasoning: `${valid}/${answer.citations.length} citations map to retrieved chunks`,
    };
  } catch (err) {
    return { score: null, error: `citation_validity failed: ${(err as Error).message}` };
  }
}

// ─── Aggregator ────────────────────────────────────────────

export const ALL_METRICS = {
  context_recall: contextRecall,
  context_precision: contextPrecision,
  faithfulness,
  answer_relevancy: answerRelevancy,
  refusal_correctness: refusalCorrectness,
  citation_validity: citationValidity,
} as const;

export type MetricKey = keyof typeof ALL_METRICS;

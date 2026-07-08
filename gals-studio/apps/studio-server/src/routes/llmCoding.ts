import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';

/**
 * LLM-assisted coding of learner utterances. Each USER utterance (free chatbot
 * chat + elaborative-interrogation dialogue) is sent to the researcher's chosen
 * provider (OpenAI / Gemini) with its selected-text context, and coded across:
 *   - executive functions
 *   - affective states
 *   - motivation dimensions
 *   - binary presence of the four learning strategies
 * Nothing is persisted server-side; codings are returned for CSV export.
 */

// ── coding taxonomy (aligned with the studio codebook + text-mining constructs) ──
export const EXECUTIVE_FUNCTIONS = [
  'inhibitory_control',
  'working_memory',
  'cognitive_flexibility',
  'planning',
  'metacognitive_monitoring',
  'attention_regulation',
] as const;

export const AFFECTIVE_STATES = [
  'engaged_concentration',
  'confusion',
  'frustration',
  'boredom',
  'delight',
  'surprise',
  'anxiety',
  'neutral',
] as const;

export const MOTIVATION_DIMENSIONS = [
  'self_efficacy',
  'task_value',
  'intrinsic_motivation',
  'extrinsic_motivation',
  'mastery_goal_orientation',
  'performance_goal_orientation',
  'effort_regulation',
] as const;

export const LEARNING_STRATEGIES = [
  'practice_testing',
  'distributed_practice',
  'stepwise_learning',
  'elaborative_interrogation',
] as const;

// canonical, ordered list of coded columns (prefix keeps groups readable in CSV)
export const CODED_DIMENSIONS: string[] = [
  ...EXECUTIVE_FUNCTIONS.map((k) => `ef_${k}`),
  ...AFFECTIVE_STATES.map((k) => `affect_${k}`),
  ...MOTIVATION_DIMENSIONS.map((k) => `mot_${k}`),
  ...LEARNING_STRATEGIES.map((k) => `strategy_${k}`),
];

const DEFS = `
EXECUTIVE FUNCTIONS (does the utterance evidence the construct?):
- ef_inhibitory_control: suppressing a dominant/impulsive response, resisting distraction or a prepotent wrong step.
- ef_working_memory: holding/juggling multiple pieces of information, or signs of working-memory load (losing the thread, "what was I doing").
- ef_cognitive_flexibility: switching strategy/approach or considering an alternative framing.
- ef_planning: stating a plan, sequence of steps, or goal for how to proceed.
- ef_metacognitive_monitoring: awareness/appraisal of own understanding or that something is right/wrong/incomplete.
- ef_attention_regulation: reports of mind-wandering, refocusing, or (re)directing attention to the task.

AFFECTIVE STATES (Pekrun/BROMP; may co-occur):
- affect_engaged_concentration, affect_confusion, affect_frustration, affect_boredom, affect_delight, affect_surprise, affect_anxiety, affect_neutral.

MOTIVATION DIMENSIONS:
- mot_self_efficacy: belief about own capability to succeed.
- mot_task_value: perceived importance/usefulness/interest of the task.
- mot_intrinsic_motivation: engagement for its own sake / curiosity / enjoyment.
- mot_extrinsic_motivation: grades, rewards, obligation, external pressure.
- mot_mastery_goal_orientation: aim to learn/understand/improve.
- mot_performance_goal_orientation: aim to look able / outperform / avoid looking incompetent.
- mot_effort_regulation: managing/sustaining effort and persistence despite difficulty.

LEARNING STRATEGIES (binary presence — use BOTH the utterance and the selected text the learner highlighted):
- strategy_practice_testing: self-testing, retrieval practice, quizzing, answering test questions.
- strategy_distributed_practice: spacing/revisiting material over time, review, flashcards.
- strategy_stepwise_learning: breaking the material into ordered steps / worked steps.
- strategy_elaborative_interrogation: asking/answering "why/how" elaboration questions that connect ideas.
`;

function buildPrompt(item: { utterance: string; selectedText: string; source: string }): string {
  return `You are an expert educational-psychology coder. Code the single learner utterance below.
The learner is a student interacting with a tutoring system. Context source: ${item.source}.

${DEFS}

Return STRICT JSON only, no prose, with EXACTLY these keys, each 0 or 1 (1 = the construct is present/evidenced in the utterance, 0 = not), plus a short "rationale" (<= 25 words):
${JSON.stringify(CODED_DIMENSIONS)}

Learner utterance:
"""${item.utterance || ''}"""

Selected text the learner had highlighted when sending this (may be empty):
"""${item.selectedText || ''}"""`;
}

interface CodeItem {
  id: string;
  utterance: string;
  selectedText: string;
  source: string;
}

async function callOpenAI(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You output only valid minified JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const text = data?.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(text);
}

async function callGemini(
  prompt: string,
  model: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '{}';
  return JSON.parse(text);
}

/** Normalise the LLM's raw JSON into {dimension: 0|1} + rationale. */
function normalise(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CODED_DIMENSIONS) {
    const v = raw[k];
    out[k] = v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'yes' ? 1 : 0;
  }
  out.rationale = typeof raw.rationale === 'string' ? raw.rationale : '';
  return out;
}

/** Run `fn` over items with a small concurrency cap. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function llmCodingRoutes(app: FastifyInstance): Promise<void> {
  // expose the taxonomy so the frontend/CSV stay in sync
  app.get('/api/llm-coding/dimensions', async () => ({
    dimensions: CODED_DIMENSIONS,
    groups: {
      executiveFunctions: EXECUTIVE_FUNCTIONS,
      affectiveStates: AFFECTIVE_STATES,
      motivation: MOTIVATION_DIMENSIONS,
      strategies: LEARNING_STRATEGIES,
    },
  }));

  // Gather codable USER utterances (free chat + elaborative interrogation) for
  // the selected users, across all their sessions.
  app.get<{ Querystring: { userIds?: string } }>(
    '/api/llm-coding/utterances',
    async (req, reply) => {
      const userIds = (req.query.userIds ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (userIds.length === 0) return reply.code(400).send({ error: 'userIds required' });

      const sessions = await prisma.session.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true, userDisplayName: true },
      });
      const sessMeta = new Map(sessions.map((s) => [s.id, s]));
      const sessionIds = sessions.map((s) => s.id);

      const [chat, interventions] = await Promise.all([
        prisma.chatbotMessage.findMany({
          where: { sessionId: { in: sessionIds }, role: { in: ['user', 'USER'] } },
          orderBy: [{ sessionId: 'asc' }, { wallMs: 'asc' }],
        }),
        prisma.intervention.findMany({
          where: { sessionId: { in: sessionIds }, type: 'INTERROGATIVE_ELABORATION' },
        }),
      ]);

      type Row = {
        id: string;
        userId: string;
        user: string;
        sessionId: string;
        utterance: string;
        selectedText: string;
        source: string;
      };
      const rows: Row[] = [];
      for (const m of chat) {
        const s = sessMeta.get(m.sessionId);
        rows.push({
          id: `chat:${m.id}`,
          userId: s?.userId ?? '',
          user: s?.userDisplayName ?? s?.userId?.slice(0, 8) ?? '',
          sessionId: m.sessionId,
          utterance: m.content ?? '',
          selectedText: m.selectedText ?? '',
          source: 'free_chat',
        });
      }
      for (const iv of interventions) {
        const s = sessMeta.get(iv.sessionId);
        let d: any = {};
        try {
          d = JSON.parse(iv.sessionData ?? '{}');
        } catch {
          /* ignore */
        }
        const conv = Array.isArray(d?.conversation) ? d.conversation : [];
        conv.forEach((c: any, i: number) => {
          if ((c?.role ?? '').toLowerCase() !== 'user') return;
          rows.push({
            id: `elab:${iv.id}:${i}`,
            userId: s?.userId ?? '',
            user: s?.userDisplayName ?? s?.userId?.slice(0, 8) ?? '',
            sessionId: iv.sessionId,
            utterance: c?.content ?? '',
            selectedText: c?.selectedText ?? d?.selectedText ?? '',
            source: 'elaborative_interrogation',
          });
        });
      }
      rows.sort(
        (a, b) => a.userId.localeCompare(b.userId) || a.sessionId.localeCompare(b.sessionId),
      );
      return { utterances: rows.filter((r) => r.utterance.trim().length > 0) };
    },
  );

  // Code a batch of utterances with the researcher's provider/model/key.
  app.post<{
    Body: {
      provider?: 'openai' | 'gemini';
      model?: string;
      apiKey?: string;
      items?: CodeItem[];
    };
  }>('/api/llm-coding/code', async (req, reply) => {
    const { provider, model, apiKey, items } = req.body;
    if (!provider || !model || !apiKey)
      return reply.code(400).send({ error: 'provider, model, apiKey required' });
    if (!Array.isArray(items) || items.length === 0)
      return reply.code(400).send({ error: 'items required' });
    if (items.length > 50) return reply.code(400).send({ error: 'max 50 items per batch' });

    const call = provider === 'gemini' ? callGemini : callOpenAI;
    const results = await mapLimit(items, 4, async (it) => {
      try {
        const raw = await call(buildPrompt(it), model, apiKey);
        return { id: it.id, coding: normalise(raw), error: null as string | null };
      } catch (e) {
        return { id: it.id, coding: null, error: (e as Error).message };
      }
    });
    return { results };
  });
}

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

// Per-dimension definitions the researcher can edit in the studio before running.
export const DEFAULT_DEFINITIONS: Record<string, string> = {
  ef_inhibitory_control:
    'Suppressing a dominant/impulsive response; resisting distraction or a prepotent wrong step.',
  ef_working_memory:
    'Holding/juggling multiple pieces of information, or signs of working-memory load ("what was I doing").',
  ef_cognitive_flexibility: 'Switching strategy/approach or considering an alternative framing.',
  ef_planning: 'Stating a plan, a sequence of steps, or a goal for how to proceed.',
  ef_metacognitive_monitoring:
    'Awareness/appraisal of own understanding, or that something is right/wrong/incomplete.',
  ef_attention_regulation:
    'Reports of mind-wandering, refocusing, or (re)directing attention to the task.',
  affect_engaged_concentration: 'Focused, absorbed, on-task flow.',
  affect_confusion: 'Uncertainty/impasse; not knowing how to proceed (may be productive).',
  affect_frustration: 'Blocked goal, irritation, repeated failed attempts.',
  affect_boredom: 'Disengagement, low arousal, wandering attention.',
  affect_delight: 'Positive surprise / satisfaction / pleasure.',
  affect_surprise: 'Brief startle / reaction to something unexpected.',
  affect_anxiety: 'Worry, test/performance pressure, nervousness.',
  affect_neutral: 'No clear affect.',
  mot_self_efficacy: 'Belief about own capability to succeed at the task.',
  mot_task_value: 'Perceived importance/usefulness/interest of the task.',
  mot_intrinsic_motivation: 'Engagement for its own sake / curiosity / enjoyment.',
  mot_extrinsic_motivation: 'Grades, rewards, obligation, external pressure.',
  mot_mastery_goal_orientation: 'Aim to learn/understand/improve.',
  mot_performance_goal_orientation:
    'Aim to look able / outperform others / avoid looking incompetent.',
  mot_effort_regulation: 'Managing/sustaining effort and persistence despite difficulty.',
  strategy_practice_testing:
    'Self-testing, retrieval practice, quizzing, answering test questions.',
  strategy_distributed_practice: 'Spacing/revisiting material over time, review, flashcards.',
  strategy_stepwise_learning: 'Breaking the material into ordered steps / worked steps.',
  strategy_elaborative_interrogation:
    'Asking/answering "why/how" elaboration questions that connect ideas.',
};

// Editable template. Placeholders: {{SOURCE}} {{DEFINITIONS}} {{DIMENSION_KEYS}}
// {{UTTERANCE}} {{SELECTED_TEXT}}.
export const DEFAULT_TEMPLATE = `You are an expert educational-psychology coder. Code the single learner utterance below. The learner is a student interacting with a tutoring system. Context source: {{SOURCE}}.

Code each dimension 1 (present/evidenced in the utterance) or 0 (not). For the learning strategies, use BOTH the utterance and the highlighted selected text.

{{DEFINITIONS}}

Output STRICT JSON only (no prose). Return an object whose keys are EXACTLY these dimensions:
{{DIMENSION_KEYS}}
and whose value for EACH key is an object {"value": 0 or 1, "justification": "<= 30 words, specific to THIS dimension and THIS utterance, citing the textual evidence"}.

Learner utterance:
"""{{UTTERANCE}}"""

Selected text the learner had highlighted when sending this (may be empty):
"""{{SELECTED_TEXT}}"""`;

function definitionsBlock(defs: Record<string, string>): string {
  return CODED_DIMENSIONS.map((k) => `- ${k}: ${defs[k] ?? DEFAULT_DEFINITIONS[k] ?? ''}`).join(
    '\n',
  );
}

function buildAssessPrompt(defs: Record<string, string>): string {
  return `You are a measurement/psychometrics expert reviewing a text-based coding scheme for short learner utterances (chatbot + elaborative-interrogation). For EACH dimension below, judge whether a BINARY (0/1 present/absent) code is the appropriate response format when coding from short text, or whether a different scale would capture it better.

Consider: is the construct inherently graded / intensity-based (e.g. working-memory load, frustration severity), multi-category, or a count? Would binary be lossy or risk low inter-rater reliability? Is the construct even reliably recoverable from text (e.g. attention regulation has a published text ceiling of kappa ~0.21)?

Dimensions and definitions:
${definitionsBlock(defs)}

Output STRICT JSON only (no prose). Return an object whose keys are EXACTLY these dimensions:
${JSON.stringify(CODED_DIMENSIONS)}
and whose value for EACH key is an object:
{"binary_suitable": true or false, "suggested_scale": "<short, e.g. 'binary (0/1)', 'ordinal 0-3 intensity', '3-level load: low/med/high', 'categorical', 'count', 'confidence 0-1'>", "justification": "<= 40 words>"}.`;
}

function buildPrompt(
  item: { utterance: string; selectedText: string; source: string },
  template: string,
  defs: Record<string, string>,
): string {
  return template
    .replace(/\{\{SOURCE\}\}/g, item.source)
    .replace(/\{\{DEFINITIONS\}\}/g, definitionsBlock(defs))
    .replace(/\{\{DIMENSION_KEYS\}\}/g, JSON.stringify(CODED_DIMENSIONS))
    .replace(/\{\{UTTERANCE\}\}/g, item.utterance || '')
    .replace(/\{\{SELECTED_TEXT\}\}/g, item.selectedText || '');
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

const truthy = (v: unknown) =>
  v === 1 || v === '1' || v === true || String(v).toLowerCase() === 'yes' ? 1 : 0;

/** Normalise the LLM's raw JSON into {dimension: 0|1, dimension_justification: text}.
 * Accepts either nested {value, justification} per key or flat value + <key>_justification. */
function normalise(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CODED_DIMENSIONS) {
    const cell = raw[k];
    let v: unknown;
    let j: unknown;
    if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
      const o = cell as Record<string, unknown>;
      v = o.value ?? o.v ?? o.code;
      j = o.justification ?? o.j ?? o.rationale ?? o.reason;
    } else {
      v = cell;
      j = raw[`${k}_justification`] ?? raw[`${k}_rationale`];
    }
    out[k] = truthy(v);
    out[`${k}_justification`] = typeof j === 'string' ? j : '';
  }
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
  // expose the taxonomy + the editable default prompt so the studio can show and
  // let the researcher edit the per-dimension definitions before running.
  app.get('/api/llm-coding/dimensions', async () => ({
    dimensions: CODED_DIMENSIONS,
    groups: {
      executiveFunctions: EXECUTIVE_FUNCTIONS,
      affectiveStates: AFFECTIVE_STATES,
      motivation: MOTIVATION_DIMENSIONS,
      strategies: LEARNING_STRATEGIES,
    },
    template: DEFAULT_TEMPLATE,
    definitions: DEFAULT_DEFINITIONS,
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

  // Code a batch of utterances with the researcher's provider/model/key and
  // (optionally edited) prompt template + per-dimension definitions.
  app.post<{
    Body: {
      provider?: 'openai' | 'gemini';
      model?: string;
      apiKey?: string;
      items?: CodeItem[];
      template?: string;
      definitions?: Record<string, string>;
    };
  }>('/api/llm-coding/code', async (req, reply) => {
    const { provider, model, apiKey, items } = req.body;
    if (!provider || !model || !apiKey)
      return reply.code(400).send({ error: 'provider, model, apiKey required' });
    if (!Array.isArray(items) || items.length === 0)
      return reply.code(400).send({ error: 'items required' });
    if (items.length > 50) return reply.code(400).send({ error: 'max 50 items per batch' });

    const template =
      typeof req.body.template === 'string' && req.body.template.trim()
        ? req.body.template
        : DEFAULT_TEMPLATE;
    const definitions = { ...DEFAULT_DEFINITIONS, ...(req.body.definitions ?? {}) };

    const call = provider === 'gemini' ? callGemini : callOpenAI;
    const results = await mapLimit(items, 4, async (it) => {
      try {
        const raw = await call(buildPrompt(it, template, definitions), model, apiKey);
        return { id: it.id, coding: normalise(raw), error: null as string | null };
      } catch (e) {
        return { id: it.id, coding: null, error: (e as Error).message };
      }
    });
    return { results };
  });

  // One-off: ask the LLM whether a binary code fits each dimension, and if not,
  // suggest a better scale with justification.
  app.post<{
    Body: {
      provider?: 'openai' | 'gemini';
      model?: string;
      apiKey?: string;
      definitions?: Record<string, string>;
    };
  }>('/api/llm-coding/assess-scales', async (req, reply) => {
    const { provider, model, apiKey } = req.body;
    if (!provider || !model || !apiKey)
      return reply.code(400).send({ error: 'provider, model, apiKey required' });
    const definitions = { ...DEFAULT_DEFINITIONS, ...(req.body.definitions ?? {}) };
    const call = provider === 'gemini' ? callGemini : callOpenAI;
    try {
      const raw = await call(buildAssessPrompt(definitions), model, apiKey);
      const assessment: Record<string, unknown> = {};
      for (const k of CODED_DIMENSIONS) {
        const cell = (raw[k] ?? {}) as Record<string, unknown>;
        assessment[k] = {
          binary_suitable:
            cell.binary_suitable === false || String(cell.binary_suitable).toLowerCase() === 'false'
              ? false
              : true,
          suggested_scale: typeof cell.suggested_scale === 'string' ? cell.suggested_scale : '',
          justification: typeof cell.justification === 'string' ? cell.justification : '',
        };
      }
      return { assessment };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}

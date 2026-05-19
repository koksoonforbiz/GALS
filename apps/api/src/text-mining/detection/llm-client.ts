import { Logger } from '@nestjs/common';

const logger = new Logger('TextMiningLlmClient');

export interface DetectJsonArgs {
  provider: 'openai' | 'gemini';
  model: string;
  prompt: string;
  utterance: string;
  context?: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface DetectJsonResult {
  raw: string;
  parsed: Record<string, unknown> | null;
  latencyMs: number;
}

export async function detectJson(args: DetectJsonArgs): Promise<DetectJsonResult> {
  const { provider, model, prompt, utterance, context, apiKey, timeoutMs = 8000 } = args;
  const start = Date.now();

  let filledPrompt = prompt.replace('<<<INSERT_UTTERANCE>>>', utterance);
  if (context) {
    filledPrompt = filledPrompt.replace('<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>', context);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let raw: string;

    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: filledPrompt }],
          response_format: { type: 'json_object' },
          max_tokens: 200,
          temperature: 0,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      raw = json.choices?.[0]?.message?.content ?? '';
    } else {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: filledPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 200,
            temperature: 0,
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    try {
      const parsed = JSON.parse(raw);
      return { raw, parsed, latencyMs };
    } catch {
      logger.warn(`Failed to parse LLM JSON response: ${raw.slice(0, 200)}`);
      return { raw, parsed: null, latencyMs };
    }
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('abort')) {
      return { raw: '<timeout>', parsed: null, latencyMs };
    }

    logger.error(`Detection LLM call failed: ${message}`);
    return { raw: `<error: ${message.slice(0, 200)}>`, parsed: null, latencyMs };
  }
}

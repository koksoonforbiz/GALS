import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

/**
 * Mirror of `ChatModelSpec` from `apps/api/src/llm/model-registry.ts`.
 * Kept structural (not a shared package import) because `packages/shared`
 * is API-contract data, not API-internal types — and this is what the
 * `/llm/models` endpoint serializes.
 */
export interface ChatModelSpec {
  id: string;
  provider: 'openai' | 'gemini' | 'bedrock';
  label: string;
  capabilities: Array<'chat' | 'embedding' | 'vision'>;
  supportsTemperature: boolean;
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  supportsJsonMode: boolean;
  geminiThinkingParam?: 'thinking_level' | 'thinking_budget' | 'none';
  supportsOpenAiFilesApi?: boolean;
  deprecated?: boolean;
  retiresOn?: string;
}

export interface EmbeddingModelSpec {
  id: string;
  provider: 'openai' | 'gemini' | 'bedrock';
  label: string;
  dimensions: number;
  truncatableTo?: number[];
  deprecated?: boolean;
}

export interface LlmModelsResponse {
  chat: ChatModelSpec[];
  embedding: EmbeddingModelSpec[];
}

/**
 * Fetch the teacher-facing model registry projection from
 * `GET /llm/models`. Stage 2 of the LLM upgrade (LLM_20260602/) makes
 * this the single source of truth for both `AiSettingsPage.tsx` and
 * `DialogueCourseSettingsForm.tsx` — neither file ships a hard-coded
 * model list anymore.
 *
 * Returns the FULL registry (both providers). Components filter
 * client-side by the currently-selected provider — cheap, keeps the
 * dropdown responsive when the user flips providers, and means we only
 * hit the endpoint once per mount.
 */
export function useLlmModels(): {
  models: LlmModelsResponse | null;
  loading: boolean;
  error: string | null;
} {
  const [models, setModels] = useState<LlmModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<LlmModelsResponse>('/llm/models');
        if (!cancelled) setModels(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load model list');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading, error };
}

/**
 * Convenience: pick the first selectable chat model for a provider out
 * of a registry response. Used by the two settings forms to compute a
 * sensible default when the user flips the provider toggle and the
 * previously-selected model belongs to the other provider.
 */
export function recommendedChatModel(
  models: LlmModelsResponse | null,
  provider: 'openai' | 'gemini' | 'bedrock',
): ChatModelSpec | undefined {
  if (!models) return undefined;
  return (
    models.chat.find((m) => m.provider === provider && !m.deprecated) ??
    models.chat.find((m) => m.provider === provider)
  );
}

export function recommendedEmbeddingModel(
  models: LlmModelsResponse | null,
  provider: 'openai' | 'gemini' | 'bedrock',
): EmbeddingModelSpec | undefined {
  if (!models) return undefined;
  return (
    models.embedding.find((m) => m.provider === provider && !m.deprecated) ??
    models.embedding.find((m) => m.provider === provider)
  );
}

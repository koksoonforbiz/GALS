import {
  defaultChatModel,
  defaultEmbeddingModel,
  getChatModel,
  isSelectable,
  listChatModels,
  listEmbeddingModels,
  type LlmProvider,
} from './model-registry';

describe('LLM model registry', () => {
  // Stage 05 — `cohere` is now a registered provider for the
  // multimodal embedding spec (`embed-v4.0`) but it has no chat
  // default. `bedrock` has both (two chat models + one embedding
  // model — see model-registry.ts). Tests that iterate "chat
  // providers" cover openai/gemini/bedrock; tests that need to cover
  // ALL embedding providers iterate EMBEDDING_PROVIDERS instead.
  const PROVIDERS: LlmProvider[] = ['openai', 'gemini', 'bedrock'];
  const EMBEDDING_PROVIDERS: LlmProvider[] = ['openai', 'gemini', 'cohere', 'bedrock'];

  describe('chat defaults', () => {
    it.each(PROVIDERS)('default chat model for %s is selectable', (provider) => {
      const spec = defaultChatModel(provider);
      expect(spec).toBeDefined();
      expect(spec.provider).toBe(provider);
      expect(isSelectable(spec.id)).toBe(true);
    });

    it.each(PROVIDERS)(
      'default chat model for %s is not deprecated and not past-retired',
      (provider) => {
        const spec = defaultChatModel(provider);
        // We tolerate `deprecated: true` only if the model has no past
        // `retiresOn`. A "default" should not even be flagged deprecated
        // in practice, so assert the stronger condition.
        expect(spec.deprecated).not.toBe(true);
        if (spec.retiresOn) {
          expect(Date.parse(spec.retiresOn)).toBeGreaterThan(Date.now());
        }
      },
    );
  });

  describe('embedding defaults', () => {
    it.each(EMBEDDING_PROVIDERS)('default embedding model for %s is selectable', (provider) => {
      const spec = defaultEmbeddingModel(provider);
      expect(spec).toBeDefined();
      expect(spec.provider).toBe(provider);
      expect(isSelectable(spec.id)).toBe(true);
      expect(spec.deprecated).not.toBe(true);
    });
  });

  describe('retirement enforcement', () => {
    it('gemini-2.0-flash is deprecated AND has a past retiresOn', () => {
      const spec = getChatModel('gemini-2.0-flash');
      expect(spec).toBeDefined();
      expect(spec!.deprecated).toBe(true);
      expect(spec!.retiresOn).toBeDefined();
      expect(Date.parse(spec!.retiresOn!)).toBeLessThanOrEqual(Date.now());
    });

    it('isSelectable() returns false for gemini-2.0-flash today', () => {
      expect(isSelectable('gemini-2.0-flash')).toBe(false);
    });

    it("no past-retired model is anyone's default", () => {
      for (const provider of PROVIDERS) {
        const chatDef = defaultChatModel(provider);
        expect(isSelectable(chatDef.id)).toBe(true);
        const embedDef = defaultEmbeddingModel(provider);
        expect(isSelectable(embedDef.id)).toBe(true);
      }
    });
  });

  describe('provider/id consistency', () => {
    it("every chat spec's id family matches its declared provider", () => {
      for (const spec of listChatModels()) {
        if (spec.provider === 'openai') {
          // OpenAI chat ids start with `gpt-`.
          expect(spec.id.startsWith('gpt-')).toBe(true);
        } else if (spec.provider === 'gemini') {
          expect(spec.id.startsWith('gemini-')).toBe(true);
        } else if (spec.provider === 'bedrock') {
          // Bedrock chat model ids are inference profile ids, not
          // OpenAI API model strings — these OpenAI-hosted-on-Bedrock
          // models reject on-demand invocation by the bare
          // foundation-model id, so the app calls them by their
          // `global.<name>` profile id instead (confirmed against the
          // real endpoint — see model-registry.ts's Bedrock section).
          expect(spec.id.startsWith('global.openai.')).toBe(true);
        }
      }
    });

    it("every embedding spec's id family matches its declared provider", () => {
      for (const spec of listEmbeddingModels()) {
        if (spec.provider === 'openai') {
          // OpenAI embedding ids start with `text-embedding-`.
          expect(spec.id.startsWith('text-embedding-')).toBe(true);
        } else if (spec.provider === 'gemini') {
          expect(spec.id.startsWith('gemini-')).toBe(true);
        } else if (spec.provider === 'cohere') {
          // Stage 05 — Cohere Embed family ids begin with `embed-`.
          expect(spec.id.startsWith('embed-')).toBe(true);
        } else if (spec.provider === 'bedrock') {
          // Bedrock's Cohere Embed 4 spec uses the Bedrock model id
          // (resource-name segment of its foundation-model ARN).
          expect(spec.id.startsWith('cohere.')).toBe(true);
        }
      }
    });
  });

  describe('capability flags', () => {
    it('GPT-5.x chat models forbid temperature and use max_completion_tokens', () => {
      for (const spec of listChatModels('openai')) {
        if (spec.id.startsWith('gpt-5')) {
          expect(spec.supportsTemperature).toBe(false);
          expect(spec.maxTokensParam).toBe('max_completion_tokens');
        }
      }
    });

    it('GPT-4.x chat models allow temperature and use max_tokens', () => {
      for (const spec of listChatModels('openai')) {
        if (spec.id.startsWith('gpt-4')) {
          expect(spec.supportsTemperature).toBe(true);
          expect(spec.maxTokensParam).toBe('max_tokens');
        }
      }
    });

    it('Gemini 3.x uses thinking_level; Gemini 2.x uses thinking_budget', () => {
      for (const spec of listChatModels('gemini')) {
        if (spec.id.startsWith('gemini-3')) {
          expect(spec.geminiThinkingParam).toBe('thinking_level');
        } else if (spec.id.startsWith('gemini-2')) {
          expect(spec.geminiThinkingParam).toBe('thinking_budget');
        }
      }
    });

    it('Gemini chat models never claim OpenAI Files API support', () => {
      for (const spec of listChatModels('gemini')) {
        expect(spec.supportsOpenAiFilesApi).toBe(false);
      }
    });

    it('every chat model supports JSON mode', () => {
      // Per the reference doc — both providers expose structured-output
      // controls across the supported set.
      for (const spec of listChatModels()) {
        expect(spec.supportsJsonMode).toBe(true);
      }
    });
  });

  describe('listing helpers', () => {
    it('listChatModels() without filter returns all models', () => {
      const all = listChatModels();
      const openai = listChatModels('openai');
      const gemini = listChatModels('gemini');
      const bedrock = listChatModels('bedrock');
      expect(all.length).toBe(openai.length + gemini.length + bedrock.length);
      expect(openai.length).toBeGreaterThan(0);
      expect(gemini.length).toBeGreaterThan(0);
      expect(bedrock.length).toBeGreaterThan(0);
    });

    it('listEmbeddingModels() filter returns only one provider', () => {
      for (const provider of EMBEDDING_PROVIDERS) {
        const list = listEmbeddingModels(provider);
        expect(list.length).toBeGreaterThan(0);
        for (const spec of list) {
          expect(spec.provider).toBe(provider);
        }
      }
    });
  });

  // ─── Stage 4 — regression guards ────────────────────────
  //
  // These tests are intentionally STRICT so a future registry edit that
  // forgets a required field, accidentally retires a default, or skips a
  // capability flag fails CI loudly. The goal is "future maintainers
  // can't add a model without declaring its call shape".

  describe('regression guards', () => {
    it('no selectable chat default is deprecated or past-retired', () => {
      for (const provider of PROVIDERS) {
        const def = defaultChatModel(provider);
        // Defaults must not be flagged deprecated.
        expect(def.deprecated).not.toBe(true);
        // And if they declare a retiresOn it must be in the future.
        if (def.retiresOn) {
          expect(Date.parse(def.retiresOn)).toBeGreaterThan(Date.now());
        }
        // And they must be selectable today.
        expect(isSelectable(def.id)).toBe(true);
      }
    });

    it('no selectable embedding default is deprecated', () => {
      for (const provider of PROVIDERS) {
        const def = defaultEmbeddingModel(provider);
        expect(def.deprecated).not.toBe(true);
        expect(isSelectable(def.id)).toBe(true);
      }
    });

    it('every chat spec declares provider, maxTokensParam, supportsTemperature, supportsJsonMode (well-typed)', () => {
      // Forces future model additions to make a deliberate decision about
      // each capability flag — Stage 4 regression guard.
      for (const spec of listChatModels()) {
        // provider
        expect(['openai', 'gemini', 'bedrock']).toContain(spec.provider);
        // id is non-empty
        expect(typeof spec.id).toBe('string');
        expect(spec.id.length).toBeGreaterThan(0);
        // label is non-empty
        expect(typeof spec.label).toBe('string');
        expect(spec.label.length).toBeGreaterThan(0);
        // capabilities is a non-empty array including 'chat'
        expect(Array.isArray(spec.capabilities)).toBe(true);
        expect(spec.capabilities.length).toBeGreaterThan(0);
        expect(spec.capabilities).toContain('chat');
        // maxTokensParam is one of the two known values
        expect(['max_tokens', 'max_completion_tokens']).toContain(spec.maxTokensParam);
        // supportsTemperature is a real boolean (not undefined)
        expect(typeof spec.supportsTemperature).toBe('boolean');
        // supportsJsonMode is a real boolean
        expect(typeof spec.supportsJsonMode).toBe('boolean');
      }
    });

    it('every Gemini chat spec declares geminiThinkingParam; OpenAI specs do not require it', () => {
      for (const spec of listChatModels('gemini')) {
        // Must be one of the three known values.
        expect(['thinking_level', 'thinking_budget', 'none']).toContain(spec.geminiThinkingParam);
      }
    });

    it('every chat spec declares supportsOpenAiFilesApi (boolean)', () => {
      // Required for the multimodal-pdf branch to choose between native
      // Files API and Gemini-fallback chunked-text RAG.
      for (const spec of listChatModels()) {
        expect(typeof spec.supportsOpenAiFilesApi).toBe('boolean');
      }
    });

    it('every embedding spec declares positive integer dimensions', () => {
      for (const spec of listEmbeddingModels()) {
        expect(typeof spec.dimensions).toBe('number');
        expect(Number.isInteger(spec.dimensions)).toBe(true);
        expect(spec.dimensions).toBeGreaterThan(0);
        if (spec.truncatableTo) {
          expect(Array.isArray(spec.truncatableTo)).toBe(true);
          for (const dim of spec.truncatableTo) {
            expect(Number.isInteger(dim)).toBe(true);
            expect(dim).toBeGreaterThan(0);
          }
        }
      }
    });
  });
});

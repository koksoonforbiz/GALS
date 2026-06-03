/**
 * Stage 06 — FaithfulnessCheckService unit tests.
 *
 * Contract:
 *  1. Empty answer ⇒ judgeRan=false, supported=true (nothing to judge).
 *  2. Empty context ⇒ judgeRan=false, supported=true (no ground truth).
 *  3. Judge says supported=true ⇒ outcome reports same, claims empty.
 *  4. Judge says supported=false ⇒ outcome reports same, claims forwarded.
 *  5. Judge call throws ⇒ supported=true, judgeRan=false (defensive).
 *  6. Judge returns unparseable JSON ⇒ supported=true, judgeRan=true.
 *  7. Code-fence-wrapped JSON gets unwrapped.
 *  8. buildFaithfulnessRetryAddendum lists the unsupported claims.
 */

import {
  FaithfulnessCheckService,
  buildFaithfulnessRetryAddendum,
} from './faithfulness-check.service';
import type { LlmService } from '../llm.service';

function makeLlmServiceMock(responseContent: string | (() => Promise<unknown>)): LlmService {
  const callLlmStructured = jest.fn(async () => {
    if (typeof responseContent === 'function') {
      return (await responseContent()) as ReturnType<LlmService['callLlmStructured']>;
    }
    return {
      content: responseContent,
      promptTokens: 1,
      completionTokens: 1,
      model: 'mock',
      provider: 'mock',
    };
  });
  return { callLlmStructured } as unknown as LlmService;
}

describe('FaithfulnessCheckService', () => {
  it('returns supported=true / judgeRan=false on empty answer', async () => {
    const llm = makeLlmServiceMock('whatever');
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: '',
      context: 'some context',
      teacherId: 't1',
    });
    expect(out.supported).toBe(true);
    expect(out.judgeRan).toBe(false);
    expect(llm.callLlmStructured).not.toHaveBeenCalled();
  });

  it('returns supported=true / judgeRan=false on empty context', async () => {
    const llm = makeLlmServiceMock('whatever');
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'some answer',
      context: '',
      teacherId: 't1',
    });
    expect(out.supported).toBe(true);
    expect(out.judgeRan).toBe(false);
    expect(llm.callLlmStructured).not.toHaveBeenCalled();
  });

  it('forwards judge "supported=true" verdict and clears claims', async () => {
    const llm = makeLlmServiceMock(
      JSON.stringify({ supported: true, unsupportedClaims: [] }),
    );
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'water boils at 100C',
      context: 'water boils at 100C at sea level',
      teacherId: 't1',
    });
    expect(out.supported).toBe(true);
    expect(out.judgeRan).toBe(true);
    expect(out.unsupportedClaims).toEqual([]);
  });

  it('forwards judge "supported=false" verdict and propagates claims', async () => {
    const llm = makeLlmServiceMock(
      JSON.stringify({
        supported: false,
        unsupportedClaims: ['water freezes at -10C', 'pi equals 3'],
      }),
    );
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'water freezes at -10C and pi equals 3',
      context: 'water boils at 100C',
      teacherId: 't1',
    });
    expect(out.supported).toBe(false);
    expect(out.unsupportedClaims).toEqual(['water freezes at -10C', 'pi equals 3']);
  });

  it('defensively returns supported=true when judge throws', async () => {
    const llm = makeLlmServiceMock(() => {
      throw new Error('provider 500');
    });
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'something',
      context: 'something else',
      teacherId: 't1',
    });
    expect(out.supported).toBe(true);
    expect(out.judgeRan).toBe(false);
  });

  it('defensively returns supported=true when judge returns unparseable JSON', async () => {
    const llm = makeLlmServiceMock('not actually json');
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'something',
      context: 'something else',
      teacherId: 't1',
    });
    expect(out.supported).toBe(true);
    expect(out.judgeRan).toBe(true);
  });

  it('unwraps code-fence-wrapped JSON', async () => {
    const llm = makeLlmServiceMock(
      '```json\n{"supported": false, "unsupportedClaims": ["x"]}\n```',
    );
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'x',
      context: 'y',
      teacherId: 't1',
    });
    expect(out.supported).toBe(false);
    expect(out.unsupportedClaims).toEqual(['x']);
  });

  it('strips non-string entries from unsupportedClaims defensively', async () => {
    const llm = makeLlmServiceMock(
      JSON.stringify({
        supported: false,
        unsupportedClaims: ['ok', 42, null, { weird: true }, 'also ok'],
      }),
    );
    const svc = new FaithfulnessCheckService(llm);
    const out = await svc.checkFaithfulness({
      answer: 'x',
      context: 'y',
      teacherId: 't1',
    });
    expect(out.unsupportedClaims).toEqual(['ok', 'also ok']);
  });
});

describe('buildFaithfulnessRetryAddendum', () => {
  it('includes the literal "FAITHFULNESS RETRY" marker', () => {
    const a = buildFaithfulnessRetryAddendum(['pi equals 3']);
    expect(a).toContain('FAITHFULNESS RETRY');
  });

  it('lists each unsupported claim with bullet + quotes', () => {
    const a = buildFaithfulnessRetryAddendum(['claim one', 'claim two']);
    expect(a).toContain('- "claim one"');
    expect(a).toContain('- "claim two"');
  });

  it('falls back to a placeholder when no claims were listed', () => {
    const a = buildFaithfulnessRetryAddendum([]);
    expect(a).toContain('- (judge did not list specific claims)');
  });

  it('instructs the model to refuse explicitly for unsupported parts', () => {
    const a = buildFaithfulnessRetryAddendum(['x']);
    expect(a).toContain('refuse explicitly');
  });
});

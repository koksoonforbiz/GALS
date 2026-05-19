import { DEFAULT_PROMPTS } from './default-prompts';

export function buildDistributedPracticePrompt(
  systemPrompt: string,
  selectedText: string,
  cardCount: number,
) {
  const resolvedSystem = systemPrompt.replace(/\{\{cardCount\}\}/g, String(cardCount));

  const userPrompt = DEFAULT_PROMPTS.DISTRIBUTED_PRACTICE.userPromptTemplate
    .replace(/\{\{cardCount\}\}/g, String(cardCount))
    .replace(/\{\{selectedText\}\}/g, selectedText);

  return { system: resolvedSystem, user: userPrompt };
}

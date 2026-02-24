import { DEFAULT_PROMPTS } from './default-prompts';

export function buildPracticeTestingPrompt(
  systemPrompt: string,
  selectedText: string,
  questionCount: number,
) {
  const resolvedSystem = systemPrompt.replace(/\{\{questionCount\}\}/g, String(questionCount));

  const userPrompt = DEFAULT_PROMPTS.PRACTICE_TESTING.userPromptTemplate
    .replace(/\{\{questionCount\}\}/g, String(questionCount))
    .replace(/\{\{selectedText\}\}/g, selectedText);

  return { system: resolvedSystem, user: userPrompt };
}

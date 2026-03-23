import { DEFAULT_PROMPTS } from './default-prompts';

/**
 * Step generation prompt (customizable by teacher).
 */
export function buildStepwiseLearningPrompt(systemPrompt: string, selectedText: string) {
  return {
    system: systemPrompt,
    user: DEFAULT_PROMPTS.STEPWISE_LEARNING.userPromptTemplate.replace(
      /\{\{selectedText\}\}/g,
      selectedText,
    ),
  };
}

/**
 * Comprehension check evaluation prompt (fixed, not teacher-customizable).
 */
export function buildStepCheckPrompt(params: {
  stepTitle: string;
  stepContent: string;
  question: string;
  sampleAnswer: string;
  userResponse: string;
}) {
  return {
    system: `You are a supportive tutor evaluating a learner's comprehension check response. Be encouraging and constructive.

Return ONLY valid JSON with no markdown or extra text:
{
  "isCorrect": true | false,
  "feedback": "2-3 sentences of specific, encouraging feedback.",
  "encouragement": "Brief motivational note (1 sentence)"
}

Rules:
- Be generous — if the learner shows understanding of the core concept, mark correct even if wording differs
- Never just say "wrong" — explain what to reconsider
- Reference specific parts of their response
- Keep feedback concise and actionable`,

    user: `Step: "${params.stepTitle}"
Step content: "${params.stepContent}"
Question: "${params.question}"
Expected answer: "${params.sampleAnswer}"
Learner's response: "${params.userResponse}"`,
  };
}

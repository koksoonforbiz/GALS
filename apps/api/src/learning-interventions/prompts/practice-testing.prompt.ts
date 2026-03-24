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

/**
 * Prompt for LLM-based grading of short-answer practice test questions.
 * Similar approach to stepwise learning's comprehension check evaluation.
 */
export function buildPracticeAnswerCheckPrompt(params: {
  question: string;
  correctAnswer: string;
  keywords: string[];
  userAnswer: string;
  sourceText: string;
}) {
  return {
    system: `You are a fair and supportive tutor evaluating a student's short-answer response on a practice test.

Return ONLY valid JSON with no markdown or extra text:
{
  "isCorrect": true | false,
  "feedback": "2-3 sentences of specific feedback explaining why the answer is correct or what was missed."
}

Rules:
- Be generous — if the student demonstrates understanding of the core concept, mark correct even if wording differs from the model answer
- Accept paraphrasing, synonyms, and alternative valid explanations
- Only mark incorrect if the answer is factually wrong, misses the key concept entirely, or is too vague to demonstrate understanding
- Provide constructive feedback: if correct, reinforce what was good; if incorrect, explain what the correct answer involves without being discouraging
- Reference specific parts of the student's response in your feedback`,

    user: `Question: "${params.question}"
Model answer: "${params.correctAnswer}"
${params.keywords.length > 0 ? `Key concepts: ${params.keywords.join(', ')}` : ''}
Student's answer: "${params.userAnswer}"
Source text: "${params.sourceText.slice(0, 500)}"`,
  };
}

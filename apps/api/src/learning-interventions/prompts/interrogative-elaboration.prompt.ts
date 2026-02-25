import { DEFAULT_PROMPTS } from './default-prompts';

/**
 * Question generation prompt (customizable by teacher).
 */
export function buildElaborationQuestionsPrompt(
  systemPrompt: string,
  selectedText: string,
  questionCount: number,
) {
  const resolvedSystem = systemPrompt.replace(/\{\{questionCount\}\}/g, String(questionCount));

  const userPrompt = DEFAULT_PROMPTS.INTERROGATIVE_ELABORATION.userPromptTemplate
    .replace(/\{\{questionCount\}\}/g, String(questionCount))
    .replace(/\{\{selectedText\}\}/g, selectedText);

  return { system: resolvedSystem, user: userPrompt };
}

/**
 * Evaluation prompt (fixed — not teacher-customizable).
 * Evaluates a learner's free-text elaboration against key points.
 */
export function buildElaborationEvaluationPrompt(params: {
  question: string;
  userElaboration: string;
  keyPoints: string[];
  sourceText: string;
}) {
  return {
    system: `You are evaluating a learner's elaborative response. Compare their elaboration against the key points and source text. Be encouraging but honest.

Return ONLY valid JSON with no markdown or extra text:
{
  "rating": "Strong" | "Developing" | "Needs Improvement",
  "addressedPoints": ["points the learner covered well"],
  "missedPoints": ["points the learner did not address"],
  "feedback": "Specific, encouraging feedback. 2-3 sentences.",
  "modelElaboration": "A model answer. 2-4 sentences."
}

Rating criteria:
- "Strong": Addresses most key points with clear reasoning
- "Developing": Addresses some key points but missing depth
- "Needs Improvement": Misses most key points or surface-level`,

    user: `Question: "${params.question}"
Learner's elaboration: "${params.userElaboration}"
Key points to look for: ${JSON.stringify(params.keyPoints)}
Source text: "${params.sourceText}"`,
  };
}

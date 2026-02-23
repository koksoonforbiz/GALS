/**
 * Stepwise Learning Prompts
 *
 * Breaks down complex text into sequential learning steps
 * with comprehension checks for each step.
 */

export interface ComprehensionCheck {
  question: string;
  hint: string;
  sampleAnswer: string;
}

export interface LearningStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck: ComprehensionCheck;
}

export interface StepwiseLearningResponse {
  steps: LearningStep[];
  summary: string;
}

export interface StepCheckEvaluationResponse {
  isCorrect: boolean;
  feedback: string;
  encouragement: string;
}

/**
 * Build the prompt for generating stepwise learning content
 */
export function buildStepwiseLearningPrompt(selectedText: string): {
  system: string;
  user: string;
} {
  return {
    system: `You are a pedagogical expert skilled at scaffolded instruction. Break down the given text into a sequence of small, progressive learning steps. Each step should:
1. Explain ONE concept or idea clearly and concisely
2. Build logically on the previous step
3. Include a comprehension check question that tests understanding of that step

Return ONLY valid JSON with no markdown or extra text:
{
  "steps": [
    {
      "stepNumber": 1,
      "title": "Short descriptive title",
      "content": "Clear explanation of this concept. Should be 2-4 sentences. Use simple language and concrete examples where possible.",
      "comprehensionCheck": {
        "question": "A question testing whether the learner understood this step",
        "hint": "A helpful hint if they get stuck",
        "sampleAnswer": "What a good answer to this question would look like"
      }
    }
  ],
  "summary": "A 2-3 sentence wrap-up that ties all the steps together and reinforces the big picture."
}

Rules:
- Generate 3-6 steps depending on the complexity of the text
- Each step should be self-contained but connected to the overall flow
- Content should paraphrase and simplify, not just copy the source text
- Comprehension checks should require understanding, not just recall
- Hints should guide without giving away the answer
- The summary should help the learner see how all pieces connect`,

    user: `Break this text into stepwise learning chunks:\n\n"${selectedText}"`,
  };
}

/**
 * Build the prompt for evaluating a comprehension check response
 */
export function buildStepCheckPrompt(params: {
  stepTitle: string;
  stepContent: string;
  question: string;
  sampleAnswer: string;
  userResponse: string;
}): { system: string; user: string } {
  return {
    system: `You are a supportive tutor evaluating a learner's response to a comprehension check question. Be encouraging and constructive.

Return ONLY valid JSON with no markdown or extra text:
{
  "isCorrect": true | false,
  "feedback": "2-3 sentences of specific, encouraging feedback. If correct, reinforce why. If incorrect, gently guide toward the right understanding without giving the full answer.",
  "encouragement": "A brief motivational note (1 sentence)"
}

Rules:
- Be generous — if the learner demonstrates understanding of the core concept, mark as correct even if wording differs from the sample answer
- Never just say "wrong" — always explain what aspect they should reconsider
- Reference specific parts of their response in your feedback
- Keep feedback concise and actionable`,

    user: `Step: "${params.stepTitle}"

Step content: "${params.stepContent}"

Question: "${params.question}"

Expected answer: "${params.sampleAnswer}"

Learner's response: "${params.userResponse}"`,
  };
}

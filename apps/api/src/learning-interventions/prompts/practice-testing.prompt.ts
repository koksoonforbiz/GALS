/**
 * Practice Testing Prompt
 *
 * Generates quiz questions (MCQ + short answer) from selected text
 * to test learner comprehension.
 */

export interface PracticeTestQuestion {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[]; // For MCQ: ["A) ...", "B) ...", "C) ...", "D) ..."]
  correctAnswer: string; // For MCQ: "A", "B", "C", or "D"; For short_answer: the answer text
  explanation: string;
  keywords?: string[]; // For short_answer: keywords to check in the answer
}

export interface PracticeTestResponse {
  questions: PracticeTestQuestion[];
}

export function buildPracticeTestingPrompt(
  selectedText: string,
  questionCount: number,
): { system: string; user: string } {
  return {
    system: `You are an educational assessment expert. Generate quiz questions from the provided text to test a learner's comprehension. Return a mix of multiple-choice questions (MCQ) and short-answer questions.

Return ONLY valid JSON in this exact format, with no markdown or extra text:
{
  "questions": [
    {
      "question": "...",
      "type": "mcq",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correctAnswer": "A",
      "explanation": "This is correct because..."
    },
    {
      "question": "...",
      "type": "short_answer",
      "correctAnswer": "...",
      "explanation": "...",
      "keywords": ["key1", "key2"]
    }
  ]
}

Rules:
- Generate exactly ${questionCount} questions
- Mix of MCQ and short answer (roughly 60% MCQ, 40% short answer)
- Questions should test comprehension, not just surface recall
- Each MCQ must have exactly 4 options labeled A), B), C), D)
- For MCQ, correctAnswer must be exactly one letter: "A", "B", "C", or "D"
- Explanations should be educational and reference the source text
- For short answers, include 2-4 keywords that a correct answer should contain
- Make questions progressively harder: start with recall, move to application/analysis`,

    user: `Generate ${questionCount} quiz questions from this text:

"${selectedText}"`,
  };
}

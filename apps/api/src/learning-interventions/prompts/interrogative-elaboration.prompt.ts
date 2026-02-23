/**
 * Interrogative Elaboration Prompts
 *
 * Generates "why" and "how" questions to deepen understanding,
 * then evaluates the learner's elaborative responses.
 */

export interface ElaborationQuestion {
  question: string;
  type: 'why' | 'how';
  keyPoints: string[];
}

export interface ElaborationQuestionsResponse {
  questions: ElaborationQuestion[];
}

export interface ElaborationEvaluationResponse {
  rating: 'Strong' | 'Developing' | 'Needs Improvement';
  addressedPoints: string[];
  missedPoints: string[];
  feedback: string;
  modelElaboration: string;
}

/**
 * Build the prompt for generating elaboration questions
 */
export function buildElaborationQuestionsPrompt(
  selectedText: string,
  questionCount: number,
): { system: string; user: string } {
  return {
    system: `You are an expert in elaborative interrogation, a learning strategy where learners deepen understanding by answering "why" and "how" questions about factual statements. Given a text passage, generate probing questions that require the learner to explain underlying reasons, mechanisms, and connections.

Return ONLY valid JSON with no markdown or extra text:
{
  "questions": [
    {
      "question": "Why is it important that...",
      "type": "why",
      "keyPoints": [
        "Point the learner should address",
        "Another expected insight",
        "A third key concept"
      ]
    },
    {
      "question": "How does...",
      "type": "how",
      "keyPoints": [
        "Expected mechanism or process",
        "Key relationship to identify"
      ]
    }
  ]
}

Rules:
- Generate exactly ${questionCount} questions
- Mix of "why" and "how" questions (roughly 50/50)
- Each question should require genuine reasoning, not just recall
- Include 2-4 key points per question that a strong elaboration should address
- Questions should probe cause-effect relationships, mechanisms, significance, and connections`,

    user: `Generate ${questionCount} interrogative elaboration questions from this text:\n\n"${selectedText}"`,
  };
}

/**
 * Build the prompt for evaluating a learner's elaboration
 */
export function buildElaborationEvaluationPrompt(params: {
  question: string;
  userElaboration: string;
  keyPoints: string[];
  sourceText: string;
}): { system: string; user: string } {
  return {
    system: `You are evaluating a learner's elaborative response. Compare their elaboration against the key points and source text. Be encouraging but honest.

Return ONLY valid JSON with no markdown or extra text:
{
  "rating": "Strong" | "Developing" | "Needs Improvement",
  "addressedPoints": ["points the learner covered well"],
  "missedPoints": ["points the learner did not address"],
  "feedback": "Specific, encouraging feedback explaining what was good and what to improve. 2-3 sentences.",
  "modelElaboration": "A model answer showing what a strong elaboration would look like. 2-4 sentences."
}

Rating criteria:
- "Strong": Addresses most key points with clear reasoning and connections
- "Developing": Addresses some key points but missing important aspects or lacks depth
- "Needs Improvement": Misses most key points or provides surface-level response`,

    user: `Question: "${params.question}"

Learner's elaboration: "${params.userElaboration}"

Key points to look for: ${JSON.stringify(params.keyPoints)}

Source text: "${params.sourceText}"`,
  };
}

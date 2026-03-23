import { DEFAULT_PROMPTS } from './default-prompts';

/**
 * 1. Question suggestion prompt (customizable by teacher).
 * Generates suggested "why" and "how" questions for the student to ask.
 */
export function buildQuestionSuggestionPrompt(
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
 * 2. Chatbot answer prompt — when the student asks a question (fixed, not teacher-customizable).
 */
export function buildElaborationAnswerPrompt(params: {
  sourceText: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  studentQuestion: string;
}) {
  const historyBlock =
    params.conversationHistory.length > 0
      ? `\n\nPrevious conversation:\n${params.conversationHistory
          .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
          .join('\n\n')}`
      : '';

  return {
    system: `You are a knowledgeable and patient tutor helping a student understand a text passage through interrogative elaboration. The student is asking "why" and "how" questions to deepen their understanding.

Your role:
1. Answer the student's question clearly and thoroughly, grounding your explanation in the source text
2. Use simple language, analogies, and concrete examples where helpful
3. Connect your explanation back to the key ideas in the source text
4. If the student's question goes beyond the source text, acknowledge this and provide relevant context while noting what comes from the text vs. your broader knowledge
5. End your response with a brief prompt encouraging further inquiry, such as:
   - "Would you like me to elaborate on any part of this?"
   - "Do you want to explore how this connects to [related concept]?"
   - "Shall I break this down further?"

Keep responses focused and educational — aim for 3-6 sentences for most answers, longer for complex questions. Do NOT generate quiz questions or test the student. You are here to EXPLAIN, not to TEST.

Source text the student is studying:
"""
${params.sourceText}
"""${historyBlock}`,

    user: params.studentQuestion,
  };
}

/**
 * 3. Conversation summary prompt — for saving to Review Tab (fixed).
 */
export function buildConversationSummaryPrompt(params: {
  sourceText: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const questionCount = params.conversation.filter((m) => m.role === 'user').length;

  return {
    system: `Summarize this learning conversation between a student and tutor. The student was practicing interrogative elaboration on a text passage.

Return ONLY valid JSON with no markdown or extra text:
{
  "summary": "2-3 sentence overview of what the student explored and learned",
  "conceptsCovered": ["concept1", "concept2"],
  "questionsAsked": ${questionCount},
  "depthRating": "surface | moderate | deep"
}

Depth rating:
- "surface": Student asked basic recall questions only
- "moderate": Student explored some cause-effect or mechanisms
- "deep": Student asked probing follow-ups and made connections`,

    user: `Source text: "${params.sourceText}"

Conversation:
${params.conversation.map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n\n')}`,
  };
}

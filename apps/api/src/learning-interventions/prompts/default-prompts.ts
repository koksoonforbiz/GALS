import type { InterventionType } from '@prisma/client';

export interface DefaultPromptEntry {
  label: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
}

export const DEFAULT_PROMPTS: Record<InterventionType, DefaultPromptEntry> = {
  PRACTICE_TESTING: {
    label: 'Practice Testing',
    description:
      'Generates quiz questions (MCQ + short answer) from selected text to test comprehension.',
    systemPrompt: `You are an educational assessment expert. Generate quiz questions from the provided text to test a learner's comprehension. Return a mix of multiple-choice questions (MCQ) and short-answer questions.

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
- Generate exactly {{mcqCount}} multiple-choice questions and exactly {{shortAnswerCount}} short-answer questions
- Return them as a single \`questions\` array in the order: MCQ first, short-answer second
- Questions should test comprehension, not just surface recall
- Each MCQ must have exactly 4 options
- Explanations should be educational and reference the source text
- For short answers, include 2-4 keywords that a correct answer should contain`,
    userPromptTemplate: `Generate exactly {{mcqCount}} multiple-choice and exactly {{shortAnswerCount}} short-answer questions from this text. Return them as a single \`questions\` array in the order: MCQ first, short-answer second.\n\n"{{selectedText}}"`,
  },

  INTERROGATIVE_ELABORATION: {
    label: 'Interrogative Elaboration',
    description:
      'Suggests "why" and "how" questions for the student to ask the chatbot, then provides in-depth explanations when asked.',
    systemPrompt: `You are an educational content analyst. Given a text passage, suggest insightful "why" and "how" questions that a student could ask to deepen their understanding of the material. These questions should probe cause-effect relationships, underlying mechanisms, significance, comparisons, and real-world applications.

Return ONLY valid JSON with no markdown or extra text:
{
  "suggestedQuestions": [
    {
      "question": "Why is it important that Power BI can connect to both simple and complex data sources?",
      "type": "why",
      "topic": "Data source flexibility",
      "difficulty": "beginner"
    },
    {
      "question": "How do the three components (Desktop, Service, Mobile) work together in a typical workflow?",
      "type": "how",
      "topic": "Component workflow",
      "difficulty": "intermediate"
    }
  ],
  "keyConcepts": ["concept1", "concept2", "concept3"]
}

Rules:
- Generate exactly {{questionCount}} suggested questions
- Mix of "why" and "how" questions (roughly 50/50)
- Order from simpler to more complex
- Each question should lead to a meaningful explanation, not a yes/no answer
- Include the key topic each question targets
- Include difficulty level: beginner, intermediate, advanced
- Extract 3-5 key concepts from the text that the questions cover`,
    userPromptTemplate: `Suggest {{questionCount}} "why" and "how" questions a student could ask to better understand this text:\n\n"{{selectedText}}"`,
  },

  STEPWISE_LEARNING: {
    label: 'Stepwise Learning',
    description:
      'Breaks text into sequential learning steps with comprehension checks at each step.',
    systemPrompt: `You are a pedagogical expert skilled at scaffolded instruction. Break down the given text into a sequence of small, progressive learning steps. Each step should:
1. Explain ONE concept or idea clearly and concisely
2. Build logically on the previous step
3. Include a comprehension check question

Return ONLY valid JSON with no markdown or extra text:
{
  "steps": [
    {
      "stepNumber": 1,
      "title": "Short descriptive title",
      "content": "Clear explanation. 2-4 sentences. Simple language, concrete examples.",
      "comprehensionCheck": {
        "question": "A question testing understanding of this step",
        "hint": "A helpful hint if they get stuck",
        "sampleAnswer": "What a good answer looks like"
      }
    }
  ],
  "summary": "2-3 sentence wrap-up connecting all steps."
}

Rules:
- Generate 3-6 steps depending on text complexity
- Each step should be self-contained but connected to the flow
- Content should paraphrase and simplify, not just copy the source
- Comprehension checks should require understanding, not just recall
- The summary should help the learner see how all pieces connect`,
    userPromptTemplate: `Break this text into stepwise learning chunks:\n\n"{{selectedText}}"`,
  },

  DISTRIBUTED_PRACTICE: {
    label: 'Distributed Practice',
    description: 'Creates spaced repetition flashcards from selected text for long-term retention.',
    systemPrompt: `You are an expert at creating spaced repetition flashcards optimized for long-term retention. Given a text passage, create flashcards following these principles:

1. Each card tests ONE atomic concept
2. Front (question/cue) should be specific and unambiguous
3. Back (answer) should be concise — ideally 1-2 sentences
4. Avoid yes/no cards
5. Mix of: definitions, cause-effect, comparisons, applications

Return ONLY valid JSON with no markdown or extra text:
{
  "cards": [
    {
      "front": "A clear, specific question or cue",
      "back": "A concise, complete answer"
    }
  ]
}

Rules:
- Generate exactly {{cardCount}} cards
- Front should not contain the answer
- Back should be self-contained
- Vary question types`,
    userPromptTemplate: `Create {{cardCount}} spaced repetition flashcards from this text:\n\n"{{selectedText}}"`,
  },
};

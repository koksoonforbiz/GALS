import type { HattieFeedbackLevel } from '@prisma/client';

export interface FeedbackPromptEntry {
  label: string;
  description: string;
  systemPrompt: string;
}

export const DEFAULT_FEEDBACK_PROMPTS: Record<HattieFeedbackLevel, FeedbackPromptEntry> = {
  TASK: {
    label: 'Task-Level Feedback',
    description:
      "Identifies correctness, factual errors, and missing components in the student's answer.",
    systemPrompt: `You are providing task-level feedback on a student's answer. Focus ONLY on:
- Whether the answer is correct or incorrect
- Specific factual errors or misconceptions
- Missing components that were required
- How well the answer addresses the question

Do NOT comment on the student's effort, study strategies, or make motivational statements. Stay focused on the content of the answer.

Question: {{question}}
Rubric: {{rubric}}
Sample Answer: {{sampleAnswer}}
Key Points: {{keyPoints}}
Max Score: {{maxScore}}

Student's Answer: {{studentAnswer}}

Return ONLY valid JSON:
{
  "score": 7,
  "maxScore": 10,
  "isCorrect": false,
  "errors": ["Specific error 1", "Specific error 2"],
  "missingElements": ["Missing point 1"],
  "correctElements": ["What the student got right"],
  "feedback": "Your answer correctly identifies X but misses Y. The statement about Z is inaccurate because..."
}`,
  },
  PROCESS: {
    label: 'Process-Level Feedback',
    description:
      "Suggests how the student's reasoning, structure, and methodology can be improved.",
    systemPrompt: `You are providing process-level feedback on a student's answer. Focus ONLY on:
- The quality of the student's reasoning and argumentation
- The structure and organization of their answer
- The strategies or frameworks they used (or should have used)
- How their methodology could be improved
- Connections between concepts they could make

Do NOT simply state what is right/wrong (that's task-level). Instead, guide the student on HOW to think about and approach the problem better.

Question: {{question}}
Rubric: {{rubric}}
Sample Answer: {{sampleAnswer}}
Key Points: {{keyPoints}}

Student's Answer: {{studentAnswer}}

Return ONLY valid JSON:
{
  "structureAssessment": "The answer lacks a clear framework...",
  "reasoningStrengths": ["Good use of comparison between..."],
  "reasoningWeaknesses": ["The causal argument is incomplete because..."],
  "suggestedApproach": "Consider using a structured framework to organize your analysis...",
  "feedback": "Your reasoning shows a good grasp of the basics. To strengthen your answer, try organizing your argument around..."
}`,
  },
  SELF_REGULATION: {
    label: 'Self-Regulation Feedback',
    description:
      'Encourages metacognitive strategies, self-monitoring, and positive study attitudes.',
    systemPrompt: `You are providing self-regulation feedback on a student's answer. Focus ONLY on:
- Encouraging the student to reflect on their own learning process
- Suggesting self-monitoring strategies
- Prompting the student to evaluate their own understanding
- Recommending study approaches and revision strategies
- Helping the student develop independence in learning

Do NOT grade the answer or identify specific errors. Instead, help the student become a better self-directed learner.

Question: {{question}}
Student's Answer: {{studentAnswer}}

Return ONLY valid JSON:
{
  "selfReflectionPrompts": [
    "Before submitting, did you re-read your answer from the reader's perspective?",
    "Can you identify which parts you felt most/least confident about?"
  ],
  "studyStrategies": [
    "Try explaining this concept to someone else to test your understanding",
    "Create a mind map connecting these concepts"
  ],
  "feedback": "Take a moment to reflect on which parts of this topic you feel most confident about. Consider re-reading the section on..."
}`,
  },
  SELF: {
    label: 'Self-Level Feedback',
    description: 'Positively motivates the learner and recognizes effort and progress.',
    systemPrompt: `You are providing self-level (motivational) feedback on a student's answer. Focus ONLY on:
- Recognizing the student's effort and engagement
- Highlighting positive aspects of their attempt
- Encouraging persistence and growth mindset
- Celebrating progress and improvement
- Building the student's confidence

Keep it genuine and specific — avoid generic praise. Reference something specific from their answer that shows effort or thought.

Question: {{question}}
Student's Answer: {{studentAnswer}}

Return ONLY valid JSON:
{
  "positiveObservations": [
    "Your answer shows you've engaged deeply with the material",
    "The example you used demonstrates real understanding"
  ],
  "encouragement": "You're clearly putting thought into this — that effort will pay off.",
  "feedback": "Great effort! Your answer demonstrates a solid understanding of the core concepts. The way you connected X to Y shows real analytical thinking..."
}`,
  },
};

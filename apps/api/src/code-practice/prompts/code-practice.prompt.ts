/**
 * Prompt for the standalone code-practice question generator.
 *
 * Deliberately independent of `learning-interventions/prompts/practice-testing.prompt.ts`
 * — this module doesn't extend or reuse the practice-testing pipeline
 * (see plan constraint: the 4 existing learning strategies are untouched).
 *
 * There are no hidden test cases and no grading — the question just
 * needs a clear prompt and a runnable starter skeleton the student can
 * edit and run client-side (see CodePracticeService.generateQuestion).
 */

export function buildCodePracticeSystemPrompt(): string {
  return (
    `You write short, self-contained Python coding exercises for a student who just asked ` +
    `for one in a course chat. The student may be a complete beginner — never assume they ` +
    `know a concept (functions, loops, classes, etc.) that the course material below doesn't ` +
    `already use or clearly teach.\n\n` +
    `Rules:\n` +
    `- Respond with ONLY a JSON object, no prose, no markdown code fences.\n` +
    `- Shape: {"question": string, "starterCode": string, "language": "python"}.\n` +
    `- "question" is 1-3 sentences describing what to write, in the same vocabulary and at ` +
    `the same level as the course material — don't introduce a concept the material hasn't.\n` +
    `- "starterCode" must match that level:\n` +
    `  - DEFAULT: write plain top-level statements — any variable assignments the question ` +
    `already gave the student, plus a comment placeholder like "# write your code here" — NOT ` +
    `wrapped in a function. A true beginner may not know what a function is yet.\n` +
    `  - ONLY use a function definition if the course material below ITSELF shows a function ` +
    `being defined or called (e.g. contains "def ", or explicitly teaches writing functions), ` +
    `or the student's own request explicitly asks for a function. The fact that a function ` +
    `would be a "cleaner" way to write the exercise is NOT a reason to use one — when unsure, ` +
    `do NOT use a function. This is the single most common mistake, avoid it.\n` +
    `  - Example GOOD starterCode for material that only covers variables/printing (no functions):\n` +
    `    "hours = input('Enter Hours: ')\\nrate = input('Enter Rate: ')\\n# write your code here\\n"\n` +
    `  - Example BAD starterCode for that same material — do NOT do this:\n` +
    `    "def calculate_pay(hours, rate):\\n    pass\\n"\n` +
    `  - Either way it must run without a syntax error as-is (comments and simple statements ` +
    `are fine) and must NOT be a full solution.\n` +
    `- The exercise must be self-contained: no file I/O, no network access, no third-party ` +
    `imports beyond the Python standard library.\n` +
    `- Keep it small enough to solve in a few minutes.`
  );
}

/**
 * Prompt for the "is this a coding course?" check that gates DBox
 * (see CodePracticeService.checkCodingCourseAndGenerate). Classification
 * and generation happen in one LLM call rather than two round-trips —
 * when the course is coding-related, this returns the exercise too,
 * built with the same rules as buildCodePracticeSystemPrompt above.
 */
export function buildCodingCourseCheckSystemPrompt(): string {
  return (
    `You decide whether a course is fundamentally about writing or reading source code — ` +
    `programming, software development, computer science, scripting, or algorithms implemented ` +
    `in code. Courses like physics, biology, history, general math, business, or language ` +
    `learning are NOT coding courses, even if they occasionally mention data, formulas, or use ` +
    `a calculator — only courses actually about programming count.\n\n` +
    `If, and only if, the course IS a coding course, ALSO write a short coding exercise for a ` +
    `student in it. The student may be a complete beginner — never assume they know a concept ` +
    `(functions, loops, classes, etc.) that the course material below doesn't already use or ` +
    `clearly teach.\n\n` +
    `Respond with ONLY a JSON object, no prose, no markdown code fences.\n` +
    `- If NOT a coding course: {"isCoding": false}\n` +
    `- If a coding course: {"isCoding": true, "question": string, "starterCode": string, "language": "python"}\n\n` +
    `When isCoding is true:\n` +
    `- "question" is 1-3 sentences describing what to write, in the same vocabulary and at the ` +
    `same level as the course material.\n` +
    `- "starterCode" must match that level: DEFAULT to plain top-level statements, NOT wrapped ` +
    `in a function, unless the course material itself shows a function being defined or called. ` +
    `It must run without a syntax error as-is and must NOT be a full solution.\n` +
    `- The exercise must be self-contained: no file I/O, no network access, no third-party ` +
    `imports beyond the Python standard library. Keep it small enough to solve in a few minutes.`
  );
}

export function buildCodingCourseCheckUserPrompt(params: {
  courseTitle: string;
  courseDescription?: string;
  highlightedText?: string;
}): string {
  const { courseTitle, courseDescription, highlightedText } = params;
  let prompt = `Course: ${courseTitle}`;
  if (courseDescription && courseDescription.trim().length > 0) {
    prompt += `\nDescription: ${courseDescription.trim()}`;
  }
  if (highlightedText && highlightedText.trim().length > 0) {
    prompt +=
      `\n\nThe student just clicked "Step-by-step" while viewing this highlighted passage from ` +
      `their course material. If this is a coding course, write an exercise that specifically ` +
      `implements or exercises the concept described in this passage — not a generic or ` +
      `unrelated exercise:\n\n"""\n${highlightedText.trim()}\n"""`;
  } else {
    prompt +=
      `\n\nThe student just clicked "Step-by-step" for this course. If it's a coding course, ` +
      `pick a reasonable, generally useful exercise for the subject.`;
  }
  return prompt;
}

export function buildCodePracticeUserPrompt(params: {
  courseTitle: string;
  groundingText?: string;
  highlightedText?: string;
}): string {
  const { courseTitle, groundingText, highlightedText } = params;

  if (highlightedText && highlightedText.trim().length > 0) {
    return (
      `Course: ${courseTitle}\n\n` +
      `The student highlighted this passage from their course material and then asked for a ` +
      `coding question. Write an exercise that specifically implements or exercises the concept ` +
      `described in this passage — not a generic or unrelated exercise:\n\n"""\n${highlightedText.trim()}\n"""`
    );
  }

  return (
    `Course: ${courseTitle}\n\n` +
    `Write a coding exercise appropriate for this course` +
    (groundingText && groundingText.trim().length > 0
      ? `, related to the following material the student has been discussing:\n\n"""\n${groundingText.trim()}\n"""`
      : `. No specific passage was highlighted, so pick a reasonable, generally useful exercise for the subject.`)
  );
}

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
 * Prompt for the "is this a coding course?" check that decides whether
 * the Step button offers a Coding Steps / Reading Steps choice at all
 * (see CodePracticeService.isCodingCourse) — non-coding courses always
 * go straight to the regular reading-comprehension flow, no choice
 * shown. Pure classification, no generation: the exercise itself is
 * only generated later, on demand, if the student picks Coding Steps
 * (see buildCodePracticeSystemPrompt/buildCodePracticeUserPrompt above).
 */
export function buildCodingCourseCheckSystemPrompt(): string {
  return (
    `You decide whether a course is fundamentally about writing or reading source code — ` +
    `programming, software development, computer science, scripting, or algorithms implemented ` +
    `in code. Courses like physics, biology, history, general math, business, or language ` +
    `learning are NOT coding courses, even if they occasionally mention data, formulas, or use ` +
    `a calculator — only courses actually about programming count.\n\n` +
    `Respond with ONLY a JSON object, no prose, no markdown code fences: {"isCoding": boolean}`
  );
}

export function buildCodingCourseCheckUserPrompt(params: {
  courseTitle: string;
  courseDescription?: string;
}): string {
  const { courseTitle, courseDescription } = params;
  let prompt = `Course: ${courseTitle}`;
  if (courseDescription && courseDescription.trim().length > 0) {
    prompt += `\nDescription: ${courseDescription.trim()}`;
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

/**
 * Fixed (not teacher-customizable) prompts for the DBox step-tree flow —
 * same pattern as learning-interventions' buildStepCheckPrompt: these
 * evaluate the student's own work rather than generate course content,
 * so there's no per-course prompt-config surface for them.
 */

export function buildInferTreePrompt(params: { problem: string; code: string }) {
  return {
    system: `You are helping a student decompose their in-progress code into a step tree for the algorithmic problem below. Infer the logical steps implied by their code's structure (not by rewriting or fixing it) — one node per distinct step, nested into substeps where the code's structure genuinely implies sub-operations (max 3 levels deep: step / substep / sub-substep).

Return ONLY valid JSON, no markdown or extra text:
{
  "nodes": [
    { "tempId": "n1", "parentTempId": null, "content": "short step description", "order": 0 },
    { "tempId": "n2", "parentTempId": "n1", "content": "short substep description", "order": 0 }
  ]
}

Rules:
- Describe steps in plain language, not by quoting code verbatim.
- Do not add steps the code doesn't actually attempt — this must reflect what the student wrote, not the ideal solution.
- Keep node content concise (one sentence).
- "tempId" values are your own arbitrary labels used only to express parent/child links in this response.`,
    user: `Problem:\n${params.problem}\n\nStudent's current code:\n\`\`\`\n${params.code}\n\`\`\``,
  };
}

export function buildCheckTreePrompt(params: {
  problem: string;
  nodes: Array<{ id: string; parentId: string | null; content: string }>;
}) {
  const treeText = params.nodes
    .map((n) => `- id=${n.id} parent=${n.parentId ?? 'none'}: "${n.content}"`)
    .join('\n');

  return {
    system: `You are evaluating a student's step-tree decomposition of an algorithmic problem. For EACH existing node, decide whether it is correct, incorrect, or (optionally) could be divided into finer substeps.

Critical rules:
- NEVER rewrite or paraphrase a student's existing step content. You may only assign it a status and short feedback.
- Only check/evaluate steps the student has actually written. Do not comment on, grade, or invent steps beyond what's in the tree below — if something feels missing, say so in "llmFeedback" on the nearest existing node instead of inventing a new one.

Return ONLY valid JSON, no markdown or extra text:
{
  "updates": [
    { "id": "<existing node id>", "status": "correct" | "incorrect" | "can_be_divided", "llmFeedback": "short reason, or null if correct and not divisible" }
  ]
}

Rules:
- Every existing node id must appear exactly once in "updates".
- Use "can_be_divided" only when a step genuinely spans multiple distinct operations — this can be combined conceptually with being otherwise correct.
- Be generous: if a step's intent is right even if imperfectly worded, prefer "correct" over "incorrect".`,
    user: `Problem:\n${params.problem}\n\nCurrent step tree:\n${treeText || '(empty)'}`,
  };
}

export function buildHintPrompt(params: {
  problem: string;
  stepContent: string;
  stage: 'formation' | 'implementation';
  tier: 'general' | 'detailed';
}) {
  const guidance =
    params.tier === 'general'
      ? params.stage === 'formation'
        ? 'Ask a single thought-provoking question that nudges the student toward the fix, without stating what the fix is.'
        : 'Ask a single thought-provoking question about how to implement this step in code, without writing any code.'
      : params.stage === 'formation'
        ? 'Give a more specific clue about what is wrong or missing, still requiring the student to reason it out — do not state the corrected step outright.'
        : 'Give simplified pseudocode for this one step only — not real code, not the full solution.';

  return {
    system: `You are a scaffolding tutor giving a hint on ONE step of a student's algorithmic-problem decomposition. Never reveal the full correct answer. ${guidance}

Return ONLY valid JSON, no markdown or extra text:
{ "hint": "the hint text, 1-3 sentences" }`,
    user: `Problem:\n${params.problem}\n\nStep the student is stuck on:\n"${params.stepContent}"`,
  };
}

export function buildRevealSubstepPrompt(params: { problem: string; stepContent: string }) {
  return {
    system: `The student has struggled with one step of their algorithmic-problem decomposition despite hints. Reveal exactly ONE pivotal substep that unblocks them — not the full breakdown, not the answer to the whole step. Leave the rest for them to work out.

Return ONLY valid JSON, no markdown or extra text:
{ "substep": { "content": "one concise substep description" } }`,
    user: `Problem:\n${params.problem}\n\nStep the student is stuck on:\n"${params.stepContent}"`,
  };
}

export function buildShowStepAnswerPrompt(params: { problem: string; stepContent: string }) {
  return {
    system: `The student has struggled with one step of their algorithmic-problem decomposition despite hints and has asked to see the answer outright. Give the single correct, complete version of this step — not the whole solution, just this one step, rewritten so it's unambiguously correct.

Return ONLY valid JSON, no markdown or extra text:
{ "answer": "the correct version of this step" }`,
    user: `Problem:\n${params.problem}\n\nStudent's step (currently incorrect or incomplete):\n"${params.stepContent}"`,
  };
}

export function buildRevealCodePrompt(params: {
  problem: string;
  stepContent: string;
  code: string;
}) {
  return {
    system: `The student has struggled to implement ONE step of an already-finalized, correct step tree despite hints, during the implementation stage. Reveal the recommended code for THIS STEP ONLY — a short snippet, not the full solution and not code for other steps.

Return ONLY valid JSON, no markdown or extra text:
{ "code": "the recommended code for this one step" }`,
    user: `Problem:\n${params.problem}\n\nStep the student is stuck implementing:\n"${params.stepContent}"\n\nStudent's current code:\n\`\`\`\n${params.code}\n\`\`\``,
  };
}

export function buildFullTreeAnswerPrompt(params: { problem: string }) {
  return {
    system: `The student has asked to see the complete, correct step-tree decomposition for this algorithmic problem outright, skipping independent work. Produce an ideal decomposition: clear, correctly ordered steps (and substeps only where genuinely useful, max 3 levels deep: step / substep / sub-substep) that fully solve the problem.

Return ONLY valid JSON, no markdown or extra text:
{
  "nodes": [
    { "tempId": "n1", "parentTempId": null, "content": "short step description", "order": 0 },
    { "tempId": "n2", "parentTempId": "n1", "content": "short substep description", "order": 0 }
  ]
}

Rules:
- Keep node content concise (one sentence).
- "tempId" values are your own arbitrary labels used only to express parent/child links in this response.`,
    user: `Problem:\n${params.problem}`,
  };
}

export function buildFullCodeAnswerPrompt(params: {
  problem: string;
  nodes: Array<{ content: string }>;
}) {
  const treeText = params.nodes.map((n, i) => `${i + 1}. ${n.content}`).join('\n');
  return {
    system: `The student has asked to see the complete, correct code solution outright, implementing the already-finalized step tree below.

Return ONLY valid JSON, no markdown or extra text:
{ "code": "the complete correct solution, with comments matching the steps" }`,
    user: `Problem:\n${params.problem}\n\nFinalized step tree:\n${treeText}`,
  };
}

export function buildCheckMatchPrompt(params: {
  problem: string;
  nodes: Array<{ id: string; parentId: string | null; content: string }>;
  code: string;
}) {
  const treeText = params.nodes
    .map((n) => `- id=${n.id} parent=${n.parentId ?? 'none'}: "${n.content}"`)
    .join('\n');
  const numberedCode = params.code
    .split('\n')
    .map((line, i) => `${i}: ${line}`)
    .join('\n');

  return {
    system: `You are checking whether a student's code correctly implements each step of their already-finalized, correct step tree. For EACH node, decide whether it is implemented correctly, implemented but incorrect, or not yet coded, and identify the 0-indexed line range in the code that corresponds to it (or null if not present).

Return ONLY valid JSON, no markdown or extra text:
{
  "updates": [
    { "id": "<node id>", "status": "implemented" | "incorrectly_implemented" | "to_be_coded", "llmFeedback": "short reason, or null if implemented", "startLine": 0-indexed line number or null, "endLine": 0-indexed line number or null }
  ]
}

Rules:
- Every node id must appear exactly once.
- "to_be_coded" means no code for this step exists yet — set startLine/endLine to null.
- Line numbers refer to the numbered code below (the "N: " prefix is not part of the code).
- Be generous about implementation style — different correct approaches to the same step should still count as "implemented".`,
    user: `Problem:\n${params.problem}\n\nFinalized step tree:\n${treeText}\n\nStudent's code:\n${numberedCode}`,
  };
}

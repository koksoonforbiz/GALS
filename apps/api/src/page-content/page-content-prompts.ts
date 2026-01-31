/**
 * LLM Prompt templates for page content generation (Level 2).
 */

import { ChunkWithScore } from '../rag/rag.service';

export interface PageContext {
  courseTitle: string;
  courseDescription: string;
  moduleTitle: string;
  pageTitle: string;
  learningOutcomes?: string[];
  estimatedMinutes?: number;
  siblingPageTitles: string[];
  pageIndex: number;
}

export function buildPageContentSystemPrompt(strictSources: boolean): string {
  let prompt = `You are an expert educational content writer. Generate detailed lesson content for a single page/lesson item as valid JSON.

OUTPUT FORMAT: Return ONLY valid JSON matching this schema:
{
  "status": "OK" | "NOT_ENOUGH_INFO",
  "pageTitle": string,
  "content": {
    "learning_outcomes": string[],
    "key_concepts": string[],
    "explanation": string,
    "worked_examples": [{ "problem": string, "solution": string }],
    "misconceptions": [{ "misconception": string, "correction": string }],
    "quick_check": [{ "question": string, "answer": string, "explanation": string }],
    "summary_next_steps": string
  },
  "citations": [
    { "marker": "[SRC:<sourceId> p<pageStart>-<pageEnd>]", "sourceId": string, "pageStart": number, "pageEnd": number, "chunkIds": string[] }
  ],
  "missingInfo": string[]
}

RULES:
- Output ONLY valid JSON. No markdown fences, no text outside JSON.
- The "explanation" field should be detailed, well-structured with paragraphs. Use markdown formatting within the string.
- Include inline citation markers like [SRC:abc123 p5-7] within explanation, worked_examples, and corrections.
- Provide at least 2 worked examples and 2 quick-check questions when source material allows.
- "learning_outcomes" should be specific, measurable outcomes using Bloom's taxonomy verbs.
- "key_concepts" should list the main ideas covered.
- "misconceptions" should address common student misunderstandings.`;

  if (strictSources) {
    prompt += `
- STRICT SOURCE MODE: Every substantive paragraph in "explanation" and every worked example MUST include at least one citation marker.
- If the provided sources do NOT contain enough information for this page topic, set status to "NOT_ENOUGH_INFO" and populate "missingInfo" with specific gaps.
- NEVER fabricate facts, formulas, or examples not supported by the sources.`;
  }

  prompt += `
- Write at a university level but keep explanations clear and accessible.
- Build upon prerequisite knowledge from earlier pages in the module.`;

  return prompt;
}

export function buildPageContentUserPrompt(
  page: PageContext,
  chunks: ChunkWithScore[],
  adminPrompt: string,
  selectedSourceNames: Array<{ sourceId: string; name: string }>,
): string {
  const contextBlock = chunks
    .map(
      (chunk, i) =>
        `Source ${i + 1} (docId: "${chunk.documentId}", title: "${chunk.documentTitle}", page ${chunk.pageNumber ?? 'N/A'}, chunkId: "${chunk.id}"):\n${chunk.content}`,
    )
    .join('\n\n');

  const sourceList = selectedSourceNames.length > 0
    ? `Selected sources: ${selectedSourceNames.map((s) => `"${s.name}" (${s.sourceId})`).join(', ')}`
    : 'Using all available course sources.';

  const siblingContext = page.siblingPageTitles.length > 0
    ? `Other pages in this module: ${page.siblingPageTitles.map((t, i) => `${i + 1}. ${t}`).join(', ')}. This page is #${page.pageIndex + 1}.`
    : '';

  const outcomeHint = page.learningOutcomes && page.learningOutcomes.length > 0
    ? `Pre-defined learning outcomes: ${page.learningOutcomes.join('; ')}`
    : '';

  return `COURSE: "${page.courseTitle}"
MODULE: "${page.moduleTitle}"
PAGE: "${page.pageTitle}"
${siblingContext}
${outcomeHint}
${sourceList}

SOURCE MATERIALS:
${contextBlock || '(No source chunks retrieved)'}

---

ADMIN INSTRUCTIONS:
${adminPrompt || 'Generate comprehensive lesson content for this page based on the source materials.'}

Generate the JSON content for this page now.`;
}

export function buildSuggestedPrompt(
  page: PageContext,
  selectedSourceNames: Array<{ sourceId: string; name: string }>,
  scopePreference: string,
): string {
  const sourceContext = selectedSourceNames.length > 0
    ? `using ${selectedSourceNames.length} selected source(s): ${selectedSourceNames.map((s) => s.name).join(', ')}`
    : 'using all available course materials';

  return `Generate detailed lesson content for "${page.pageTitle}" in the module "${page.moduleTitle}" of the course "${page.courseTitle}".

This is page ${page.pageIndex + 1} of ${page.siblingPageTitles.length + 1} in the module. ${
    page.siblingPageTitles.length > 0
      ? `Other pages cover: ${page.siblingPageTitles.filter((_, i) => i !== page.pageIndex).join(', ')}.`
      : ''
  }

Content should be ${sourceContext} (scope: ${scopePreference}).

Include:
- Clear explanations of core concepts
- At least 2 worked examples with step-by-step solutions
- Common misconceptions and corrections
- Quick comprehension checks
- Summary and connection to the next topic${
    page.learningOutcomes && page.learningOutcomes.length > 0
      ? `\n\nAlign with these learning outcomes:\n${page.learningOutcomes.map((o) => `- ${o}`).join('\n')}`
      : ''
  }`;
}

export function buildRetrievalQueryForPage(page: PageContext): string {
  return `${page.courseTitle} ${page.moduleTitle} ${page.pageTitle}`;
}

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

CONTENT FORMATTING RULES:
- The number of content boxes should match the number of pages in the uploaded source selected, unless there is related information, then you can combine them into one content box.
- Do not cut short the lesson content.
- The "explanation" field should be detailed, well-structured with paragraphs.
- Use HTML formatting: <h2>, <h3> for sub-headings, <p> for paragraphs, <strong>, <em>, <ul>/<li> for lists, <code> for inline code.
- For LaTeX equations: use <span data-inline-math="" latex="LATEX_HERE"></span> for inline math, <div data-block-math="" latex="LATEX_HERE"></div> for display equations.
- "learning_outcomes" should be specific, measurable outcomes using Bloom's taxonomy verbs.
- FIRST identify ALL core concepts present in the source materials and list every one of them in "key_concepts" — do not omit any concept that has meaningful coverage in the sources. Aim for granular, distinct concepts rather than broad umbrella terms.
- The "explanation" field must cover every key concept in depth — do not skip, abbreviate, or merge concepts that appear in the sources. Every concept in "key_concepts" must have at least one paragraph of dedicated treatment in "explanation".
- For each key concept, generate corresponding content blocks:
  - "worked_examples": at least one worked example per concept where the concept admits problem-solving practice. The length of worked_examples SHOULD be approximately equal to the number of key_concepts.
  - "quick_check": at least one comprehension question per key concept. The length of quick_check SHOULD be approximately equal to the number of key_concepts.
  - "misconceptions": list every common student misunderstanding that arises for the listed concepts. Do not cap at any fixed number.
- Err on the side of including more rather than fewer content blocks; only omit a block type if the source material genuinely does not support it for that concept.`;

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

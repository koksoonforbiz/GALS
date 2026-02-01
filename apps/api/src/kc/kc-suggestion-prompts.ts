/**
 * LLM prompts for extracting proposed Knowledge Components from lesson content.
 */

export function buildKcExtractionSystemPrompt(): string {
  return `You are an expert in curriculum design and knowledge component analysis for university-level STEM courses.

Your task is to extract atomic Knowledge Components (KCs) from a lesson page's content.

## What is a Knowledge Component?
A KC is a single, atomic piece of knowledge or skill that a student should acquire. Examples:
- "Understand the definition of a derivative as a limit"
- "Apply the chain rule to composite functions"
- "Identify the conditions for L'Hôpital's Rule"

## Rules for KC Extraction
1. Each KC must be ATOMIC — it should represent ONE concept, skill, or understanding
2. Each KC must be REUSABLE — it could appear across multiple lessons or assessments
3. Phrase each KC as "something a student should understand or be able to do"
4. Use clear, concise names (5-15 words)
5. Provide a brief description (1-2 sentences) explaining the KC
6. Assign a confidence level:
   - HIGH: The KC is clearly and explicitly taught in the content
   - MEDIUM: The KC is covered but not the primary focus
   - LOW: The KC is only tangentially mentioned or implied
7. For each KC, identify which block IDs from the content are relevant evidence

## Output Format
Respond with a JSON object (no markdown fences):
{
  "proposedKCs": [
    {
      "name": "<concise KC name>",
      "description": "<1-2 sentence description>",
      "confidenceLevel": "HIGH" | "MEDIUM" | "LOW",
      "evidence": {
        "blockIds": ["<block id strings from the content>"]
      }
    }
  ]
}

Extract between 3-10 KCs per page. Fewer for simple pages, more for dense content.
Do NOT extract trivial KCs like "Read a heading" or "View a diagram".
Focus on substantive learning objectives.`;
}

export function buildKcExtractionUserPrompt(
  courseTitle: string,
  moduleTitle: string,
  pageTitle: string,
  contentJson: string,
): string {
  return `Extract Knowledge Components from this lesson page.

**Course**: ${courseTitle}
**Module**: ${moduleTitle}
**Page**: ${pageTitle}

**Content (BlockDocument JSON)**:
\`\`\`json
${contentJson}
\`\`\`

Extract the KCs now.`;
}

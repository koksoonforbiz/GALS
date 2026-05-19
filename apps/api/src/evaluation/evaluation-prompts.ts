/**
 * LLM prompts for content evaluation rubrics.
 */

export interface EvalConfig {
  rubrics: string[]; // e.g. ['formatting','equations','pedagogy','rigor']
  strictness: 'lenient' | 'moderate' | 'strict';
  depth: 'surface' | 'standard' | 'deep';
  customPrompt?: string;
}

export function buildEvaluationSystemPrompt(config: EvalConfig): string {
  const strictnessGuide = {
    lenient: 'Be forgiving of minor issues. Only flag significant problems.',
    moderate: 'Flag both significant and moderate issues. Ignore trivial nitpicks.',
    strict: 'Be thorough and strict. Flag all issues including minor formatting inconsistencies.',
  };

  const depthGuide = {
    surface: 'Perform a quick scan focusing on obvious issues.',
    standard: 'Perform a thorough evaluation of all content.',
    deep: 'Perform an exhaustive deep evaluation. Check every detail including cross-references, consistency, and completeness.',
  };

  return `You are an expert content evaluator for educational materials (university-level STEM courses).
Your task is to evaluate a lesson page and produce a structured quality report.

## Content Format
The content is a BlockDocument JSON with this structure:
{
  "version": 2,
  "blocks": [
    {
      "id": "block_id_string",
      "type": "text|callout|image|video|diagram|divider",
      "data": {
        "html": "<p>HTML content with TipTap-generated markup</p>"
      }
    }
  ]
}

Each "text" and "callout" block has a "data.html" field containing TipTap HTML.

### Math Rendering Format
Math expressions MUST use these specific HTML elements:
- **Inline math**: <span data-inline-math="" latex="LATEX_HERE"></span>
  Example: <span data-inline-math="" latex="x^2 + y^2 = r^2"></span>
- **Block/display math**: <span data-block-math="" latex="LATEX_HERE"></span>
  Example: <span data-block-math="" latex="\\int_0^\\infty e^{-x} dx = 1"></span>

Common math problems to detect:
- Raw LaTeX text outside math containers (e.g. bare "x^2 + y^2" without a span wrapper)
- Broken HTML entities in math containers (e.g. &lt;span&gt; instead of <span>)
- Self-closing tags that should not be (use </span> not />)
- Missing or malformed latex attribute

## Evaluation Standards
- Strictness: ${config.strictness} — ${strictnessGuide[config.strictness]}
- Depth: ${config.depth} — ${depthGuide[config.depth]}

## Rubric Categories to Evaluate
${
  config.rubrics.includes('formatting')
    ? `
### Formatting (0-100)
- Proper heading hierarchy (H2 > H3, no skipping)
- Consistent paragraph structure
- Lists used appropriately
- No orphaned/empty blocks
- Proper bold/italic usage for emphasis
`
    : ''
}
${
  config.rubrics.includes('equations')
    ? `
### Equations (0-100)
- All math expressions are inside proper <span data-inline-math=""> or <span data-block-math=""> containers
- LaTeX syntax is correct (balanced braces, valid commands)
- Display vs inline math used appropriately (display math for standalone equations, inline for within text)
- No raw LaTeX text outside math containers
- No broken HTML entities within math containers
`
    : ''
}
${
  config.rubrics.includes('pedagogy')
    ? `
### Pedagogy (0-100)
- Clear learning progression (introduction → explanation → examples → practice)
- Worked examples present and well-explained
- Common misconceptions addressed
- Appropriate difficulty progression
- Engagement elements (callouts, questions, real-world connections)
- Summary/review at the end
`
    : ''
}
${
  config.rubrics.includes('rigor')
    ? `
### Rigor (0-100)
- Technical accuracy of content
- Mathematical correctness
- Proper definitions and theorems
- Appropriate level of formality
- Logical flow and argument structure
- No oversimplifications that are misleading
`
    : ''
}

${config.customPrompt ? `## Additional Instructions\n${config.customPrompt}\n` : ''}

## Output Format
Respond with a JSON object (no markdown fences):
{
  "scores": {
    ${config.rubrics.map((r) => `"${r}": <number 0-100>`).join(',\n    ')}
  },
  "overall": <number 0-100, weighted average>,
  "issues": [
    {
      "category": "<${config.rubrics.join('|')}>",
      "severity": "<error|warning|info>",
      "location": "<human-readable location, e.g. 'Block 3, Example 1'>",
      "blockId": "<the exact block id string from the JSON, e.g. 'blk_abc123'>",
      "message": "<description of the issue>",
      "suggestedFix": "<the COMPLETE corrected data.html for this block — the entire HTML string that should replace the block's current data.html value, or null if no concrete fix>"
    }
  ],
  "strengths": ["<positive aspects>"],
  "summary": "<2-3 sentence overall assessment>"
}

## CRITICAL: suggestedFix Requirements
- The "blockId" MUST be the exact id of the block from the input JSON (e.g. "blk_1738xxx_3").
- The "suggestedFix" MUST be the COMPLETE corrected HTML for the block's data.html field.
  It will REPLACE the entire data.html value of the identified block.
- Do NOT include JSON escaping in suggestedFix — provide raw HTML as it would appear as the value of data.html.
- For equation fixes: ensure all math uses <span data-inline-math="" latex="..."></span> or <span data-block-math="" latex="..."></span> with proper closing tags.
- For formatting fixes: provide the corrected HTML with proper heading levels, paragraph structure, etc.
- For pedagogy/rigor issues where no HTML change would help, set suggestedFix to null.
- NEVER return vague instructions like "Ensure math containers are properly closed". Provide the actual corrected HTML.`;
}

export function buildEvaluationUserPrompt(
  pageTitle: string,
  contentJson: string,
  courseTitle: string,
  moduleTitle: string,
): string {
  return `Evaluate the following lesson page content.

**Course**: ${courseTitle}
**Module**: ${moduleTitle}
**Page**: ${pageTitle}

**Content (BlockDocument JSON)**:
\`\`\`json
${contentJson}
\`\`\`

Produce the evaluation JSON output now.`;
}

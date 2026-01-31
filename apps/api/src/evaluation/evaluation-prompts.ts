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
- All math expressions are inside proper math containers (data-inline-math or data-block-math)
- LaTeX syntax is correct (balanced braces, valid commands)
- Equations are numbered or referenced where needed
- Display vs inline math used appropriately
- No raw LaTeX text outside math containers
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
      "location": "<human-readable location, e.g. 'Block 3, paragraph 2'>",
      "message": "<description of the issue>",
      "suggestedFix": "<how to fix it, or null>"
    }
  ],
  "strengths": ["<positive aspects>"],
  "summary": "<2-3 sentence overall assessment>"
}`;
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

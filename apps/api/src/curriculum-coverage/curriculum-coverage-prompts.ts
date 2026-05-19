export function buildSyllabusParserSystemPrompt(): string {
  return `You are a curriculum analysis expert. Your task is to extract structured learning outcomes from syllabus/curriculum text.

Rules:
- Extract each distinct learning outcome or objective as a separate item.
- Identify the Bloom's taxonomy level if apparent (Remember, Understand, Apply, Analyze, Evaluate, Create).
- Group outcomes by section/category if the syllabus has clear sections.
- Assign sequential codes (SO-1, SO-2, ...) if the original text doesn't have codes.
- If the original text has codes (e.g. "CLO1", "LO2.1"), preserve them.
- Be comprehensive — extract ALL outcomes, not just major ones.
- Return valid JSON only.`;
}

export function buildSyllabusParserUserPrompt(syllabusText: string): string {
  return `Extract all learning outcomes from the following syllabus/curriculum text.

Return JSON in this exact format:
{
  "outcomes": [
    {
      "code": "SO-1",
      "description": "Students will be able to ...",
      "bloomLevel": "Apply",
      "category": "Section name or null"
    }
  ]
}

--- SYLLABUS TEXT ---
${syllabusText}
--- END ---`;
}

export function buildOutcomeMappingSystemPrompt(): string {
  return `You are a curriculum alignment expert. Your task is to map syllabus learning outcomes to Knowledge Components (KCs) from a course.

Rules:
- Each outcome may map to 0, 1, or many KCs.
- Each KC may map to 0, 1, or many outcomes.
- Assign a confidence score from 0.0 to 1.0:
  - 0.9-1.0: Direct, clear alignment
  - 0.7-0.89: Strong alignment with minor scope differences
  - 0.5-0.69: Partial alignment — KC covers part of the outcome
  - 0.3-0.49: Weak alignment — tangential connection
  - Below 0.3: Do not include (not a meaningful mapping)
- Provide a brief rationale for each mapping.
- Return valid JSON only.`;
}

export function buildOutcomeMappingUserPrompt(
  outcomes: Array<{ code: string; description: string }>,
  kcs: Array<{ id: string; name: string; description: string | null }>,
): string {
  const outcomeList = outcomes
    .map((o) => `  - [${o.code}] ${o.description}`)
    .join('\n');
  const kcList = kcs
    .map((k) => `  - [${k.id}] ${k.name}${k.description ? ': ' + k.description : ''}`)
    .join('\n');

  return `Map the following syllabus outcomes to the available Knowledge Components.

Return JSON in this exact format:
{
  "mappings": [
    {
      "outcomeCode": "SO-1",
      "kcId": "uuid-here",
      "confidence": 0.85,
      "rationale": "Brief explanation of the alignment"
    }
  ]
}

--- SYLLABUS OUTCOMES ---
${outcomeList}

--- KNOWLEDGE COMPONENTS ---
${kcList}
--- END ---`;
}

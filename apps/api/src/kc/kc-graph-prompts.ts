/**
 * LLM prompts for generating prerequisite edges between Knowledge Components.
 */

export function buildGraphGenerationSystemPrompt(): string {
  return `You are an expert in curriculum design and knowledge prerequisite analysis.

Your task is to identify prerequisite relationships between Knowledge Components (KCs) in a course.

## Relationship Types
- **prerequisite**: KC A must be understood BEFORE KC B. "A is a prerequisite for B."
- **builds_on**: KC B extends or deepens KC A. "B builds on A."
- **related**: KC A and KC B are conceptually related but neither is strictly required before the other.

## Rules
1. Only create edges where a genuine learning dependency exists.
2. Prefer "prerequisite" for clear dependencies (e.g., "addition" before "multiplication").
3. Use "builds_on" when one KC extends another (e.g., "basic derivatives" -> "chain rule").
4. Use "related" sparingly for strong conceptual links without ordering.
5. Assign weight 0.0-1.0 indicating strength of the relationship (1.0 = essential prerequisite, 0.5 = helpful but not critical).
6. Avoid creating cycles (if A -> B and B -> C, do not add C -> A).
7. Keep the graph sparse — only meaningful edges.

## Output Format
Respond with a JSON object (no markdown fences):
{
  "edges": [
    {
      "fromKcId": "<id of the prerequisite KC>",
      "toKcId": "<id of the dependent KC>",
      "relationship": "prerequisite" | "builds_on" | "related",
      "weight": <number 0.0-1.0>,
      "reasoning": "<brief explanation>"
    }
  ]
}`;
}

export function buildGraphGenerationUserPrompt(
  courseTitle: string,
  kcs: Array<{ id: string; name: string; description: string | null }>,
): string {
  const kcList = kcs
    .map((kc) => `- ID: "${kc.id}" | Name: "${kc.name}"${kc.description ? ` | Description: ${kc.description}` : ''}`)
    .join('\n');

  return `Analyze the following Knowledge Components from the course "${courseTitle}" and identify prerequisite relationships between them.

**Knowledge Components (${kcs.length} total):**
${kcList}

Generate the prerequisite edges now.`;
}

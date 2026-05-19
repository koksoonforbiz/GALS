/**
 * LLM Prompt templates for course structure generation.
 * Kept separate from service logic for maintainability.
 */

import { ChunkWithScore } from '../rag/rag.service';

export interface StructurePromptInput {
  courseTitle: string;
  courseDescription: string;
  mode: 'curriculum_based' | 'level_based';
  desiredTopics: number;
  subtopicsPerTopic: number;
  lessonsPerSubtopic: number;
  strictSources: boolean;
  adminPrompt?: string;
  chunks: ChunkWithScore[];
  selectedSourceNames: Array<{ sourceId: string; name: string }>;
}

export function buildStructureSystemPrompt(input: StructurePromptInput): string {
  let prompt = `You are an expert curriculum designer. Your task is to analyze the provided source materials and generate a structured course outline as valid JSON.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown fences, no explanation text outside JSON.
- The output must match the exact schema specified below.
- Base your outline on the actual content of the provided source materials.
- Every topic must have a rationale explaining why it is included.
- Every topic must cite sourceEvidence referencing the source documents by their ID and page numbers.
- Subtopics break each topic into teachable units.
- Each lesson module should have clear learning outcomes and realistic time estimates (in minutes).
- Numeric targets (topics, subtopics, lessons) are SOFT CONSTRAINTS — aim for approximately these numbers but let the source content drive the actual structure.`;

  if (input.mode === 'curriculum_based') {
    prompt += `

CURRICULUM-BASED MODE:
- Extract the curriculum structure, syllabus, and topic organization from the source materials.
- Topic titles should closely mirror headings, chapters, or units found in the sources.
- The outline should represent what the curriculum actually covers, not what you think it should cover.
- Each topic MUST have sourceEvidence entries citing the document and page ranges where the topic appears.`;
  } else {
    prompt += `

LEVEL-BASED MODE:
- Build a logical progression from foundational/beginner concepts to advanced topics.
- Use the source materials to identify the concepts and their natural progression.
- You may organize topics differently than the source structure if it creates better learning flow.
- Still cite sourceEvidence for each topic showing where the underlying content comes from.`;
  }

  if (input.strictSources) {
    prompt += `

STRICT SOURCE MODE (ENABLED):
- Every topic MUST be directly supported by content in the provided sources.
- If the sources do not contain enough information to build a coherent outline with at least ${Math.max(3, Math.floor(input.desiredTopics / 2))} topics, you MUST return status="NOT_ENOUGH_INFO".
- NEVER fabricate, hallucinate, or invent topics not present in the sources.
- Include coverage.gaps listing what curriculum areas appear missing from the sources.`;
  }

  prompt += `

TARGET STRUCTURE:
- Aim for approximately ${input.desiredTopics} topics (can be ${Math.max(1, input.desiredTopics - 3)} to ${input.desiredTopics + 3})
- Aim for approximately ${input.subtopicsPerTopic} subtopics per topic
- Aim for approximately ${input.lessonsPerSubtopic} lesson modules per subtopic

AVAILABLE SOURCES (${input.selectedSourceNames.length} documents):
${input.selectedSourceNames.map((s) => `- "${s.name}" (ID: ${s.sourceId})`).join('\n')}

OUTPUT JSON SCHEMA:
{
  "status": "OK" | "NOT_ENOUGH_INFO",
  "courseStructure": {
    "courseTitle": "${input.courseTitle}",
    "mode": "${input.mode}",
    "topics": [
      {
        "title": "Topic title derived from source content",
        "rationale": "Why this topic is included, referencing source material",
        "sourceEvidence": [{ "sourceId": "document UUID", "pageStart": 1, "pageEnd": 3, "chunkIds": ["chunk-uuid"] }],
        "subtopics": [
          {
            "title": "Subtopic title",
            "lessonModules": [
              { "title": "Lesson title", "learningOutcomes": ["Outcome 1", "Outcome 2"], "estimatedMinutes": 30 }
            ]
          }
        ]
      }
    ]
  },
  "coverage": {
    "sourcesSelected": [{ "sourceId": "uuid", "name": "filename" }],
    "sourcesUsed": [{ "sourceId": "uuid", "pages": "1-5, 12-15", "whyUsed": "Contains curriculum for Topic X" }],
    "gaps": ["Description of any missing curriculum areas"]
  },
  "_notes": "Any additional observations about the generated structure"
}`;

  return prompt;
}

export function buildStructureUserPrompt(input: StructurePromptInput): string {
  const contextBlock = buildContextBlock(input.chunks);

  let prompt = `COURSE: "${input.courseTitle}"
DESCRIPTION: ${input.courseDescription || 'No description provided'}
MODE: ${input.mode}
TARGETS: ~${input.desiredTopics} topics, ~${input.subtopicsPerTopic} subtopics/topic, ~${input.lessonsPerSubtopic} lessons/subtopic`;

  if (input.adminPrompt) {
    prompt += `\nADMIN INSTRUCTIONS: ${input.adminPrompt}`;
  }

  prompt += `

SOURCE MATERIALS (${input.chunks.length} chunks from ${input.selectedSourceNames.length} documents):

${contextBlock}

Based on the above source materials, generate the course outline structure. Output JSON only.`;

  return prompt;
}

export function buildRetrievalQuery(
  courseTitle: string,
  courseDescription: string,
  mode: string,
  adminPrompt?: string,
): string {
  const parts = [
    courseTitle,
    courseDescription,
    mode === 'curriculum_based'
      ? 'curriculum syllabus structure topics chapters units lessons objectives outcomes'
      : 'concepts fundamentals intermediate advanced progression learning path',
  ];
  if (adminPrompt) parts.push(adminPrompt);
  return parts.join(' ');
}

function buildContextBlock(chunks: ChunkWithScore[]): string {
  if (chunks.length === 0) return '[No source content available]';
  return chunks
    .map(
      (chunk, i) =>
        `--- Source Chunk ${i + 1} ---
Document: "${chunk.documentTitle}" (ID: ${chunk.documentId})
Page: ${chunk.pageNumber ?? 'N/A'} | Relevance Score: ${chunk.rerankerScore.toFixed(3)}
Content:
${chunk.content}`,
    )
    .join('\n\n');
}

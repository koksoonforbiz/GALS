import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { LlmService } from '../../rag/llm.service';
import { cohenKappa } from '../validation/metrics';
import { csvCell } from '../validation/validation.service';
import { redactText } from './redact';
import { TextConsentService } from '../../governance/text-consent.service';

export const HELP_LABELS = [
  'instrumental',
  'executive',
  'conceptual',
  'verification',
  'off_topic',
  'task_prompt',
] as const;
export type HelpLabel = (typeof HELP_LABELS)[number];

/** Bump when the codebook prompt changes; old labels stay, tagged with their version. */
export const CLASSIFIER_VERSION = 'help-type-v1';

/**
 * Versioned codebook prompt (plan Phase 3 "classify learner prompts";
 * review §2: Chen et al. 2025 help types, StudyChat dialogue acts).
 */
export const CODEBOOK_PROMPT = `You label one message a learner sent to an AI system in a course about prompting language models.
Choose exactly one label:
- instrumental: asks for help in order to learn (a hint, an explanation of a step, how to approach something) without asking for the finished answer.
- executive: asks the AI to produce the finished product or answer for them (write it, solve it, give the answer).
- conceptual: asks why or how something works (a concept, a mechanism, a reason).
- verification: asks the AI to check, confirm or critique something the learner already has.
- off_topic: unrelated to the course or the task.
- task_prompt: is itself a prompt the learner is engineering or testing as part of an exercise (instructions to the model for a task), not a request for help.
Reply with JSON only: {"label": "<one label>"}.`;

const envNum = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Decision #6 defaults: human–LLM κ ≥ 0.6, and only after human–human κ ≥ 0.7. */
export const kappaThresholds = () => ({
  humanLlm: envNum('PROMPT_CLASSIFIER_HUMAN_LLM_KAPPA_MIN', 0.6),
  humanHuman: envNum('PROMPT_CLASSIFIER_HUMAN_HUMAN_KAPPA_MIN', 0.7),
});

interface Source {
  sourceType: 'prompt_lab_run' | 'chatbot_message';
  sourceId: string;
  studentId: string;
  courseId: string | null;
  occurredAt: Date;
  text: string;
}

export function parseLabel(content: string): HelpLabel | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const label = String((JSON.parse(m[0]) as { label?: unknown }).label ?? '')
      .trim()
      .toLowerCase();
    return (HELP_LABELS as readonly string[]).includes(label) ? (label as HelpLabel) : null;
  } catch {
    return null;
  }
}

/**
 * AI_HELP_PROMPT_CLASSIFIED (workbook #75, rule M33): labels Prompt Lab
 * prompts and chatbot USER messages. Stored in ai_prompt_classifications,
 * not activity_logs (a system event with no client session). Unvalidated
 * until the κ check passes and a researcher marks M33 validated.
 */
@Injectable()
export class PromptClassifierService {
  private readonly logger = new Logger(PromptClassifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    @Optional() private readonly consent?: TextConsentService,
  ) {}

  /**
   * Terms redacted before any LLM classification or coding export (plan
   * Phase 6.2 #3): the course roster's names and email local parts, plus
   * REDACTION_TERMS (comma-separated organisation/product terms).
   */
  private async redactionTerms(courseId: string): Promise<string[]> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        teacher: { select: { name: true, email: true } },
        enrollments: { select: { student: { select: { name: true, email: true } } } },
      },
    });
    const people = course ? [course.teacher, ...course.enrollments.map((e) => e.student)] : [];
    const fromEnv = (process.env.REDACTION_TERMS ?? '').split(',').map((t) => t.trim());
    const terms = people.flatMap((p) => [
      p.name,
      ...p.name.split(/\s+/).filter((part) => part.length >= 3),
      p.email.split('@')[0] ?? '',
    ]);
    return [...new Set([...terms, ...fromEnv].filter((t) => t && t.length >= 3))].sort(
      (a, b) => b.length - a.length,
    );
  }

  private async sources(courseId: string): Promise<Source[]> {
    // Research use only (consent c); scrubbed (empty) prompts are skipped.
    const ok = this.consent ? await this.consent.researchConsenting(courseId) : null;
    const allowed = (s: Source) => (ok ? ok.has(s.studentId) : true) && s.text.trim().length > 0;
    const [runs, chats] = await Promise.all([
      this.prisma.promptLabRun.findMany({
        where: { courseId, sampleNo: 1 },
        select: { id: true, studentId: true, courseId: true, createdAt: true, promptText: true },
      }),
      this.prisma.chatbotMessage.findMany({
        where: { courseId, role: 'USER' },
        select: { id: true, studentId: true, courseId: true, createdAt: true, content: true },
      }),
    ]);
    return [
      ...runs.map((r) => ({
        sourceType: 'prompt_lab_run' as const,
        sourceId: r.id,
        studentId: r.studentId,
        courseId: r.courseId,
        occurredAt: r.createdAt,
        text: r.promptText,
      })),
      ...chats.map((c) => ({
        sourceType: 'chatbot_message' as const,
        sourceId: c.id,
        studentId: c.studentId,
        courseId: c.courseId,
        occurredAt: c.createdAt,
        text: c.content,
      })),
    ].filter(allowed);
  }

  /** Classifies not-yet-labelled prompts for the current classifier version. */
  async classifyCourse(courseId: string, limit = 200) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new BadRequestException('Course not found');
    const done = await this.prisma.aiPromptClassification.findMany({
      where: { courseId, classifierVersion: CLASSIFIER_VERSION },
      select: { sourceType: true, sourceId: true },
    });
    const seen = new Set(done.map((d) => `${d.sourceType}:${d.sourceId}`));
    const terms = await this.redactionTerms(courseId);
    const todo = (await this.sources(courseId))
      .filter((s) => !seen.has(`${s.sourceType}:${s.sourceId}`))
      .slice(0, limit);
    let classified = 0;
    let unparsed = 0;
    for (const s of todo) {
      try {
        const res = await this.llm.callLlmStructured(
          course.teacherId,
          {
            systemPrompt: CODEBOOK_PROMPT,
            messages: [{ role: 'user', content: redactText(s.text, terms).slice(0, 8_000) }],
            jsonMode: true,
            temperature: 0,
            maxTokens: 50,
          },
          { feature: 'prompt_classifier', courseId, triggeredByUserId: s.studentId },
        );
        const label = parseLabel(res.content);
        if (!label) {
          unparsed++;
          continue;
        }
        await this.prisma.aiPromptClassification.create({
          data: {
            sourceType: s.sourceType,
            sourceId: s.sourceId,
            studentId: s.studentId,
            courseId: s.courseId,
            occurredAt: s.occurredAt,
            label,
            classifierVersion: CLASSIFIER_VERSION,
            model: res.model ?? 'template',
          },
        });
        classified++;
      } catch (err) {
        this.logger.warn(
          `classify ${s.sourceType}:${s.sourceId} failed: ${(err as Error).message}`,
        );
      }
    }
    return {
      courseId,
      classifierVersion: CLASSIFIER_VERSION,
      candidates: todo.length,
      classified,
      unparsed,
    };
  }

  /**
   * Stratified sample for double human coding (plan Phase 5.1 #4): up to `n`
   * classified prompts, balanced across labels. The LLM label is NOT in the
   * file (coders must be blind to it). Text is redacted.
   */
  async codingSampleCsv(courseId: string, n = 200): Promise<string> {
    const ok = this.consent ? await this.consent.researchConsenting(courseId) : null;
    const rows = (
      await this.prisma.aiPromptClassification.findMany({
        where: { courseId, classifierVersion: CLASSIFIER_VERSION },
        orderBy: { sourceId: 'asc' },
      })
    ).filter((r) => (ok ? ok.has(r.studentId) : true));
    const byLabel = new Map<string, typeof rows>();
    for (const r of rows) byLabel.set(r.label, [...(byLabel.get(r.label) ?? []), r]);
    const sample: typeof rows = [];
    const queues = [...byLabel.values()];
    while (sample.length < n && queues.some((q) => q.length)) {
      for (const q of queues) {
        const next = q.shift();
        if (next && sample.length < n) sample.push(next);
      }
    }
    const texts = new Map(
      (await this.sources(courseId)).map((s) => [`${s.sourceType}:${s.sourceId}`, s.text]),
    );
    const terms = await this.redactionTerms(courseId);
    const lines = [
      '# Prompt help-type coding sample — classifier ' +
        CLASSIFIER_VERSION +
        '; text redacted (emails, phones, ids); LLM labels withheld',
      ['item_id', 'source_type', 'text', 'label'].join(','),
    ];
    for (const r of sample) {
      const key = `${r.sourceType}:${r.sourceId}`;
      lines.push(
        [key, r.sourceType, redactText(texts.get(key) ?? '', terms), ''].map(csvCell).join(','),
      );
    }
    return lines.join('\n') + '\n';
  }

  /** Stores one coder's labels (item_id = "<sourceType>:<sourceId>"). */
  async saveHumanLabels(coderId: string, labels: Array<{ itemId: string; label: string }>) {
    let saved = 0;
    for (const l of labels) {
      const [sourceType, sourceId] = l.itemId.split(':');
      const label = l.label.trim().toLowerCase();
      if (!sourceType || !sourceId || !(HELP_LABELS as readonly string[]).includes(label)) continue;
      await this.prisma.aiPromptHumanLabel.upsert({
        where: { sourceType_sourceId_coderId: { sourceType, sourceId, coderId } },
        create: { sourceType, sourceId, coderId, label },
        update: { label },
      });
      saved++;
    }
    return { saved, skipped: labels.length - saved };
  }

  /** Human–human and human–LLM κ on the items both sides labelled. */
  async agreement(courseId: string) {
    const llm = await this.prisma.aiPromptClassification.findMany({
      where: { courseId, classifierVersion: CLASSIFIER_VERSION },
      select: { sourceType: true, sourceId: true, label: true },
    });
    const llmBy = new Map(llm.map((r) => [`${r.sourceType}:${r.sourceId}`, r.label]));
    const human = await this.prisma.aiPromptHumanLabel.findMany({
      where: { sourceId: { in: llm.map((r) => r.sourceId) } },
    });
    const coders = [...new Set(human.map((h) => h.coderId))];
    const byCoder = new Map(
      coders.map((c) => [
        c,
        new Map(
          human
            .filter((h) => h.coderId === c)
            .map((h) => [`${h.sourceType}:${h.sourceId}`, h.label]),
        ),
      ]),
    );

    const pair = (a: Map<string, string>, b: Map<string, string>) => {
      const keys = [...a.keys()].filter((k) => b.has(k));
      return {
        n: keys.length,
        kappa: cohenKappa(
          keys.map((k) => a.get(k)!),
          keys.map((k) => b.get(k)!),
        ),
      };
    };
    const humanHuman: Array<{ coderA: string; coderB: string; n: number; kappa: number | null }> =
      [];
    for (let i = 0; i < coders.length; i++)
      for (let j = i + 1; j < coders.length; j++)
        humanHuman.push({
          coderA: coders[i]!,
          coderB: coders[j]!,
          ...pair(byCoder.get(coders[i]!)!, byCoder.get(coders[j]!)!),
        });
    const humanLlm = coders.map((c) => ({ coder: c, ...pair(byCoder.get(c)!, llmBy) }));

    const t = kappaThresholds();
    const best = (xs: Array<{ kappa: number | null }>) =>
      xs.map((x) => x.kappa).filter((k): k is number => k != null);
    const hh = best(humanHuman);
    const hl = best(humanLlm);
    const humanHumanOk = hh.length > 0 && Math.min(...hh) >= t.humanHuman;
    const humanLlmOk = hl.length > 0 && Math.min(...hl) >= t.humanLlm;
    return {
      courseId,
      classifierVersion: CLASSIFIER_VERSION,
      classified: llm.length,
      coders: coders.length,
      humanHuman,
      humanLlm,
      thresholds: t,
      eligibleForValidation: humanHumanOk && humanLlmOk,
      reason: !hh.length
        ? 'Needs two human coders on the same items.'
        : !humanHumanOk
          ? `Human–human κ below ${t.humanHuman}: fix the codebook before judging the LLM.`
          : !humanLlmOk
            ? `Human–LLM κ below ${t.humanLlm}.`
            : 'Both thresholds met — a researcher may mark M33 validated.',
    };
  }

  /** Classifications in a session's time span, for the engine (M33, M08 typing). */
  async forSession(studentId: string, from: Date, to: Date) {
    return this.prisma.aiPromptClassification.findMany({
      where: {
        studentId,
        classifierVersion: CLASSIFIER_VERSION,
        occurredAt: { gte: from, lte: to },
      },
      select: { sourceType: true, sourceId: true, occurredAt: true, label: true },
    });
  }
}

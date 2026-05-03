import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../rag/llm.service';
import { CONSTRUCTS } from './constructs';
import { TextMiningGateway } from '../text-mining.gateway';

@Injectable()
export class DetectionService {
  private readonly logger = new Logger(DetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly gateway: TextMiningGateway,
  ) {}

  async seedDefaultPrompts(): Promise<void> {
    const { DEFAULT_PROMPTS } = await import('./default-prompts');
    const existing = await this.prisma.efConstructPrompt.count({
      where: { courseId: null },
    });
    if (existing > 0) return;

    const data = Object.entries(DEFAULT_PROMPTS).map(([key, promptText]) => ({
      courseId: null as string | null,
      constructKey: key,
      promptText,
      version: 1,
      updatedBy: 'system',
    }));

    await this.prisma.efConstructPrompt.createMany({ data });
    this.logger.log(`Seeded ${data.length} default EF construct prompts`);
  }

  async detectAllForMessage(args: {
    messageId: string;
    sessionId: string;
    studentId: string;
    courseId: string | null;
    teacherId: string;
    utterance: string;
  }): Promise<void> {
    const start = Date.now();

    // Load teacher settings
    let settings = await this.prisma.efTeacherSettings.findUnique({
      where: { teacherId: args.teacherId },
    });
    if (!settings) {
      settings = await this.prisma.efTeacherSettings.create({
        data: { teacherId: args.teacherId },
      });
    }

    if (settings.pauseIngestion) return;

    // Determine which constructs to run
    const enabledConstructs = settings.disableLowFeasibility
      ? CONSTRUCTS.filter((c) => c.feasibility > 2)
      : CONSTRUCTS;

    // Load active prompt set
    const prompts = new Map<string, { promptText: string; version: number }>();
    for (const construct of enabledConstructs) {
      const coursePrompt = args.courseId
        ? await this.prisma.efConstructPrompt.findFirst({
            where: { courseId: args.courseId, constructKey: construct.key },
            orderBy: { version: 'desc' },
          })
        : null;

      const globalPrompt = coursePrompt
        ? null
        : await this.prisma.efConstructPrompt.findFirst({
            where: { courseId: null, constructKey: construct.key },
            orderBy: { version: 'desc' },
          });

      const prompt = coursePrompt ?? globalPrompt;
      if (prompt) {
        prompts.set(construct.key, { promptText: prompt.promptText, version: prompt.version });
      }
    }

    // Build engagement context
    let engagementContext = '(no course material indexed)';
    if (args.courseId) {
      try {
        const course = await this.prisma.course.findUnique({
          where: { id: args.courseId },
          select: { title: true },
        });
        const session = await this.prisma.dialogueSession.findUnique({
          where: { id: args.sessionId },
          select: { title: true },
        });
        engagementContext = `Course: ${course?.title ?? 'Unknown'}. Session: ${session?.title ?? 'Untitled'}.`;
      } catch {
        // Keep default
      }
    }

    // Resolve which user ID to use for LLM calls
    const teacherId = settings.detectionProviderOverride ? args.teacherId : args.teacherId;

    // Get LLM settings to know provider/model for storage
    const llmSettings = await this.llmService.getUserLlmSettings(args.teacherId);
    const provider = settings.detectionProviderOverride ?? llmSettings.provider ?? 'openai';
    const model = settings.detectionModelOverride ?? llmSettings.model ?? 'gpt-4o-mini';

    // Run all enabled constructs concurrently with semaphore
    const concurrency = settings.detectionConcurrency;
    const results: Array<{
      constructKey: string;
      label: string;
      confidence: number | null;
      severity: number | null;
      rationale: string | null;
      warning: string | null;
      rawJson: Record<string, unknown> | null;
      promptVersion: number;
      latencyMs: number | null;
    }> = [];

    // Simple semaphore
    let running = 0;
    const queue: Array<() => void> = [];
    const acquire = () =>
      new Promise<void>((resolve) => {
        if (running < concurrency) {
          running++;
          resolve();
        } else {
          queue.push(resolve);
        }
      });
    const release = () => {
      running--;
      const next = queue.shift();
      if (next) {
        running++;
        next();
      }
    };

    const tasks = enabledConstructs.map(async (construct) => {
      const promptData = prompts.get(construct.key);
      if (!promptData) return;

      await acquire();
      const callStart = Date.now();
      try {
        // Fill prompt
        let filledPrompt = promptData.promptText.replace('<<<INSERT_UTTERANCE>>>', args.utterance);
        if (construct.needsRetrieval) {
          filledPrompt = filledPrompt.replace(
            '<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>',
            engagementContext,
          );
        }

        const result = await this.llmService.callLlmForUser(
          teacherId,
          'You are a learning analytics classifier. Output only valid JSON.',
          filledPrompt,
          { feature: 'text_mining_detection', courseId: args.courseId ?? undefined },
          { jsonMode: true, maxTokens: 200 },
        );

        const latencyMs = Date.now() - callStart;

        try {
          const parsed = JSON.parse(result.content) as Record<string, unknown>;
          results.push({
            constructKey: construct.key,
            label: String(parsed.label ?? 'error'),
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
            severity: typeof parsed.severity === 'number' ? parsed.severity : null,
            rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null,
            warning: typeof parsed.warning === 'string' ? parsed.warning : null,
            rawJson: parsed,
            promptVersion: promptData.version,
            latencyMs,
          });
        } catch {
          results.push({
            constructKey: construct.key,
            label: 'error',
            confidence: null,
            severity: null,
            rationale: `Parse error: ${result.content.slice(0, 200)}`,
            warning: null,
            rawJson: { raw: result.content },
            promptVersion: promptData.version,
            latencyMs,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Detection failed for ${construct.key}: ${msg}`);
        results.push({
          constructKey: construct.key,
          label: 'error',
          confidence: null,
          severity: null,
          rationale: msg.slice(0, 500),
          warning: null,
          rawJson: null,
          promptVersion: promptData.version,
          latencyMs: Date.now() - callStart,
        });
      } finally {
        release();
      }
    });

    await Promise.all(tasks);

    // Persist results
    if (results.length > 0) {
      await this.prisma.efDetection.createMany({
        data: results.map((r) => ({
          messageId: args.messageId,
          sessionId: args.sessionId,
          studentId: args.studentId,
          courseId: args.courseId,
          constructKey: r.constructKey,
          label: r.label,
          confidence: r.confidence,
          severity: r.severity,
          rationale: r.rationale,
          warning: r.warning,
          rawJson: (r.rawJson as Record<string, string>) ?? undefined,
          provider,
          model,
          promptVersion: r.promptVersion,
          latencyMs: r.latencyMs,
        })),
      });

      // Emit Socket.IO events
      for (const r of results) {
        this.gateway.emitDetectionCreated(args.sessionId, {
          messageId: args.messageId,
          constructKey: r.constructKey,
          label: r.label,
          confidence: r.confidence,
        });
      }

      this.gateway.emitBatchCompleted(args.sessionId, {
        messageId: args.messageId,
        constructKeys: results.map((r) => r.constructKey),
      });
    }

    this.logger.debug(
      `Detected ${results.length} constructs for message ${args.messageId} in ${Date.now() - start}ms`,
    );
  }
}

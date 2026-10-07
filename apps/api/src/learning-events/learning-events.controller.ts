import {
  BadRequestException,
  Body,
  Header,
  Patch,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { UserRole } from '@ats/shared';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { PrismaService } from '../prisma';
import { LearningEventsService } from './learning-events.service';
import { ValidationService } from './validation/validation.service';
import {
  ResearchExportsService,
  type EventLogActivity,
  type EventLogCase,
} from './exports/exports.service';
import { PromptClassifierService } from './classifier/classifier.service';
import { TransferTaskService } from './transfer/transfer.service';

interface RequestUser {
  id: string;
  role: UserRole;
}

const ParameterSetSchema = z.object({
  values: z.record(z.unknown()),
  note: z.string().max(500).optional(),
});

const versionQuery = (v?: string) => (v ? Number(v) || undefined : undefined);
const secondsQuery = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallback;
};

const RuleStatusSchema = z.object({
  status: z.enum(['candidate', 'validated']),
  note: z.string().max(2_000).optional(),
  evidence: z.unknown().optional(),
  /** Required to validate M33: the course whose kappa check backs the decision. */
  courseId: z.string().uuid().optional(),
});
const HumanLabelsSchema = z.object({
  labels: z
    .array(z.object({ itemId: z.string().min(3).max(120), label: z.string().min(1).max(40) }))
    .max(2_000),
});
const TransferScoreSchema = z.object({
  studentId: z.string().uuid(),
  moduleItemId: z.string().uuid(),
  slideKey: z.string().min(1).max(32),
  scores: z.array(z.number().int()).min(1).max(20),
  note: z.string().max(2_000).optional(),
});

// Two-door: researcher/teacher surface only — every route is
// @Roles('teacher','admin') → PRIVATE (default-denied on the public door).
@Controller('learning-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class LearningEventsController {
  constructor(
    private readonly service: LearningEventsService,
    private readonly prisma: PrismaService,
    private readonly validation: ValidationService,
    private readonly exportsService: ResearchExportsService,
    private readonly classifier: PromptClassifierService,
    private readonly transfer: TransferTaskService,
  ) {}

  /** Same rule as SessionService.assertTeacherOwnsSession; admins see all. */
  private async assertSession(user: RequestUser, sessionId: string) {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { courseId: true },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (user.role === 'admin') return;
    if (!session.courseId)
      throw new ForbiddenException('This session is not associated with a course you teach');
    await this.assertCourse(user, session.courseId);
  }

  private async assertCourse(user: RequestUser, courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (user.role !== 'admin' && course.teacherId !== user.id) {
      throw new ForbiddenException('You can only analyse your own courses');
    }
  }

  @Get('library')
  library() {
    return this.service.library();
  }

  @Get('parameter-sets')
  parameterSets() {
    return this.service.listParameterSets();
  }

  @Post('parameter-sets')
  createParameterSet(
    @Request() req: { user: RequestUser },
    @Body(new ZodValidationPipe(ParameterSetSchema)) body: z.infer<typeof ParameterSetSchema>,
  ) {
    return this.service.createParameterSet(body.values, body.note, req.user.id);
  }

  @Get('sessions/:sessionId')
  async sessionEvents(
    @Request() req: { user: RequestUser },
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    await this.assertSession(req.user, sessionId);
    return this.service.sessionEvents(sessionId);
  }

  @Post('sessions/:sessionId/recompute')
  async recomputeSession(
    @Request() req: { user: RequestUser },
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Query('parameterSetVersion') version?: string,
  ) {
    await this.assertSession(req.user, sessionId);
    return this.service.computeSession(sessionId, versionQuery(version));
  }

  @Post('courses/:courseId/recompute')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async recomputeCourse(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Query('parameterSetVersion') version?: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.service.computeCourse(courseId, versionQuery(version));
  }

  @Get('courses/:courseId/coverage')
  async coverage(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.service.coverage(courseId);
  }

  // ── Phase 5.1: validation ────────────────────────────────────────────────

  /** Creates the think-aloud codebook as the caller's ReplayCodes. */
  @Post('validation/codes/seed')
  seedCodes(@Request() req: { user: RequestUser }) {
    return this.validation.seedCodes(req.user.id);
  }

  @Get('courses/:courseId/validation')
  async validationReport(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Query('researcherId') researcherId?: string,
    @Query('segmentSeconds') segmentSeconds?: string,
    @Query('toleranceSeconds') toleranceSeconds?: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.validation.report(courseId, {
      researcherId: researcherId ?? req.user.id,
      segmentMs: secondsQuery(segmentSeconds, 30_000),
      toleranceMs: secondsQuery(toleranceSeconds, 5_000),
    });
  }

  @Get('courses/:courseId/validation.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="validation.csv"')
  async validationCsv(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Query('researcherId') researcherId?: string,
    @Query('segmentSeconds') segmentSeconds?: string,
    @Query('toleranceSeconds') toleranceSeconds?: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.validation.reportCsv(courseId, {
      researcherId: researcherId ?? req.user.id,
      segmentMs: secondsQuery(segmentSeconds, 30_000),
      toleranceMs: secondsQuery(toleranceSeconds, 5_000),
    });
  }

  @Get('courses/:courseId/inter-rater')
  async interRater(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Query('coderA', new ParseUUIDPipe()) coderA: string,
    @Query('coderB', new ParseUUIDPipe()) coderB: string,
    @Query('segmentSeconds') segmentSeconds?: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.validation.interRater(
      courseId,
      coderA,
      coderB,
      secondsQuery(segmentSeconds, 30_000),
    );
  }

  @Get('rule-status')
  ruleStatus() {
    return this.validation.ruleStatuses();
  }

  /** Logged, reversible (plan Phase 5.1 #5). M33 needs the kappa thresholds met. */
  @Patch('rule-status/:ruleId')
  async setRuleStatus(
    @Request() req: { user: RequestUser },
    @Param('ruleId') ruleId: string,
    @Body(new ZodValidationPipe(RuleStatusSchema)) body: z.infer<typeof RuleStatusSchema>,
  ) {
    let evidence = body.evidence;
    if (ruleId === 'M33' && body.status === 'validated') {
      if (!body.courseId) {
        throw new BadRequestException('Validating M33 needs courseId (the kappa check behind it)');
      }
      await this.assertCourse(req.user, body.courseId);
      const agreement = await this.classifier.agreement(body.courseId);
      if (!agreement.eligibleForValidation) throw new BadRequestException(agreement.reason);
      evidence = { agreement, ...(typeof evidence === 'object' && evidence ? evidence : {}) };
    }
    return this.validation.setRuleStatus(ruleId, body.status, req.user.id, body.note, evidence);
  }

  // ── Phase 5.1 #4: prompt classifier ─────────────────────────────────────

  @Post('courses/:courseId/classifier/run')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async classify(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.classifier.classifyCourse(courseId);
  }

  @Get('courses/:courseId/classifier/sample.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="prompt-coding-sample.csv"')
  async classifierSample(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.classifier.codingSampleCsv(courseId);
  }

  /** The caller's own human labels for the coding sample. */
  @Post('courses/:courseId/classifier/labels')
  async classifierLabels(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Body(new ZodValidationPipe(HumanLabelsSchema)) body: z.infer<typeof HumanLabelsSchema>,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.classifier.saveHumanLabels(req.user.id, body.labels);
  }

  @Get('courses/:courseId/classifier/agreement')
  async classifierAgreement(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.classifier.agreement(courseId);
  }

  // ── Phase 5.2: exports ──────────────────────────────────────────────────

  @Get('courses/:courseId/export/event-log.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="event-log.csv"')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async eventLog(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Query('activity') activity?: string,
    @Query('case') caseBy?: string,
  ) {
    await this.assertCourse(req.user, courseId);
    const a: EventLogActivity = activity === 'raw' ? 'raw' : 'learning_event';
    const c: EventLogCase = caseBy === 'session' ? 'session' : 'item';
    return this.exportsService.eventLogCsv(courseId, a, c);
  }

  @Get('courses/:courseId/export/outcomes.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="outcomes.csv"')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async outcomes(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.exportsService.outcomesCsv(courseId);
  }

  // ── Phase 5.3: transfer tasks ───────────────────────────────────────────

  @Get('courses/:courseId/transfer')
  async transferSubmissions(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.transfer.submissions(courseId);
  }

  @Post('courses/:courseId/transfer/scores')
  async scoreTransfer(
    @Request() req: { user: RequestUser },
    @Param('courseId', new ParseUUIDPipe()) courseId: string,
    @Body(new ZodValidationPipe(TransferScoreSchema)) body: z.infer<typeof TransferScoreSchema>,
  ) {
    await this.assertCourse(req.user, courseId);
    return this.transfer.score(courseId, req.user.id, body);
  }
}

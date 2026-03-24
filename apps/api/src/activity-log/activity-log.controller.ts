import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Res,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ZodValidationPipe, SessionId } from '../common';
import { ActivityLogService } from './activity-log.service';
import { SessionService } from './session.service';
import { LogExportService } from './log-export.service';
import { BatchLogEventsSchema, BatchLogEventsDto } from './dto/log-event.dto';
import { ActivityAction } from './activity-action.enum';
import type { UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('activity-log')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivityLogController {
  constructor(
    private readonly activityLogService: ActivityLogService,
    private readonly sessionService: SessionService,
    private readonly logExportService: LogExportService,
  ) {}

  // ─── STUDENT ENDPOINTS ────────────────────────────────────────────────────

  /**
   * POST /activity-log/session/open
   * Called by the frontend on page refresh when no session ID exists in sessionStorage.
   */
  @Post('session/open')
  @Roles('student')
  async openSession(@Request() req: { user: RequestUser }) {
    const sessionId = await this.sessionService.openSession({
      userId: req.user.id,
    });
    return { sessionId };
  }

  /**
   * POST /activity-log/batch
   * Frontend sends buffered events in batches (e.g. every 30 seconds).
   */
  @Post('batch')
  @Roles('student', 'teacher')
  async batchLog(
    @Body(new ZodValidationPipe(BatchLogEventsSchema)) dto: BatchLogEventsDto,
    @Request() req: { user: RequestUser },
  ) {
    await this.activityLogService.recordBatch(
      dto.events.map((e) => ({
        sessionId: dto.sessionId,
        userId: req.user.id,
        action: e.action as ActivityAction,
        occurredAt: new Date(e.occurredAt),
        courseId: e.courseId,
        moduleId: e.moduleId,
        moduleItemId: e.moduleItemId,
        assessmentId: e.assessmentId,
        attemptId: e.attemptId,
        questionId: e.questionId,
        dialogueSessionId: e.dialogueSessionId,
        interventionId: e.interventionId,
        kcId: e.kcId,
        metadata: e.metadata,
      })),
    );
    return { ok: true };
  }

  /**
   * PATCH /activity-log/session/course
   * Called by the frontend when a student navigates to a course page.
   * Associates the current activity session with a courseId so the teacher
   * can view biometric data in the session log viewer.
   */
  @Patch('session/course')
  @Roles('student')
  async setSessionCourse(
    @SessionId() sessionId: string,
    @Body() body: { courseId: string },
  ) {
    if (sessionId && body.courseId) {
      await this.sessionService.setCourseId(sessionId, body.courseId);
    }
    return { ok: true };
  }

  /**
   * POST /activity-log/session/close
   * Called by the frontend on logout or page unload (sendBeacon).
   */
  @Post('session/close')
  @Roles('student', 'teacher')
  async closeSession(@SessionId() sessionId: string) {
    if (sessionId) await this.sessionService.closeSession(sessionId);
    return { ok: true };
  }

  // ─── TEACHER ENDPOINTS ────────────────────────────────────────────────────

  /**
   * GET /activity-log/teacher/students/:studentId/sessions
   * List all sessions for a student (most recent first).
   */
  @Get('teacher/students/:studentId/sessions')
  @Roles('teacher')
  async getStudentSessions(@Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.activityLogService.getStudentSessions(studentId);
  }

  /**
   * GET /activity-log/teacher/sessions/:sessionId
   * Get all raw event logs for a specific session.
   */
  @Get('teacher/sessions/:sessionId')
  @Roles('teacher')
  async getSessionLogs(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.activityLogService.getSessionLogs(sessionId);
  }

  /**
   * GET /activity-log/teacher/sessions/:sessionId/summary
   * Get the aggregated SessionSummary for a session.
   */
  @Get('teacher/sessions/:sessionId/summary')
  @Roles('teacher')
  async getSessionSummary(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    // Try saved summary first
    const saved = await this.activityLogService['prisma'].sessionSummary.findUnique({
      where: { sessionId },
    });
    if (saved) return saved;

    // For in-progress sessions, compute a live summary from raw logs
    return this.activityLogService.computeLiveSummary(sessionId);
  }

  /**
   * GET /activity-log/teacher/sessions/:sessionId/export
   * Download the full structured JSON log for a session.
   * Returns the JSON directly (Content-Disposition: attachment).
   */
  @Get('teacher/sessions/:sessionId/export')
  @Roles('teacher')
  async exportSessionLog(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Res() res: Response,
  ) {
    const doc = await this.logExportService.buildSessionLogDocument(sessionId);
    const json = JSON.stringify(doc, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="session-${sessionId}.json"`);
    return res.send(json);
  }

  /**
   * GET /activity-log/teacher/sessions/:sessionId/export-url
   * Upload to MinIO and return a presigned URL (for large files).
   */
  @Get('teacher/sessions/:sessionId/export-url')
  @Roles('teacher')
  async getExportUrl(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    const session = await this.activityLogService['prisma'].studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userId: true },
    });
    const url = await this.logExportService.exportToStorage(sessionId, session.userId);
    return { url };
  }

  /**
   * GET /activity-log/teacher/students/:studentId/all-sessions-export
   * Export all sessions for a student as a single combined JSON.
   */
  @Get('teacher/students/:studentId/all-sessions-export')
  @Roles('teacher')
  async exportAllSessions(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Res() res: Response,
  ) {
    const sessions = await this.activityLogService.getStudentSessions(studentId);
    const docs = await Promise.all(
      sessions.map((s) => this.logExportService.buildSessionLogDocument(s.id)),
    );

    const json = JSON.stringify(
      {
        _meta: { exportedAt: new Date().toISOString(), studentId, sessionCount: docs.length },
        sessions: docs,
      },
      null,
      2,
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="student-${studentId}-all-sessions.json"`,
    );
    return res.send(json);
  }
}

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { StudentRagService } from './student-rag.service';
import { StudentSourceGuideService } from './student-source-guide.service';
import { PrismaService } from '../prisma/prisma.service';
import { DialogueCourseSettingsSchema } from '@ats/shared';

interface RequestUser {
  id: string;
  role: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  // Code MIME types
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'text/x-python',
  'text/x-java',
  'text/x-c',
  'text/x-c++',
  'text/x-csharp',
  'text/x-go',
  'text/x-ruby',
  'text/x-php',
  'text/x-rust',
  'text/x-swift',
  'text/x-kotlin',
  'text/x-scala',
  'text/x-sql',
  'text/x-shellscript',
  'text/html',
  'text/css',
  'application/json',
  'application/xml',
  'text/xml',
  'text/x-yaml',
  'application/octet-stream', // fallback for code files
]);

@Controller('student-rag')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentRagController {
  private readonly logger = new Logger(StudentRagController.name);

  constructor(
    private readonly studentRagService: StudentRagService,
    private readonly guideService: StudentSourceGuideService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Upload document ────────────────────────────────────

  @Post('courses/:courseId/documents')
  @Roles('student')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('No file provided');

    // Verify enrollment
    const enrollment = await this.verifyEnrollment(req.user.id, courseId);

    // Get course settings for validation
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { dblSettings: true },
    });

    const settings = this.parseDblSettings(course?.dblSettings);

    if (!settings.allowStudentUploads) {
      throw new ForbiddenException('Student uploads are not enabled for this course');
    }

    // Validate file size
    const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException(`File size exceeds maximum of ${settings.maxFileSizeMb}MB`);
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`File type "${file.mimetype}" is not supported`);
    }

    // Check file count limit
    const existingCount = await this.prisma.studentSourceDocument.count({
      where: { enrollmentId: enrollment.id },
    });

    if (existingCount >= settings.maxFilesPerStudent) {
      throw new BadRequestException(
        `Maximum of ${settings.maxFilesPerStudent} files per student reached`,
      );
    }

    return this.studentRagService.uploadDocument(enrollment.id, req.user.id, courseId, file);
  }

  // ─── List documents ─────────────────────────────────────

  @Get('courses/:courseId/documents')
  @Roles('student')
  async listDocuments(@Request() req: { user: RequestUser }, @Param('courseId') courseId: string) {
    const enrollment = await this.verifyEnrollment(req.user.id, courseId);
    return this.studentRagService.listSources(enrollment.id);
  }

  // ─── Get single document ────────────────────────────────

  @Get('courses/:courseId/documents/:documentId')
  @Roles('student')
  async getDocument(
    @Request() req: { user: RequestUser },
    @Param('courseId') _courseId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.studentRagService.getSource(documentId, req.user.id);
  }

  // ─── Toggle source active/inactive ─────────────────────

  @Patch('courses/:courseId/documents/:documentId/toggle')
  @Roles('student')
  async toggleSource(
    @Request() req: { user: RequestUser },
    @Param('courseId') _courseId: string,
    @Param('documentId') documentId: string,
    @Body() body: { isActive: boolean },
  ) {
    if (typeof body.isActive !== 'boolean') {
      throw new BadRequestException('isActive must be a boolean');
    }
    return this.studentRagService.toggleSource(documentId, req.user.id, body.isActive);
  }

  // ─── Delete document ────────────────────────────────────

  @Delete('courses/:courseId/documents/:documentId')
  @Roles('student')
  async deleteDocument(
    @Request() req: { user: RequestUser },
    @Param('courseId') _courseId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.studentRagService.deleteDocument(documentId, req.user.id);
  }

  // ─── Regenerate guide ───────────────────────────────────

  @Post('courses/:courseId/documents/:documentId/regenerate-guide')
  @Roles('student')
  async regenerateGuide(
    @Request() req: { user: RequestUser },
    @Param('courseId') _courseId: string,
    @Param('documentId') documentId: string,
  ) {
    // Verify ownership
    await this.studentRagService.getSource(documentId, req.user.id);
    const guide = await this.guideService.generateGuide(documentId);
    return guide || { message: 'Guide generation failed' };
  }

  // ─── Helpers ────────────────────────────────────────────

  private async verifyEnrollment(studentId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: {
        studentId_courseId: { studentId, courseId },
      },
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenException('You must be enrolled in this course');
    }

    return enrollment;
  }

  private parseDblSettings(raw: unknown) {
    try {
      return DialogueCourseSettingsSchema.parse(raw || {});
    } catch {
      return DialogueCourseSettingsSchema.parse({});
    }
  }
}

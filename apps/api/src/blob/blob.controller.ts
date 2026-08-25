import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BlobService } from './blob.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const ALLOWED_TYPES: Record<string, string> = {
  'strokes.json': 'application/json',
  'snapshot.png': 'image/png',
};

interface RequestUser {
  id: string;
  role: string;
}

@Controller('blobs')
@UseGuards(JwtAuthGuard)
export class BlobController {
  constructor(
    private readonly blob: BlobService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('presign/upload')
  async getUploadUrl(@Req() req: Request & { user: RequestUser }, @Query('key') key: string) {
    this.validateKey(key);
    await this.assertOwnsAttemptKey(key, req.user);
    const contentType = this.resolveContentType(key);
    const url = await this.blob.getPresignedUploadUrl({ key, contentType });
    return { url, key, contentType };
  }

  @Get('presign/download')
  async getDownloadUrl(@Req() req: Request & { user: RequestUser }, @Query('key') key: string) {
    this.validateKey(key);
    await this.assertOwnsAttemptKey(key, req.user);
    const url = await this.blob.getPresignedDownloadUrl({ key });
    return { url, key };
  }

  @Put(':attemptId/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  async proxyUpload(
    @Param('attemptId') attemptId: string,
    @Param('type') type: string,
    @Req() req: Request & { rawBody?: Buffer; user: RequestUser },
  ) {
    const key = `${attemptId}/${type}`;
    this.validateKey(key);
    await this.assertOwnsAttemptKey(key, req.user);
    const contentType = this.resolveContentType(key);

    const body = req.rawBody ?? Buffer.alloc(0);

    await this.blob.put({ key, body, contentType });
  }

  @Get(':attemptId/:type')
  async proxyDownload(
    @Param('attemptId') attemptId: string,
    @Param('type') type: string,
    @Req() req: Request & { user: RequestUser },
    @Res() res: Response,
  ) {
    const key = `${attemptId}/${type}`;
    this.validateKey(key);
    await this.assertOwnsAttemptKey(key, req.user);
    const { body, contentType } = await this.blob.get(key);
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }

  @Delete(':attemptId/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBlob(
    @Param('attemptId') attemptId: string,
    @Param('type') type: string,
    @Req() req: Request & { user: RequestUser },
  ) {
    const key = `${attemptId}/${type}`;
    this.validateKey(key);
    await this.assertOwnsAttemptKey(key, req.user);
    await this.blob.delete(key);
  }

  /**
   * Every key in this controller is `{attemptId}/{type}`. Verifies the
   * caller is either the student who owns the attempt or the teacher of
   * the attempt's course before touching MinIO — validateKey() only
   * checks shape, not ownership.
   */
  private async assertOwnsAttemptKey(key: string, user: RequestUser): Promise<void> {
    const attemptId = key.split('/')[0]!;
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        studentId: true,
        question: {
          select: {
            topic: { select: { course: { select: { teacherId: true } } } },
            course: { select: { teacherId: true } },
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    if (user.role === 'student') {
      if (attempt.studentId !== user.id) {
        throw new ForbiddenException('You can only access your own attempts');
      }
      return;
    }

    if (user.role === 'teacher') {
      const courseTeacherId =
        attempt.question.topic?.course?.teacherId ?? attempt.question.course?.teacherId;
      if (courseTeacherId !== user.id) {
        throw new ForbiddenException('You can only access attempts in your own courses');
      }
      return;
    }

    throw new ForbiddenException('Not authorized to access this resource');
  }

  private validateKey(key: string): void {
    if (!key) {
      throw new BadRequestException('Blob key is required');
    }
    const parts = key.split('/');
    if (parts.length !== 2) {
      throw new BadRequestException(
        `Invalid blob key "${key}". Expected format: {attemptId}/{type}`,
      );
    }
    const [, type] = parts;
    if (!type || !ALLOWED_TYPES[type]) {
      throw new BadRequestException(
        `Invalid blob type "${type}". Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      );
    }
  }

  private resolveContentType(key: string): string {
    const type = key.split('/').pop();
    return ALLOWED_TYPES[type!]!;
  }
}

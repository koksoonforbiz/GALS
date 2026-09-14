import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Request,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface RequestUser {
  id: string;
}

// sessionId always originates as a Prisma UUID — reject anything else
// before it ever reaches a shell command or a filesystem path, since
// both exec() and path.join() are unsafe against arbitrary input
// (command injection / path traversal respectively).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidSessionId(sessionId: string): void {
  if (!UUID_RE.test(sessionId)) {
    throw new BadRequestException('sessionId must be a valid UUID');
  }
}

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  @Post('export-session')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async exportSession(
    @Request() req: { user: RequestUser },
    @Body() dto: { sessionId: string; uploadToMinio?: boolean },
  ) {
    assertValidSessionId(dto.sessionId);
    const actorId = req.user.id;

    // execFile (not exec) passes args as an array with no shell
    // interpretation, so this is safe even without the UUID check above —
    // the check stays as defense-in-depth for the filesystem path it
    // implies (exports/<sessionId>/...).
    const args = ['../../analysis/export_logs.py', dto.sessionId];
    if (dto.uploadToMinio) args.push('--upload');

    // Log WHO triggered this export, not just which session was
    // exported (checklist item 34 — authorized/logged/monitored access
    // to data and backups).
    this.logger.log(`Export requested: sessionId=${dto.sessionId} actor=${actorId}`);
    execFile('python', args, (error, stdout, stderr) => {
      if (error) {
        this.logger.error(
          `Export failed: sessionId=${dto.sessionId} actor=${actorId} error=${error.message}`,
        );
        this.logger.error(stderr);
      } else {
        this.logger.log(
          `Export completed: sessionId=${dto.sessionId} actor=${actorId} result=${stdout.trim()}`,
        );
      }
    });

    return { success: true, message: 'Export job started', sessionId: dto.sessionId };
  }

  @Get('export-session/status')
  async getExportStatus(@Query('sessionId') sessionId: string) {
    assertValidSessionId(sessionId);

    const exportsDir = path.join(process.cwd(), 'exports', sessionId);

    if (!fs.existsSync(exportsDir)) {
      return { exported: false };
    }

    // Find the latest export directory
    const subdirs = fs.readdirSync(exportsDir).sort().reverse();
    for (const subdir of subdirs) {
      const manifestPath = path.join(exportsDir, subdir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        return { exported: true, manifest };
      }
    }

    return { exported: false };
  }
}

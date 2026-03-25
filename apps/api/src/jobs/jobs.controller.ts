import { Controller, Post, Get, Body, Query, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

@Controller('jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  @Post('export-session')
  async exportSession(@Body() dto: { sessionId: string; uploadToMinio?: boolean }) {
    const uploadFlag = dto.uploadToMinio ? '--upload' : '';
    const cmd = `python analysis/export_logs.py ${dto.sessionId} ${uploadFlag}`;

    exec(cmd, { cwd: process.cwd() }, (error, stdout, stderr) => {
      if (error) {
        this.logger.error(`Export failed for ${dto.sessionId}: ${error.message}`);
        this.logger.error(stderr);
      } else {
        this.logger.log(`Export completed for ${dto.sessionId}: ${stdout.trim()}`);
      }
    });

    return { success: true, message: 'Export job started', sessionId: dto.sessionId };
  }

  @Get('export-session/status')
  async getExportStatus(@Query('sessionId') sessionId: string) {
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

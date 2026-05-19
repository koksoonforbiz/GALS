import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { PublishGateService } from './publish-gate.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('courses/:courseId/publish-gate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class PublishGateController {
  constructor(private readonly gateService: PublishGateService) {}

  /** Run all publish gate checks (dry run — does not publish) */
  @Post('check')
  runChecks(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.gateService.runChecks(courseId, req.user.id);
  }

  /** Publish if all checks pass */
  @Post('publish')
  gatedPublish(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.gateService.gatedPublish(courseId, req.user.id);
  }

  /** Override failed checks and publish with justification */
  @Post('publish-override')
  publishWithOverride(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
    @Body() dto: { overrideReason: string },
  ) {
    return this.gateService.publishWithOverride(
      courseId,
      req.user.id,
      dto.overrideReason,
    );
  }

  /** Get audit trail of all publish gate runs */
  @Get('audit')
  auditHistory(
    @Param('courseId') courseId: string,
    @Request() req: { user: RequestUser },
  ) {
    return this.gateService.listAuditHistory(courseId, req.user.id);
  }
}

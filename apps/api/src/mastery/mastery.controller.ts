import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import { MasteryService } from './mastery.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { CreateKcSchema } from '@ats/shared';
import type { CreateKc, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class MasteryController {
  constructor(private readonly masteryService: MasteryService) {}

  // ─── Mastery Endpoints ──────────────────────────────

  @Get('me/mastery')
  @Roles('student')
  getMyMastery(@Request() req: { user: RequestUser }) {
    return this.masteryService.getMasteryForStudent(req.user.id);
  }

  @Get('students/:id/mastery')
  @Roles('teacher', 'admin')
  getStudentMastery(@Param('id') id: string) {
    return this.masteryService.getMasteryForStudent(id);
  }

  @Post('me/revise-worksheet')
  @Roles('student')
  generateRevisionWorksheet(@Request() req: { user: RequestUser }) {
    return this.masteryService.generateRevisionWorksheet(req.user.id);
  }

  // ─── KC CRUD Endpoints ─────────────────────────────

  @Post('kcs')
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(CreateKcSchema))
  createKc(@Body() dto: CreateKc) {
    return this.masteryService.createKc(dto);
  }

  @Get('kcs')
  @Roles('teacher', 'admin')
  findKcsByTopic(@Query('topicId') topicId: string) {
    return this.masteryService.findKcsByTopic(topicId);
  }

  @Delete('kcs/:id')
  @Roles('teacher', 'admin')
  deleteKc(@Param('id') id: string) {
    return this.masteryService.deleteKc(id);
  }
}

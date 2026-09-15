import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UsePipes,
} from '@nestjs/common';
import { TopicsService } from './topics.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe, PublicDoor } from '../common';
import { CreateTopicSchema, UpdateTopicSchema } from '@ats/shared';
import type { CreateTopic, UpdateTopic, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('topics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Post()
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(CreateTopicSchema))
  create(@Request() req: { user: RequestUser }, @Body() dto: CreateTopic) {
    return this.topicsService.create(req.user.id, dto);
  }

  @Get()
  // Two-door: read-only topic access is BOTH — see docs/two-door/api-classification.md.
  @PublicDoor()
  findByCourse(@Query('courseId') courseId: string) {
    return this.topicsService.findByCourse(courseId);
  }

  @Get(':id')
  // Two-door: BOTH — see docs/two-door/api-classification.md.
  @PublicDoor()
  findOne(@Param('id') id: string) {
    return this.topicsService.findOne(id);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTopicSchema)) dto: UpdateTopic,
  ) {
    return this.topicsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.topicsService.remove(id, req.user.id);
  }
}

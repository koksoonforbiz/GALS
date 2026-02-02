import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { QuestionsService } from './questions.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  // POST /questions
  @Post()
  create(@Request() req: { user: RequestUser }, @Body() dto: Record<string, any>) {
    return this.questionsService.create(req.user.id, dto);
  }

  // GET /questions
  @Get()
  findAll(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId?: string,
    @Query('topicId') topicId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('difficulty') difficulty?: string,
    @Query('bloomsLevel') bloomsLevel?: string,
    @Query('search') search?: string,
  ) {
    if (topicId) {
      return this.questionsService.findByTopic(topicId);
    }
    return this.questionsService.findAll(req.user.id, {
      courseId,
      type,
      status,
      difficulty: difficulty ? parseInt(difficulty, 10) : undefined,
      bloomsLevel,
      search,
    });
  }

  // GET /questions/course/:courseId
  @Get('course/:courseId')
  findByCourse(
    @Param('courseId') courseId: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('difficulty') difficulty?: string,
    @Query('bloomsLevel') bloomsLevel?: string,
    @Query('search') search?: string,
  ) {
    return this.questionsService.findByCourse(courseId, {
      type,
      status,
      difficulty: difficulty ? parseInt(difficulty, 10) : undefined,
      bloomsLevel,
      search,
    });
  }

  // POST /questions/bulk-import
  @Post('bulk-import')
  bulkImport(
    @Request() req: { user: RequestUser },
    @Body() body: { courseId: string; questions: Record<string, any>[] },
  ) {
    return this.questionsService.bulkImport(req.user.id, body.courseId, body.questions);
  }

  // POST /questions/bulk-status
  @Post('bulk-status')
  bulkStatus(
    @Request() req: { user: RequestUser },
    @Body() body: { ids: string[]; status: string },
  ) {
    return this.questionsService.bulkUpdateStatus(req.user.id, body.ids, body.status);
  }

  // GET /questions/:id
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findOne(id);
  }

  // PATCH /questions/:id
  @Patch(':id')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: Record<string, any>,
  ) {
    return this.questionsService.update(id, req.user.id, dto);
  }

  // DELETE /questions/:id
  @Delete(':id')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.questionsService.remove(id, req.user.id);
  }

  // POST /questions/:id/duplicate
  @Post(':id/duplicate')
  duplicate(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.questionsService.duplicate(id, req.user.id);
  }

  // POST /questions/:id/archive
  @Post(':id/archive')
  archive(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.questionsService.archive(id, req.user.id);
  }
}

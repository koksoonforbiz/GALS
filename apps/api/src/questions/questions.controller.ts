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
import { QuestionsService } from './questions.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { ZodValidationPipe } from '../common';
import { CreateQuestionSchema, UpdateQuestionSchema } from '@ats/shared';
import type { CreateQuestion, UpdateQuestion, UserRole } from '@ats/shared';

interface RequestUser {
  id: string;
  role: UserRole;
}

@Controller('questions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post()
  @Roles('teacher', 'admin')
  @UsePipes(new ZodValidationPipe(CreateQuestionSchema))
  create(@Request() req: { user: RequestUser }, @Body() dto: CreateQuestion) {
    return this.questionsService.create(req.user.id, dto);
  }

  @Get()
  findByTopic(@Query('topicId') topicId: string) {
    return this.questionsService.findByTopic(topicId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.questionsService.findOne(id);
  }

  @Patch(':id')
  @Roles('teacher', 'admin')
  update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateQuestionSchema)) dto: UpdateQuestion,
  ) {
    return this.questionsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @Roles('teacher', 'admin')
  remove(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.questionsService.remove(id, req.user.id);
  }
}

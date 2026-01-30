import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Request,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CourseStructureService, OutlineDraft } from './course-structure.service';

interface RequestUser {
  user: { id: string; role: string };
}

interface GenerateStructureBody {
  mode: 'curriculum_based' | 'level_based';
  desired_topics?: number;
  subtopics_per_topic?: number;
  lessons_per_subtopic?: number;
  strict_sources?: boolean;
  admin_prompt?: string;
}

interface ApplyStructureBody {
  structure: OutlineDraft;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CourseStructureController {
  private readonly logger = new Logger(CourseStructureController.name);

  constructor(private readonly courseStructureService: CourseStructureService) {}

  @Post('admin/courses/:courseId/generate-structure')
  @Roles('teacher', 'admin')
  async generateStructure(
    @Param('courseId') courseId: string,
    @Body() body: GenerateStructureBody,
    @Request() req: RequestUser,
  ) {
    // Validate mode
    if (!body.mode || !['curriculum_based', 'level_based'].includes(body.mode)) {
      throw new BadRequestException('mode must be "curriculum_based" or "level_based"');
    }

    const desired_topics = body.desired_topics ?? 10;
    const subtopics_per_topic = body.subtopics_per_topic ?? 4;
    const lessons_per_subtopic = body.lessons_per_subtopic ?? 2;

    if (desired_topics < 1 || desired_topics > 30) {
      throw new BadRequestException('desired_topics must be between 1 and 30');
    }
    if (subtopics_per_topic < 1 || subtopics_per_topic > 10) {
      throw new BadRequestException('subtopics_per_topic must be between 1 and 10');
    }
    if (lessons_per_subtopic < 1 || lessons_per_subtopic > 5) {
      throw new BadRequestException('lessons_per_subtopic must be between 1 and 5');
    }

    this.logger.log(
      `Generate structure requested for course ${courseId} by user ${req.user.id} (mode: ${body.mode})`,
    );

    return this.courseStructureService.generateStructure({
      courseId,
      userId: req.user.id,
      mode: body.mode,
      desired_topics,
      subtopics_per_topic,
      lessons_per_subtopic,
      strict_sources: body.strict_sources ?? (body.mode === 'curriculum_based'),
      admin_prompt: body.admin_prompt,
    });
  }

  @Post('admin/courses/:courseId/apply-structure/:jobId')
  @Roles('teacher', 'admin')
  async applyStructure(
    @Param('courseId') courseId: string,
    @Param('jobId') jobId: string,
    @Body() body: ApplyStructureBody,
    @Request() req: RequestUser,
  ) {
    if (!body.structure?.courseStructure?.topics) {
      throw new BadRequestException('structure.courseStructure.topics is required');
    }

    this.logger.log(
      `Apply structure requested for course ${courseId}, job ${jobId} by user ${req.user.id}`,
    );

    return this.courseStructureService.applyStructure(
      courseId,
      req.user.id,
      jobId,
      body.structure,
    );
  }

  @Get('admin/courses/:courseId/structure-jobs')
  @Roles('teacher', 'admin')
  async listJobs(@Param('courseId') courseId: string) {
    return this.courseStructureService.listJobs(courseId);
  }

  @Get('admin/courses/:courseId/structure-jobs/:jobId')
  @Roles('teacher', 'admin')
  async getJob(@Param('jobId') jobId: string) {
    return this.courseStructureService.getJob(jobId);
  }
}

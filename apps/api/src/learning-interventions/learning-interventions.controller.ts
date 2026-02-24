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
} from '@nestjs/common';
import { LearningInterventionsService } from './learning-interventions.service';
import { JwtAuthGuard } from '../auth';
import { CreateSavedReviewDto, UpdateSavedReviewDto } from './dto';
import type { InterventionType } from '@prisma/client';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('learning-interventions')
@UseGuards(JwtAuthGuard)
export class LearningInterventionsController {
  constructor(private readonly service: LearningInterventionsService) {}

  // ─── Saved Reviews ───────────────────────────────────────

  @Post('saved-reviews')
  createSavedReview(@Request() req: { user: RequestUser }, @Body() dto: CreateSavedReviewDto) {
    return this.service.createSavedReview(req.user.id, dto);
  }

  @Get('saved-reviews')
  findAllSavedReviews(
    @Request() req: { user: RequestUser },
    @Query('interventionType') interventionType?: InterventionType,
    @Query('courseId') courseId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAllSavedReviews(req.user.id, {
      interventionType,
      courseId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('saved-reviews/:id')
  findOneSavedReview(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.service.findOneSavedReview(req.user.id, id);
  }

  @Patch('saved-reviews/:id')
  updateSavedReview(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() dto: UpdateSavedReviewDto,
  ) {
    return this.service.updateSavedReview(req.user.id, id, dto);
  }

  @Delete('saved-reviews/:id')
  deleteSavedReview(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.service.deleteSavedReview(req.user.id, id);
  }
}

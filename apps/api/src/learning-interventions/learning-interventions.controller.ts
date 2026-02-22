import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LearningInterventionsService } from './learning-interventions.service';
import {
  CreateInterventionDto,
  CreateInterventionSchema,
} from './dto/create-intervention.dto';

interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

@Controller('learning-interventions')
@UseGuards(JwtAuthGuard)
export class LearningInterventionsController {
  constructor(
    private readonly learningInterventionsService: LearningInterventionsService,
  ) {}

  /**
   * Test endpoint to verify module is active
   */
  @Post('test-connection')
  async testConnection() {
    const anthropicAvailable =
      this.learningInterventionsService.isAnthropicAvailable();
    return {
      status: 'Learning interventions module is active',
      anthropicAvailable,
    };
  }

  /**
   * Create a new learning intervention
   */
  @Post()
  @UsePipes(new ZodValidationPipe(CreateInterventionSchema))
  async createIntervention(
    @Request() req: { user: RequestUser },
    @Body() dto: CreateInterventionDto,
  ) {
    return this.learningInterventionsService.createIntervention(
      req.user.id,
      dto,
    );
  }

  /**
   * Get all interventions for the current user
   */
  @Get()
  async getInterventions(
    @Request() req: { user: RequestUser },
    @Query('courseId') courseId?: string,
  ) {
    return this.learningInterventionsService.getInterventions(
      req.user.id,
      courseId,
    );
  }

  /**
   * Get a single intervention by ID
   */
  @Get(':id')
  async getIntervention(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
  ) {
    return this.learningInterventionsService.getIntervention(id, req.user.id);
  }
}

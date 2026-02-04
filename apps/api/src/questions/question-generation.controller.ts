import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../auth';
import { QuestionGenerationService } from './question-generation.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('questions/generate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'admin')
export class QuestionGenerationController {
  constructor(private readonly genService: QuestionGenerationService) {}

  /**
   * POST /questions/generate
   * Generate questions via LLM + RAG
   */
  @Post()
  async generate(
    @Request() req: { user: RequestUser },
    @Body() dto: {
      courseId: string;
      types: string[];
      quantity: number;
      difficultyDistribution: { easy: number; medium: number; hard: number };
      bloomsDistribution?: Record<string, number>;
      kcFocus?: string[];
      sourceMode: 'lesson_based' | 'question_material' | 'mixed';
      selectedPageIds?: string[];
      selectedSourceIds?: string[];
      strictSource?: boolean;
      customPrompt?: string;
    },
  ) {
    const questions = await this.genService.generateQuestions({
      courseId: dto.courseId,
      userId: req.user.id,
      types: dto.types as any,
      quantity: dto.quantity,
      difficultyDistribution: dto.difficultyDistribution,
      bloomsDistribution: dto.bloomsDistribution,
      kcFocus: dto.kcFocus,
      sourceMode: dto.sourceMode,
      selectedPageIds: dto.selectedPageIds,
      selectedSourceIds: dto.selectedSourceIds,
      strictSource: dto.strictSource ?? false,
      customPrompt: dto.customPrompt,
    });
    return { questions };
  }

  /**
   * POST /questions/generate/save
   * Save accepted generated questions to Question Bank (and optionally to an assessment)
   */
  @Post('save')
  async save(
    @Request() req: { user: RequestUser },
    @Body() dto: {
      courseId: string;
      questions: any[];
      assessmentId?: string;
    },
  ) {
    const questionIds = await this.genService.saveGeneratedQuestions(
      dto.courseId,
      req.user.id,
      dto.questions,
      dto.assessmentId,
    );
    return { questionIds };
  }
}

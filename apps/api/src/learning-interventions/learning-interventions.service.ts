import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnthropicService } from '../rag/anthropic.service';
import { CreateInterventionDto } from './dto/create-intervention.dto';

@Injectable()
export class LearningInterventionsService {
  private readonly logger = new Logger(LearningInterventionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly anthropic: AnthropicService,
  ) {}

  /**
   * Create a new learning intervention
   */
  async createIntervention(userId: string, dto: CreateInterventionDto) {
    const intervention = await this.prisma.learningIntervention.create({
      data: {
        userId,
        courseId: dto.courseId,
        contentId: dto.contentId,
        selectedText: dto.selectedText,
        interventionType: dto.interventionType,
      },
    });

    this.logger.log(
      `Created ${dto.interventionType} intervention ${intervention.id} for user ${userId}`,
    );

    return intervention;
  }

  /**
   * Get all interventions for a user
   */
  async getInterventions(userId: string, courseId?: string) {
    const where: Record<string, any> = { userId };
    if (courseId) {
      where.courseId = courseId;
    }

    return this.prisma.learningIntervention.findMany({
      where,
      include: {
        practiceTests: true,
        stepwiseSessions: true,
        elaborationSessions: true,
        spacedRepetitionCards: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single intervention by ID
   */
  async getIntervention(interventionId: string, userId: string) {
    return this.prisma.learningIntervention.findFirst({
      where: {
        id: interventionId,
        userId,
      },
      include: {
        practiceTests: true,
        stepwiseSessions: true,
        elaborationSessions: true,
        spacedRepetitionCards: true,
      },
    });
  }

  /**
   * Check if Anthropic service is available
   */
  isAnthropicAvailable(): boolean {
    return this.anthropic.isAvailable();
  }
}

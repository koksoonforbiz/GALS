import {
  Controller,
  Post,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { EventBusService } from '../event-bus';
import { EventTopics } from '@ats/shared';
import type { GradeSubmissionPayload } from '@ats/shared';

@Controller('attempts')
export class GradingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  @Post(':id/submit')
  async submitAttempt(@Param('id') id: string, @Body() body: { textResponse?: string }) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: { question: true },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${id} not found`);
    }

    if (attempt.status !== 'in_progress') {
      throw new BadRequestException(
        `Attempt ${id} has already been submitted (status: ${attempt.status})`,
      );
    }

    const updated = await this.prisma.attempt.update({
      where: { id },
      data: {
        status: 'submitted',
        textResponse: body.textResponse ?? attempt.textResponse,
        submittedAt: new Date(),
      },
    });

    const payload: GradeSubmissionPayload = {
      attemptId: attempt.id,
      questionId: attempt.questionId,
      studentId: attempt.studentId,
      textResponse: body.textResponse ?? attempt.textResponse,
      drawingBlobUrl: attempt.drawingBlobUrl,
      maxScore: attempt.question.maxScore,
      rubricJson: attempt.question.rubricJson,
    };

    await this.eventBus.publish(EventTopics.GRADE_SUBMISSION, payload);

    return updated;
  }
}

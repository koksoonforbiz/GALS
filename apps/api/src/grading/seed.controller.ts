import { Controller, Post, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma';

@Controller('dev')
export class SeedController {
  private readonly logger = new Logger(SeedController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post('seed')
  async seed() {
    const env = this.config.get<string>('NODE_ENV', 'development');
    if (env !== 'development') {
      return { error: 'Seed endpoint is only available in development' };
    }

    const teacher = await this.prisma.user.create({
      data: {
        email: `teacher-${Date.now()}@test.com`,
        passwordHash: '$2b$10$placeholder',
        name: 'Dr. Smith',
        role: 'teacher',
      },
    });

    const student = await this.prisma.user.create({
      data: {
        email: `student-${Date.now()}@test.com`,
        passwordHash: '$2b$10$placeholder',
        name: 'Alice Student',
        role: 'student',
      },
    });

    const course = await this.prisma.course.create({
      data: {
        title: 'Biology 101',
        description: 'Introduction to Biology',
        teacherId: teacher.id,
      },
    });

    await this.prisma.enrollment.create({
      data: {
        studentId: student.id,
        courseId: course.id,
      },
    });

    const topic = await this.prisma.topic.create({
      data: {
        courseId: course.id,
        title: 'Photosynthesis',
        description: 'How plants convert light to energy',
        orderIndex: 0,
      },
    });

    const question = await this.prisma.question.create({
      data: {
        topicId: topic.id,
        prompt: 'What is the process by which plants convert sunlight into energy?',
        type: 'text',
        maxScore: 10,
        rubricJson: {
          answer_key: ['photosynthesis', 'the process of photosynthesis'],
        },
      },
    });

    const attempt = await this.prisma.attempt.create({
      data: {
        studentId: student.id,
        questionId: question.id,
        status: 'in_progress',
      },
    });

    this.logger.log('Seed data created successfully');

    return {
      teacherId: teacher.id,
      studentId: student.id,
      courseId: course.id,
      topicId: topic.id,
      questionId: question.id,
      attemptId: attempt.id,
    };
  }
}

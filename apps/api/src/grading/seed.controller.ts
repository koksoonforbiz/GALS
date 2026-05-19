import { Controller, Post, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
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

    const timestamp = Date.now();
    const passwordHash = await bcrypt.hash('password123', 10);

    const teacher = await this.prisma.user.create({
      data: {
        email: `teacher-${timestamp}@test.com`,
        passwordHash,
        name: 'Dr. Smith',
        role: 'teacher',
      },
    });

    const student = await this.prisma.user.create({
      data: {
        email: `student-${timestamp}@test.com`,
        passwordHash,
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
        prompt: `# What is Photosynthesis?

Explain the process by which plants convert sunlight into energy.

You may use the following formula for reference:

$$6CO_2 + 6H_2O \\xrightarrow{light} C_6H_{12}O_6 + 6O_2$$

**Your answer should include:**
- The main inputs and outputs
- The role of chlorophyll`,
        type: 'text',
        maxScore: 10,
        rubricJson: {
          answer_key: ['photosynthesis', 'the process of photosynthesis'],
        },
      },
    });

    // Create an assessment with the question
    const assessment = await this.prisma.assessment.create({
      data: {
        courseId: course.id,
        title: 'Photosynthesis Quiz',
        description: 'Test your understanding of photosynthesis',
        questions: {
          create: [{ questionId: question.id, orderIndex: 0 }],
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
      message: 'Seed data created successfully',
      credentials: {
        teacher: { email: `teacher-${timestamp}@test.com`, password: 'password123' },
        student: { email: `student-${timestamp}@test.com`, password: 'password123' },
      },
      ids: {
        teacherId: teacher.id,
        studentId: student.id,
        courseId: course.id,
        topicId: topic.id,
        questionId: question.id,
        assessmentId: assessment.id,
        attemptId: attempt.id,
      },
    };
  }
}

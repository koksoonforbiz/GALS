import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { QuestionGenerationController } from './question-generation.controller';
import { QuestionGenerationService } from './question-generation.service';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [QuestionGenerationController],
  providers: [QuestionGenerationService],
  exports: [QuestionGenerationService],
})
export class QuestionGenerationModule {}

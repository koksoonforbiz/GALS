import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { CurriculumCoverageService } from './curriculum-coverage.service';
import { CurriculumCoverageController } from './curriculum-coverage.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CurriculumCoverageController],
  providers: [CurriculumCoverageService],
  exports: [CurriculumCoverageService],
})
export class CurriculumCoverageModule {}

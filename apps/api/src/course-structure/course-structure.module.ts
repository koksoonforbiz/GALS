import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { CourseStructureService } from './course-structure.service';
import { CourseStructureController } from './course-structure.controller';

@Module({
  imports: [PrismaModule, RagModule],
  controllers: [CourseStructureController],
  providers: [CourseStructureService],
  exports: [CourseStructureService],
})
export class CourseStructureModule {}

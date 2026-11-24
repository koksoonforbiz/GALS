import { Module } from '@nestjs/common';
import { CourseGatesModule } from '../course-gates';
import { StudyNotesController } from './study-notes.controller';
import { StudyNotesService } from './study-notes.service';

@Module({
  imports: [CourseGatesModule],
  controllers: [StudyNotesController],
  providers: [StudyNotesService],
})
export class StudyNotesModule {}

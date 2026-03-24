import { Module, forwardRef } from '@nestjs/common';
import { RecordingController } from './recording.controller';
import { RecordingService } from './recording.service';
import { PyfeatModule } from '../pyfeat/pyfeat.module';
import { ActivityLogModule } from '../activity-log';

@Module({
  imports: [forwardRef(() => PyfeatModule), ActivityLogModule],
  controllers: [RecordingController],
  providers: [RecordingService],
  exports: [RecordingService],
})
export class RecordingModule {}

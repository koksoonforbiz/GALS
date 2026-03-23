import { Module, forwardRef } from '@nestjs/common';
import { RecordingController } from './recording.controller';
import { RecordingService } from './recording.service';
import { PyfeatModule } from '../pyfeat/pyfeat.module';

@Module({
  imports: [forwardRef(() => PyfeatModule)],
  controllers: [RecordingController],
  providers: [RecordingService],
  exports: [RecordingService],
})
export class RecordingModule {}

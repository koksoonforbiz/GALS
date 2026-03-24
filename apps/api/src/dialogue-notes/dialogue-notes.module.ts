import { Module } from '@nestjs/common';
import { DialogueNotesController } from './dialogue-notes.controller';
import { DialogueNotesService } from './dialogue-notes.service';

@Module({
  controllers: [DialogueNotesController],
  providers: [DialogueNotesService],
  exports: [DialogueNotesService],
})
export class DialogueNotesModule {}

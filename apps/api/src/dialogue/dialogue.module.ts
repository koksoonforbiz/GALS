import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { RagModule } from '../rag';
import { ActivityLogModule } from '../activity-log';
import { DialogueController } from './dialogue.controller';
import { DialogueService } from './dialogue.service';
import { StudioService } from './studio.service';
import { DialogueGateway } from './dialogue.gateway';
import { GuideGenerationPoller } from './guide-generation.poller';

@Module({
  imports: [PrismaModule, RagModule, ActivityLogModule],
  controllers: [DialogueController],
  providers: [DialogueService, StudioService, DialogueGateway, GuideGenerationPoller],
  exports: [DialogueService, DialogueGateway],
})
export class DialogueModule {}

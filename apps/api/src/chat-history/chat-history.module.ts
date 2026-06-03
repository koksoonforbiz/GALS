import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma';
import { ChatHistoryController } from './chat-history.controller';
import { ChatHistoryService } from './chat-history.service';

/**
 * Student-facing chat history (Prompt 01).
 *
 * Combines `chatbot_messages` (floating / docked standard-mode chatbot)
 * and `dialogue_messages` (dialogue-mode NotebookLM-style chat) into a
 * single review surface. Auth-required but student-scoped at the
 * service layer — see ChatHistoryService.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ChatHistoryController],
  providers: [ChatHistoryService],
  exports: [ChatHistoryService],
})
export class ChatHistoryModule {}

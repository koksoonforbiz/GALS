import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatHistoryService } from './chat-history.service';

interface RequestUser {
  id: string;
  role: string;
}

/**
 * Student-scoped chat history endpoints. Auth-required (JWT) but
 * intentionally NOT teacher-guarded — students need access to their
 * OWN conversation history. Every method extracts the student id from
 * the JWT and never trusts a caller-supplied id.
 *
 * Routes:
 *   GET /chat-history/me               — list all conversations
 *   GET /chat-history/me/:surface/:id  — full transcript
 */
@Controller('chat-history')
@UseGuards(JwtAuthGuard)
export class ChatHistoryController {
  constructor(private readonly service: ChatHistoryService) {}

  @Get('me')
  list(@Request() req: { user: RequestUser }) {
    // Ownership = req.user.id passed straight through. The service is
    // the source of truth for filtering, so even if a future caller
    // mutates the request payload it can't cross-account read.
    return this.service.listConversations(req.user.id);
  }

  @Get('me/:surface/:id')
  get(
    @Request() req: { user: RequestUser },
    @Param('surface') surface: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    if (surface !== 'chatbot' && surface !== 'dialogue') {
      throw new BadRequestException('surface must be "chatbot" or "dialogue"');
    }
    return this.service.getConversation(req.user.id, surface, id, {
      limit: limit ? parseInt(limit, 10) : undefined,
      before,
    });
  }
}

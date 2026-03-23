import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  Res,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DialogueNotesService } from './dialogue-notes.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller('dialogue-notes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DialogueNotesController {
  constructor(private readonly notesService: DialogueNotesService) {}

  @Post()
  @Roles('student')
  async create(
    @Request() req: { user: RequestUser },
    @Body()
    body: {
      sessionId: string;
      courseId: string;
      sourceDocumentId?: string;
      pageNumber?: number;
      highlightedText?: string;
      noteText: string;
      color?: string;
    },
  ) {
    return this.notesService.create({
      ...body,
      studentId: req.user.id,
    });
  }

  @Get()
  @Roles('student')
  async findBySession(
    @Request() req: { user: RequestUser },
    @Query('sessionId') sessionId: string,
  ) {
    return this.notesService.findBySession(sessionId, req.user.id);
  }

  @Patch(':id')
  @Roles('student')
  async update(
    @Request() req: { user: RequestUser },
    @Param('id') id: string,
    @Body() body: { noteText?: string; color?: string },
  ) {
    return this.notesService.update(id, req.user.id, body);
  }

  @Delete(':id')
  @Roles('student')
  async delete(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    return this.notesService.delete(id, req.user.id);
  }

  @Get('export/:sessionId')
  @Roles('student')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async exportNotes(
    @Request() req: { user: RequestUser },
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ) {
    const markdown = await this.notesService.exportAsMarkdown(sessionId, req.user.id);
    res.send(markdown);
  }
}

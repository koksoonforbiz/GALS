import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface CreateNoteInput {
  sessionId: string;
  courseId: string;
  studentId: string;
  sourceDocumentId?: string;
  pageNumber?: number;
  highlightedText?: string;
  noteText: string;
  color?: string;
}

interface UpdateNoteInput {
  noteText?: string;
  color?: string;
}

@Injectable()
export class DialogueNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateNoteInput) {
    return this.prisma.dialogueNote.create({
      data: {
        sessionId: input.sessionId,
        studentId: input.studentId,
        courseId: input.courseId,
        sourceDocumentId: input.sourceDocumentId || null,
        pageNumber: input.pageNumber ?? null,
        highlightedText: input.highlightedText || null,
        noteText: input.noteText,
        color: input.color || 'yellow',
      },
      include: {
        sourceDocument: { select: { originalName: true } },
      },
    });
  }

  async findBySession(sessionId: string, studentId: string) {
    return this.prisma.dialogueNote.findMany({
      where: { sessionId, studentId },
      orderBy: { createdAt: 'desc' },
      include: {
        sourceDocument: { select: { originalName: true } },
      },
    });
  }

  async update(id: string, studentId: string, data: UpdateNoteInput) {
    const note = await this.prisma.dialogueNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.studentId !== studentId) throw new ForbiddenException('Not your note');

    return this.prisma.dialogueNote.update({
      where: { id },
      data: {
        ...(data.noteText !== undefined ? { noteText: data.noteText } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
      },
      include: {
        sourceDocument: { select: { originalName: true } },
      },
    });
  }

  async delete(id: string, studentId: string) {
    const note = await this.prisma.dialogueNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.studentId !== studentId) throw new ForbiddenException('Not your note');

    return this.prisma.dialogueNote.delete({ where: { id } });
  }

  async exportAsMarkdown(sessionId: string, studentId: string): Promise<string> {
    const notes = await this.prisma.dialogueNote.findMany({
      where: { sessionId, studentId },
      orderBy: { createdAt: 'asc' },
      include: {
        sourceDocument: { select: { originalName: true } },
        session: { select: { title: true, createdAt: true, course: { select: { title: true } } } },
      },
    });

    if (notes.length === 0) return '# Notes\n\nNo notes saved yet.\n';

    const first = notes[0]!;
    const sessionDate = new Date(first.session.createdAt).toLocaleDateString();
    const courseName = first.session.course.title;

    const lines: string[] = [`# Notes -- ${sessionDate} -- ${courseName}\n`];

    notes.forEach((note, i) => {
      const label = note.sourceDocumentId
        ? `Note ${i + 1} -- Page ${note.pageNumber ?? '?'} -- ${note.sourceDocument?.originalName ?? 'Unknown'}`
        : `Note ${i + 1} -- Free-form`;

      lines.push(`## ${label}\n`);

      if (note.highlightedText) {
        lines.push(`> "${note.highlightedText}"\n`);
      }

      if (note.noteText) {
        lines.push(`Student comment: ${note.noteText}\n`);
      }

      lines.push('---\n');
    });

    return lines.join('\n');
  }
}

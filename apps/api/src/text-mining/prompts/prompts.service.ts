import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPromptsForCourse(_courseId: string) {
    // TODO stage 4
    return {};
  }

  async updatePrompt(
    _courseId: string,
    _constructKey: string,
    _promptText: string,
    _updatedBy: string,
  ) {
    // TODO stage 4
    return {};
  }

  async resetPrompts(_courseId: string, _constructKey?: string) {
    // TODO stage 4
  }
}

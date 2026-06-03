import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Replay annotations + codes (prompt 06).
 *
 * Researcher-scoped — every read/write is gated by `researcherId`
 * matching the requester so two researchers can independently code
 * the same session without seeing each other's notes.
 *
 * Annotations are additive. Captured streams are never mutated.
 */
@Injectable()
export class ReplayAnnotationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Codes ─────────────────────────────────────────────

  async listCodes(researcherId: string) {
    return this.prisma.replayCode.findMany({
      where: { researcherId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createCode(researcherId: string, body: { label: string; color?: string }) {
    return this.prisma.replayCode.create({
      data: {
        researcherId,
        label: body.label,
        color: body.color ?? null,
      },
    });
  }

  async updateCode(
    id: string,
    researcherId: string,
    body: { label?: string; color?: string | null },
  ) {
    const code = await this.prisma.replayCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('Code not found');
    if (code.researcherId !== researcherId) throw new ForbiddenException();
    return this.prisma.replayCode.update({
      where: { id },
      data: {
        ...(body.label != null ? { label: body.label } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
      },
    });
  }

  async deleteCode(id: string, researcherId: string) {
    const code = await this.prisma.replayCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('Code not found');
    if (code.researcherId !== researcherId) throw new ForbiddenException();
    // Annotations referencing this code keep their note text — the
    // FK is SET NULL so removing a code doesn't lose qualitative data.
    await this.prisma.replayCode.delete({ where: { id } });
    return { success: true };
  }

  // ─── Annotations ───────────────────────────────────────

  async listBySession(sessionId: string, researcherId: string) {
    const rows = await this.prisma.replayAnnotation.findMany({
      where: { sessionId, researcherId },
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
      include: { code: true },
    });
    return rows.map((r) => this.serialize(r));
  }

  async create(
    researcherId: string,
    body: {
      sessionId: string;
      codeId?: string | null;
      startMs: number;
      endMs?: number | null;
      note?: string | null;
    },
  ) {
    if (body.codeId) await this.assertCodeOwned(body.codeId, researcherId);
    const row = await this.prisma.replayAnnotation.create({
      data: {
        sessionId: body.sessionId,
        researcherId,
        codeId: body.codeId ?? null,
        startMs: BigInt(Math.max(0, Math.floor(body.startMs))),
        endMs:
          body.endMs != null && body.endMs > body.startMs
            ? BigInt(Math.floor(body.endMs))
            : null,
        note: body.note ?? null,
      },
      include: { code: true },
    });
    return this.serialize(row);
  }

  async update(
    id: string,
    researcherId: string,
    body: {
      codeId?: string | null;
      startMs?: number;
      endMs?: number | null;
      note?: string | null;
    },
  ) {
    const existing = await this.prisma.replayAnnotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Annotation not found');
    if (existing.researcherId !== researcherId) throw new ForbiddenException();
    if (body.codeId) await this.assertCodeOwned(body.codeId, researcherId);
    const row = await this.prisma.replayAnnotation.update({
      where: { id },
      data: {
        ...(body.codeId !== undefined ? { codeId: body.codeId } : {}),
        ...(body.startMs != null
          ? { startMs: BigInt(Math.max(0, Math.floor(body.startMs))) }
          : {}),
        ...(body.endMs !== undefined
          ? {
              endMs:
                body.endMs != null && body.endMs > (body.startMs ?? Number(existing.startMs))
                  ? BigInt(Math.floor(body.endMs))
                  : null,
            }
          : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      },
      include: { code: true },
    });
    return this.serialize(row);
  }

  async delete(id: string, researcherId: string) {
    const existing = await this.prisma.replayAnnotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Annotation not found');
    if (existing.researcherId !== researcherId) throw new ForbiddenException();
    await this.prisma.replayAnnotation.delete({ where: { id } });
    return { success: true };
  }

  // ─── Helpers ───────────────────────────────────────────

  private async assertCodeOwned(codeId: string, researcherId: string) {
    const code = await this.prisma.replayCode.findUnique({ where: { id: codeId } });
    if (!code || code.researcherId !== researcherId) {
      throw new ForbiddenException("Cannot attach a code you don't own");
    }
  }

  // BigInt → Number for JSON serialization. ms-precision offsets fit
  // comfortably in safe-integer range (~285M years), so no precision
  // loss in practice.
  private serialize(row: {
    id: string;
    sessionId: string;
    researcherId: string;
    codeId: string | null;
    startMs: bigint;
    endMs: bigint | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    code?: { id: string; label: string; color: string | null } | null;
  }) {
    return {
      id: row.id,
      sessionId: row.sessionId,
      researcherId: row.researcherId,
      codeId: row.codeId,
      code: row.code ?? null,
      startMs: Number(row.startMs),
      endMs: row.endMs != null ? Number(row.endMs) : null,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

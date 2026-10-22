import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';

export interface ClaimedSlot {
  slot: number;
  orderCode: string;
  t0: string;
  t1: string;
  t2: string;
}

export type OccasionCode = 'T0' | 'T1' | 'T2';

/** Form for an occasion from the student's order: T0 = 1st, T1 = 2nd, T2 = 3rd letter. */
export function formFor(slot: ClaimedSlot, occasion: OccasionCode): string {
  return occasion === 'T0' ? slot.t0 : occasion === 'T1' ? slot.t1 : slot.t2;
}

/**
 * Counterbalancing allocation (allocation.csv, six orders in permuted blocks of 6).
 * Each student gets the next unused row at their first T0 start, once per course.
 */
@Injectable()
export class EfaAllocationService {
  private readonly logger = new Logger(EfaAllocationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The student's slot in this course, or null if none claimed yet. */
  async current(studentId: string, courseId: string): Promise<ClaimedSlot | null> {
    return this.prisma.efaAllocationSlot.findFirst({
      where: { claimedStudentId: studentId, claimedCourseId: courseId },
      select: { slot: true, orderCode: true, t0: true, t1: true, t2: true },
    });
  }

  /**
   * Claim the lowest free slot atomically. A single UPDATE … WHERE slot =
   * (SELECT … FOR UPDATE SKIP LOCKED) means concurrent starts can never take
   * the same row (same pattern as EventBusService). Returns the existing slot
   * if this student already has one in this course; null when the table is
   * exhausted (staff must extend allocation.csv and rerun the seed).
   */
  async claim(studentId: string, courseId: string): Promise<ClaimedSlot | null> {
    const existing = await this.current(studentId, courseId);
    if (existing) return existing;

    const rows = await this.prisma.$queryRaw<
      Array<{ slot: number; order_code: string; t0: string; t1: string; t2: string }>
    >`
      UPDATE efa_allocation_slots
      SET claimed_at = now(),
          claimed_student_id = ${studentId}::uuid,
          claimed_course_id = ${courseId}::uuid
      WHERE slot = (
        SELECT slot FROM efa_allocation_slots
        WHERE claimed_at IS NULL
        ORDER BY slot
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING slot, order_code, t0, t1, t2
    `;
    const row = rows[0];
    if (!row) {
      this.logger.warn(`allocation table exhausted (student ${studentId}, course ${courseId})`);
      return null;
    }
    return { slot: row.slot, orderCode: row.order_code, t0: row.t0, t1: row.t1, t2: row.t2 };
  }
}

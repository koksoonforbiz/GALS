import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma';

export interface EfaStaff {
  id: string;
  role: string;
}

/**
 * Staff may manage the EF data of their own courses; admins of every
 * course. With `raters`, staff assigned as raters for the course (e.g. a
 * research assistant who does not own it) are let in too: coding only.
 */
export async function assertEfaStaff(
  prisma: PrismaService,
  staff: EfaStaff,
  courseId: string,
  opts: { raters?: boolean } = {},
) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { teacherId: true },
  });
  if (!course) throw new NotFoundException('Course not found');
  if (staff.role === 'admin' || course.teacherId === staff.id) return;
  if (
    opts.raters &&
    (await prisma.efaRaterAssignment.count({ where: { courseId, raterId: staff.id } }))
  )
    return;
  throw new ForbiddenException('You can only manage your own courses');
}

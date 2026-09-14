/**
 * OWASP API3:2023 (Broken Object Property Level Authorization) regression
 * test. `PATCH /courses/:id` used to accept `UpdateCourse &
 * Record<string, unknown>` with no validation pipe, so `dto` flowed
 * straight into a raw Prisma `data: dto` update (CoursesService.update) —
 * a caller who owns a course could reassign `teacherId` to someone else,
 * or set `status`/`visibility`/`archivedAt` etc. outside their dedicated,
 * more carefully gated endpoints. Now `courses.controller.ts` runs the
 * body through `ZodValidationPipe(UpdateCourseSchema)` first.
 *
 * This test exercises the same ZodValidationPipe + UpdateCourseSchema
 * combination the controller now uses, confirming any field outside the
 * schema's whitelist is stripped before it would ever reach Prisma.
 */

import { UpdateCourseSchema } from '@ats/shared';
import { ZodValidationPipe } from '../common';

describe('UpdateCourseSchema via ZodValidationPipe — mass-assignment protection', () => {
  const pipe = new ZodValidationPipe(UpdateCourseSchema);

  it('strips teacherId from the parsed body — cannot reassign course ownership through this route', () => {
    const result = pipe.transform({
      title: 'New title',
      teacherId: 'some-other-teacher-uuid',
    }) as Record<string, unknown>;

    expect(result.title).toBe('New title');
    expect(result).not.toHaveProperty('teacherId');
  });

  it('strips status/visibility/archivedAt/id — these have their own dedicated, gated endpoints', () => {
    const result = pipe.transform({
      title: 'New title',
      id: 'attacker-chosen-id',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      archivedAt: '2020-01-01T00:00:00.000Z',
      bannerBlobKey: 'not-mine.png',
    }) as Record<string, unknown>;

    expect(result).toEqual({ title: 'New title' });
  });

  it('still accepts every field the route is actually meant to update', () => {
    const result = pipe.transform({
      title: 'New title',
      description: 'New description',
      learningMode: 'DIALOGUE',
      allowStudentSelfEnroll: true,
      allowStudentSelfDrop: false,
    }) as Record<string, unknown>;

    expect(result).toEqual({
      title: 'New title',
      description: 'New description',
      learningMode: 'DIALOGUE',
      allowStudentSelfEnroll: true,
      allowStudentSelfDrop: false,
    });
  });
});

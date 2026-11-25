import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';

export const ANNOUNCEMENT_KINDS = [
  'maintenance',
  'action_required',
  'security_incident',
  'info',
] as const;
export const SEVERITIES = ['info', 'warning', 'critical'] as const;

export interface AnnouncementInput {
  kind: (typeof ANNOUNCEMENT_KINDS)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  body: string;
  courseId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maintenanceStart?: string | null;
  maintenanceEnd?: string | null;
  requireAck?: boolean;
}

type User = { id: string; role: string };

/**
 * Notices to students: scheduled maintenance, things to do, security or
 * data incidents, general information. A teacher posts to their own
 * courses; an admin can also post to every student (courseId null). A
 * security incident is always critical and always needs acknowledgement.
 */
@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Announcements a student should see now, with whether they acknowledged each. */
  async activeFor(userId: string) {
    const now = new Date();
    const courses = (
      await this.prisma.enrollment.findMany({
        where: { studentId: userId, status: 'ACTIVE' },
        select: { courseId: true },
      })
    ).map((e) => e.courseId);
    const rows = await this.prisma.announcement.findMany({
      where: {
        archivedAt: null,
        startsAt: { lte: now },
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          { OR: [{ courseId: null }, { courseId: { in: courses } }] },
        ],
      },
      include: { acks: { where: { userId }, select: { ackAt: true } } },
      orderBy: [{ startsAt: 'desc' }],
    });
    return rows.map(({ acks, ...a }) => ({ ...a, acknowledgedAt: acks[0]?.ackAt ?? null }));
  }

  async acknowledge(userId: string, id: string) {
    const a = await this.prisma.announcement.findUnique({ where: { id }, select: { id: true } });
    if (!a) throw new NotFoundException('Announcement not found');
    await this.prisma.announcementAck.upsert({
      where: { announcementId_userId: { announcementId: id, userId } },
      create: { announcementId: id, userId },
      update: {},
    });
    return { ok: true };
  }

  /** Staff list: own announcements (teacher) or all (admin), newest first, with ack counts. */
  async list(user: User) {
    const rows = await this.prisma.announcement.findMany({
      where: user.role === 'admin' ? {} : { createdBy: user.id },
      include: { _count: { select: { acks: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ _count, ...a }) => ({ ...a, acks: _count.acks }));
  }

  async create(user: User, input: AnnouncementInput) {
    await this.assertScope(user, input.courseId ?? null);
    return this.prisma.announcement.create({ data: this.toData(user, input) });
  }

  async update(user: User, id: string, input: AnnouncementInput) {
    await this.owned(user, id);
    await this.assertScope(user, input.courseId ?? null);
    const { createdBy: _keep, ...data } = this.toData(user, input);
    return this.prisma.announcement.update({ where: { id }, data });
  }

  async archive(user: User, id: string) {
    await this.owned(user, id);
    return this.prisma.announcement.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  private toData(user: User, i: AnnouncementInput) {
    const d = (v?: string | null) => (v ? new Date(v) : null);
    const incident = i.kind === 'security_incident';
    return {
      kind: i.kind,
      severity: incident ? 'critical' : i.severity,
      title: i.title.trim(),
      body: i.body.trim(),
      courseId: i.courseId ?? null,
      startsAt: d(i.startsAt) ?? new Date(),
      endsAt: d(i.endsAt),
      maintenanceStart: d(i.maintenanceStart),
      maintenanceEnd: d(i.maintenanceEnd),
      requireAck: incident ? true : !!i.requireAck,
      createdBy: user.id,
    };
  }

  private async owned(user: User, id: string) {
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Announcement not found');
    if (user.role !== 'admin' && a.createdBy !== user.id) {
      throw new ForbiddenException('Not your announcement');
    }
    return a;
  }

  /** Teachers post to their own courses; only an admin posts to everyone. */
  private async assertScope(user: User, courseId: string | null) {
    if (user.role === 'admin') return;
    if (!courseId) throw new ForbiddenException('Only an admin can post to every student');
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!c || c.teacherId !== user.id) throw new ForbiddenException('Not your course');
  }
}

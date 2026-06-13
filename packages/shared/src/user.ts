import { z } from 'zod';
import { UserRole } from './roles';

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: UserRole,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: UserRole,
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

// Login takes a single `identifier` (email OR teacher-assigned loginId)
// plus the password. Backend resolution rule (deterministic):
//   1. If `identifier` parses as an email → look it up in `users.email`.
//   2. Otherwise → look it up in `users.loginId`.
// Both columns are `UNIQUE`, so each lookup returns at most one user.
//
// Backwards-compatible aliases: callers that still send the old
// { email } or { loginId } shape (e.g. integration tests, scripted
// clients written before prompt 05) continue to validate. The
// transform collapses them into the canonical `identifier`. If more
// than one is supplied, `identifier` wins, then `email`, then `loginId`.
// Prompt 05 — the web client only sends `identifier`.
export const LoginSchema = z
  .object({
    identifier: z.string().min(1).optional(),
    email: z.string().email().optional(),
    loginId: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .transform((v) => ({
    identifier: v.identifier ?? v.email ?? v.loginId ?? '',
    password: v.password,
  }))
  .refine((v) => v.identifier.length > 0, {
    message: 'Identifier (email or login ID) is required',
    path: ['identifier'],
  });
export type Login = z.infer<typeof LoginSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  user: UserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Teacher bulk user provisioning (prompt 02) ─────────────────────
//
// The teacher's spreadsheet has three columns: `email`, `loginId`,
// `password`, plus optional `name` and `role`. Each row creates one
// `User`. Passwords are hashed server-side; the plaintext is never
// echoed back. Per-row results let the UI mark which rows succeeded.

// loginId character set: letters, digits, dot, underscore, hyphen.
// Constrained to ASCII so it's safe to type and unambiguous in CSV.
const LOGIN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export const BulkProvisionUserRowSchema = z.object({
  email: z.string().email(),
  loginId: z.string().min(3).max(64).regex(LOGIN_ID_PATTERN, {
    message: 'loginId may only contain letters, digits, dot, underscore, hyphen',
  }),
  password: z.string().min(6),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['student', 'teacher', 'admin']).optional(),
});
export type BulkProvisionUserRow = z.infer<typeof BulkProvisionUserRowSchema>;

export const BulkProvisionUsersSchema = z.object({
  rows: z.array(BulkProvisionUserRowSchema).min(1).max(500),
  // Optional course to also enroll the just-created users into. When
  // omitted, only user rows are created. The bulk-enroll endpoint can
  // still be called separately afterwards.
  enrollCourseId: z.string().uuid().optional(),
});
export type BulkProvisionUsers = z.infer<typeof BulkProvisionUsersSchema>;

export const BulkProvisionUserResultSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  email: z.string(),
  loginId: z.string(),
  status: z.enum(['created', 'skipped', 'error']),
  userId: z.string().uuid().optional(),
  message: z.string().optional(),
  // If enrollCourseId was supplied, this reports whether the row was
  // enrolled in that course. Independent of `status` because we may
  // skip user creation (existing user) but still enroll.
  enrollment: z
    .object({
      status: z.enum(['enrolled', 'already_enrolled', 'reactivated', 'error', 'skipped']),
      message: z.string().optional(),
    })
    .optional(),
});
export type BulkProvisionUserResult = z.infer<typeof BulkProvisionUserResultSchema>;

export const BulkProvisionUsersResponseSchema = z.object({
  results: z.array(BulkProvisionUserResultSchema),
  summary: z.object({
    created: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
    enrolled: z.number().int().nonnegative().optional(),
  }),
});
export type BulkProvisionUsersResponse = z.infer<typeof BulkProvisionUsersResponseSchema>;

// ── Bulk enrollment (prompt 02) ────────────────────────────────────

export const BulkEnrollSchema = z.object({
  courseId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(1000),
});
export type BulkEnroll = z.infer<typeof BulkEnrollSchema>;

export const BulkEnrollResultRowSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(['enrolled', 'already_enrolled', 'reactivated', 'error', 'skipped']),
  enrollmentId: z.string().uuid().optional(),
  message: z.string().optional(),
});
export type BulkEnrollResultRow = z.infer<typeof BulkEnrollResultRowSchema>;

export const BulkEnrollResponseSchema = z.object({
  results: z.array(BulkEnrollResultRowSchema),
  summary: z.object({
    enrolled: z.number().int().nonnegative(),
    alreadyEnrolled: z.number().int().nonnegative(),
    errored: z.number().int().nonnegative(),
  }),
});
export type BulkEnrollResponse = z.infer<typeof BulkEnrollResponseSchema>;

// ── Teacher-issued password reset (prompt 05) ──────────────────────
//
// A teacher/admin sets a student's password to a value of THEIR
// choice. No token round-trip, no email reset link, no student
// self-service — students never set or change their own password.
// Backend re-hashes with bcryptjs(pw, 10) (the existing library, same
// salt rounds as register/bulk-provision), updates `passwordHash`, and
// sets `isTemporaryPassword = true` so the teacher roster still shows
// the "Temp pwd" badge until the teacher decides otherwise.
//
// Strength rules match the existing bulk-provision row: min 6 chars.
// We don't enforce the uppercase/lowercase/digit triple here so a
// teacher can use a simple memorable handout password and rotate it
// later. The endpoint is teacher/admin-guarded so the floor is
// "trusted user with course access", not "internet".
export const ResetStudentPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});
export type ResetStudentPassword = z.infer<typeof ResetStudentPasswordSchema>;

export const ResetStudentPasswordResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  message: z.string(),
});
export type ResetStudentPasswordResponse = z.infer<typeof ResetStudentPasswordResponseSchema>;

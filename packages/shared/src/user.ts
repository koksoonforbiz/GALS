import { z } from 'zod';
import { UserRole } from './roles';

// Shared password-complexity rule (SMU cybersecurity checklist item 3):
// 12+ chars, at least one digit, one lowercase, one uppercase, one
// special character. Applied everywhere a password is SET — public
// self-registration, teacher bulk-provisioning, and teacher-issued
// resets — so there's exactly one place to update the policy.
const PASSWORD_COMPLEXITY = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[~!@#$%^&*\-+?]/, 'Password must contain at least one special character (~!@#$%^&*-+?)');

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
  role: UserRole,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

// Public self-registration only ever creates a student or teacher account.
// Admin accounts are never created through this endpoint — deliberately
// narrower than UserRole (which also includes 'admin') so an unauthenticated
// caller can't POST { role: "admin" } and grant themselves admin access.
export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: PASSWORD_COMPLEXITY,
  name: z.string().min(1),
  role: z.enum(['student', 'teacher']),
  // SMU checklist item 35 — general data-collection consent, required
  // at signup. See TermsAcceptedSchema's doc comment for the caveat on
  // the actual policy text.
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to create an account' }),
  }),
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
  sessionId: z.string().optional(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Two-factor authentication (email-OTP or TOTP) ──────────────────
//
// Exactly one method active per account at a time (or none) — enabling
// either method overwrites whichever was previously active. Same lowercase
// string-literal convention as UserRole (roles.ts); the Prisma enum uses
// the exact same values, no casing translation between the two.
export const TwoFactorMethodSchema = z.enum(['email', 'totp']);
export type TwoFactorMethod = z.infer<typeof TwoFactorMethodSchema>;

// Email-OTP: no persistent secret is exchanged with the client — a
// 6-digit code is generated per challenge and emailed to the account's
// address; the server tracks the challenge in Redis only (see
// TwoFactorService in apps/api/src/auth). TOTP: no code is generated
// server-side at all — the client's authenticator app computes it from a
// secret exchanged once during setup (see TotpSetupResponseSchema below).
// Either way, `challengeId` is an opaque handle the client carries from
// the initial /auth/login call through to /auth/2fa/verify.
export const TwoFactorPendingResponseSchema = z.object({
  twoFactorRequired: z.literal(true),
  challengeId: z.string().uuid(),
  method: TwoFactorMethodSchema,
});
export type TwoFactorPendingResponse = z.infer<typeof TwoFactorPendingResponseSchema>;

export const LoginResponseSchema = z.union([AuthResponseSchema, TwoFactorPendingResponseSchema]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const TwoFactorVerifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().length(6, 'Code must be 6 digits').regex(/^\d+$/, 'Code must be 6 digits'),
});
export type TwoFactorVerify = z.infer<typeof TwoFactorVerifySchema>;

export const TwoFactorResendSchema = z.object({
  challengeId: z.string().uuid(),
});
export type TwoFactorResend = z.infer<typeof TwoFactorResendSchema>;

export const TwoFactorDisableSchema = z.object({
  password: z.string().min(1),
});
export type TwoFactorDisable = z.infer<typeof TwoFactorDisableSchema>;

// ── TOTP (authenticator app) enrollment ─────────────────────────────
//
// POST /auth/2fa/totp/setup returns this — a fresh secret (not yet
// persisted) plus a QR code the client just renders as an <img>. `secret`
// doubles as the "can't scan? enter manually" fallback shown alongside it.
export const TotpSetupResponseSchema = z.object({
  secret: z.string(),
  qrCodeDataUrl: z.string(),
});
export type TotpSetupResponse = z.infer<typeof TotpSetupResponseSchema>;

// POST /auth/2fa/totp/setup/confirm — proves the user's authenticator app
// actually has the secret before it's persisted as their active method.
export const TotpSetupConfirmSchema = z.object({
  code: z.string().length(6, 'Code must be 6 digits').regex(/^\d+$/, 'Code must be 6 digits'),
});
export type TotpSetupConfirm = z.infer<typeof TotpSetupConfirmSchema>;

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
  // Was min(6) with no complexity rule ("simple memorable handout
  // password"). Tightened to the shared policy for SMU checklist item
  // 3 — teachers provisioning a roster now need a generator/template
  // rather than a hand-typed simple password. If that trade-off turns
  // out to be too much friction for real classroom use, this is the
  // one line to relax back.
  password: PASSWORD_COMPLEXITY,
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
// choice. No token round-trip, no email reset link. This remains the
// only recovery path for a user who is fully locked out (forgot their
// password with no way to prove identity) — see ChangePasswordSchema
// below for the self-service path added later, for a user who still
// knows their current password.
// Backend re-hashes with bcryptjs(pw, 10) (the existing library, same
// salt rounds as register/bulk-provision), updates `passwordHash`, and
// sets `isTemporaryPassword = true` so the teacher roster still shows
// the "Temp pwd" badge and the user is forced to change it on next
// login (see ChangePasswordSchema).
//
// Was min(8) with no complexity rule. Tightened to the shared policy
// for SMU checklist item 3 (see BulkProvisionUserRowSchema's comment
// for the same trade-off note).
export const ResetStudentPasswordSchema = z.object({
  newPassword: PASSWORD_COMPLEXITY,
});
export type ResetStudentPassword = z.infer<typeof ResetStudentPasswordSchema>;

export const ResetStudentPasswordResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  message: z.string(),
});
export type ResetStudentPasswordResponse = z.infer<typeof ResetStudentPasswordResponseSchema>;

// ── Self-service password change (SMU checklist item 5) ────────────
//
// POST /auth/change-password — for an already-authenticated user who
// still knows their current password. Deliberately does NOT send
// email: no forgot-password / reset-link flow exists in this system.
// A user who is fully locked out has no self-service recovery; the
// only path is a teacher/admin reset (ResetStudentPasswordSchema
// above), which also sets isTemporaryPassword so this endpoint's
// caller is then forced to change it again on next login.
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PASSWORD_COMPLEXITY,
});
export type ChangePassword = z.infer<typeof ChangePasswordSchema>;

import { z } from 'zod';

export const UserRole = z.enum(['student', 'teacher', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

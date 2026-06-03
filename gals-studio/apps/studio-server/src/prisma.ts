import { ensureDataDir } from './config.js';

ensureDataDir();

// Import after the DB url env is guaranteed set.
const { PrismaClient } = await import('@prisma/client');

export const prisma = new PrismaClient();
export type Prisma = typeof prisma;

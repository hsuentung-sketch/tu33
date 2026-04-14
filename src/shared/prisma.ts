import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { auditExtension } from './audit.js';

function create() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
  return base.$extends(auditExtension);
}

export type ExtendedPrismaClient = ReturnType<typeof create>;

const globalForPrisma = globalThis as unknown as {
  prisma?: ExtendedPrismaClient;
};

export const prisma: ExtendedPrismaClient = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

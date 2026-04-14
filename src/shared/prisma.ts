import { PrismaClient } from '@prisma/client';
import { auditExtension } from './audit.js';

function create() {
  const base = new PrismaClient({
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

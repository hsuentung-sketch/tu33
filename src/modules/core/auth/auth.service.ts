import { randomBytes } from 'node:crypto';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';

// In-memory binding code store (code → { tenantId, employeeId, expiresAt }).
// Keeping this in-process is fine for single-node deploys; for multi-node,
// swap for Redis or a DB table.
interface BindingEntry {
  tenantId: string;
  employeeId: string;
  expiresAt: number;
}
const BINDING_STORE = new Map<string, BindingEntry>();
const BINDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

function sweepExpired(now: number): void {
  for (const [code, entry] of BINDING_STORE) {
    if (entry.expiresAt <= now) BINDING_STORE.delete(code);
  }
}

export async function findEmployeeByLineUserId(lineUserId: string) {
  return prisma.employee.findUnique({
    where: { lineUserId },
    include: { tenant: true },
  });
}

export async function bindLineUser(
  tenantId: string,
  employeeId: string,
  lineUserId: string,
) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
  });
  if (!employee) {
    throw new NotFoundError('Employee', employeeId);
  }
  return prisma.employee.update({
    where: { id: employeeId },
    data: { lineUserId },
  });
}

export async function getTenantByLineChannel(channelId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { lineChannelId: channelId },
  });
  if (!tenant) {
    throw new NotFoundError('Tenant');
  }
  return tenant;
}

/**
 * Create a one-time binding code that an employee can send to the LINE bot
 * to link their LINE account.
 */
export async function createBindingCode(
  tenantId: string,
  employeeId: string,
): Promise<{ code: string; expiresAt: Date }> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId, isActive: true },
  });
  if (!employee) {
    throw new NotFoundError('Employee', employeeId);
  }
  if (employee.lineUserId) {
    throw new ValidationError('Employee is already bound to a LINE account');
  }

  sweepExpired(Date.now());

  // 6-char alphanumeric code, uppercase, avoiding ambiguous 0/O, 1/I.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];

  const expiresAt = Date.now() + BINDING_TTL_MS;
  BINDING_STORE.set(code, { tenantId, employeeId, expiresAt });
  return { code, expiresAt: new Date(expiresAt) };
}

/**
 * Consume a binding code: if valid, attach lineUserId to the employee.
 * Returns the updated employee, or null if code invalid/expired.
 */
export async function tryConsumeBindingCode(
  tenantId: string,
  code: string,
  lineUserId: string,
) {
  sweepExpired(Date.now());
  const entry = BINDING_STORE.get(code);
  if (!entry || entry.tenantId !== tenantId) return null;

  BINDING_STORE.delete(code);

  // Guard: if this lineUserId is already bound to someone else in this tenant,
  // reject so we don't silently steal the binding.
  const existing = await prisma.employee.findFirst({
    where: { tenantId, lineUserId },
  });
  if (existing && existing.id !== entry.employeeId) return null;

  return prisma.employee.update({
    where: { id: entry.employeeId },
    data: { lineUserId },
  });
}

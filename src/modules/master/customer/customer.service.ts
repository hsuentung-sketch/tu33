import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { NotFoundError } from '../../../shared/errors.js';

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean; createdBy?: string } = {},
) {
  // Explicit select — see findByName for why (createdBy column may not
  // yet exist on production DB). Keep list callers (management handler,
  // master handler) unaffected by schema drift.
  return prisma.customer.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.createdBy
        ? {
            OR: [
              { createdByEmployeeId: opts.createdBy },
              { createdBy: opts.createdBy },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      contactName: true,
      title: true,
      phone: true,
      email: true,
      taxId: true,
      zipCode: true,
      address: true,
      paymentDays: true,
      statementDay: true,
      fixedPaymentDay: true,
      paymentMethod: true,
      bankCode: true,
      bankName: true,
      bankAccountLast5: true,
      createdByEmployeeId: true,
      createdBy: true,
      createdByEmployee: { select: { name: true, employeeId: true } },
      grade: true,
      priceTier: true,
      tags: true,
      isActive: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId },
  });
  if (!customer) {
    throw new NotFoundError('Customer', id);
  }
  return customer;
}

/**
 * SALES 規則：自己建的或歷史資料（createdBy/createdByEmployeeId 為 null）公開。
 * 過渡期同時看舊欄位 `createdBy` 與新 FK `createdByEmployeeId`。
 * ADMIN / 其他角色不檢查。
 */
export function canSalesAccessCustomer(
  customer: { createdBy?: string | null; createdByEmployeeId?: string | null },
  meId: string,
): boolean {
  const owner = customer.createdByEmployeeId ?? customer.createdBy ?? null;
  return owner === null || owner === meId;
}

export async function create(
  tenantId: string,
  data: {
    name: string;
    contactName?: string;
    title?: string;
    taxId?: string;
    phone?: string;
    zipCode?: string;
    address?: string;
    paymentDays?: number;
    statementDay?: number | null;
    fixedPaymentDay?: number | null;
    paymentMethod?: 'check' | 'cash' | 'transfer' | null;
    bankCode?: string;
    bankName?: string;
    bankAccountLast5?: string;
    createdByEmployeeId?: string | null;
    lineUserId?: string;
    email?: string;
    grade?: string;
    priceTier?: number;
    tags?: string[];
    createdBy?: string;
  },
) {
  // Schema has `createdBy` on all tenant DBs since 2026-03; the P2022
  // retry hack is no longer needed.
  // 過渡期：同時寫 createdBy（舊純字串）與 createdByEmployeeId（新 FK），
  // 任一有值都同步另一邊。讀取時先用新 FK。
  const explicitEmpId = data.createdByEmployeeId ?? null;
  const legacyId = data.createdBy ?? null;
  const ownerId = explicitEmpId ?? legacyId;
  return prisma.customer.create({
    data: {
      tenantId,
      name: data.name,
      contactName: data.contactName,
      title: data.title,
      taxId: data.taxId,
      phone: data.phone,
      zipCode: data.zipCode,
      address: data.address,
      paymentDays: data.paymentDays ?? 30,
      statementDay: data.statementDay ?? null,
      fixedPaymentDay: data.fixedPaymentDay ?? null,
      paymentMethod: data.paymentMethod ?? null,
      bankCode: data.bankCode,
      bankName: data.bankName,
      bankAccountLast5: data.bankAccountLast5,
      createdByEmployeeId: ownerId,
      createdBy: ownerId,
      lineUserId: data.lineUserId,
      email: data.email,
      grade: data.grade ?? 'B',
      priceTier: data.priceTier ?? 1,
      tags: data.tags ?? [],
    },
  });
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.CustomerUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.customer.update({
    where: { id },
    data,
  });
}

export async function deactivate(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.customer.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function findByName(
  tenantId: string,
  query: string,
  opts: { createdBy?: string } = {},
) {
  // Explicit select: keeps the LIFF autocomplete payload small AND
  // protects against the case where a newly-added column (e.g.
  // `createdBy`) hasn't been pushed to the production DB yet — the
  // default `findMany` without `select` would SELECT every column and
  // 500 on the missing one.
  const ownerFilter = opts.createdBy
    ? {
        AND: [
          {
            OR: [
              { createdByEmployeeId: opts.createdBy },
              { createdBy: opts.createdBy },
            ],
          },
        ],
      }
    : {};
  return prisma.customer.findMany({
    where: {
      tenantId,
      isActive: true,
      ...ownerFilter,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { contactName: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      name: true,
      contactName: true,
      title: true,
      phone: true,
      email: true,
      taxId: true,
      zipCode: true,
      address: true,
      paymentDays: true,
      statementDay: true,
      fixedPaymentDay: true,
      paymentMethod: true,
      grade: true,
      priceTier: true,
      tags: true,
    },
    orderBy: { name: 'asc' },
    take: 20,
  });
}

/**
 * 取出 AR 計算需要的客戶結帳資訊。被 sales-order service / 匯入工具呼叫。
 */
export async function getBillingProfile(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      paymentDays: true,
      statementDay: true,
      fixedPaymentDay: true,
      paymentMethod: true,
    },
  });
  if (!customer) throw new NotFoundError('Customer', customerId);
  return customer;
}

export async function getPaymentDays(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, paymentDays: true },
  });
  if (!customer) {
    throw new NotFoundError('Customer', customerId);
  }
  return customer;
}

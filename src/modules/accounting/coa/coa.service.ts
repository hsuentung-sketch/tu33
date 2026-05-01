/**
 * Chart of Accounts service.
 *
 * 啟用會計模組時，由 activation flow 種子預設範本到此 tenant；
 * 啟用後 ADMIN 可新增非系統科目（isSystem=false 才能停用/刪除）。
 */
import { prisma } from '../../../shared/prisma.js';
import { ValidationError, NotFoundError } from '../../../shared/errors.js';
import { DEFAULT_COA, SYSTEM_ACCOUNT_CODES } from './default-coa-template.js';

export async function list(tenantId: string, opts: { type?: string; activeOnly?: boolean } = {}) {
  return prisma.chartOfAccount.findMany({
    where: {
      tenantId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.activeOnly ? { isActive: true } : {}),
    },
    orderBy: { code: 'asc' },
  });
}

export async function getByCode(tenantId: string, code: string) {
  return prisma.chartOfAccount.findUnique({
    where: { tenantId_code: { tenantId, code } },
  });
}

export async function getById(tenantId: string, id: string) {
  const a = await prisma.chartOfAccount.findFirst({ where: { id, tenantId } });
  if (!a) throw new NotFoundError('科目不存在');
  return a;
}

/** 啟用流程：把 DEFAULT_COA 種子到此 tenant。已存在的 code 不覆蓋。 */
export async function seedDefaultTemplate(tenantId: string): Promise<{ inserted: number; skipped: number }> {
  // 第一輪建 level=1，第二輪建 level=2 並關聯 parentId
  const codeToId = new Map<string, string>();
  const existing = await prisma.chartOfAccount.findMany({
    where: { tenantId },
    select: { id: true, code: true },
  });
  for (const e of existing) codeToId.set(e.code, e.id);

  let inserted = 0;
  let skipped = 0;
  // level 1
  for (const r of DEFAULT_COA.filter((x) => x.level === 1)) {
    if (codeToId.has(r.code)) { skipped++; continue; }
    const created = await prisma.chartOfAccount.create({
      data: {
        tenantId, code: r.code, name: r.name, level: 1,
        type: r.type, normalSide: r.normalSide,
        isSystem: r.isSystem, isActive: true,
        description: r.description ?? null,
      },
    });
    codeToId.set(r.code, created.id);
    inserted++;
  }
  // level 2+
  for (const r of DEFAULT_COA.filter((x) => x.level >= 2)) {
    if (codeToId.has(r.code)) { skipped++; continue; }
    const parentId = r.parent ? codeToId.get(r.parent) : null;
    const created = await prisma.chartOfAccount.create({
      data: {
        tenantId, code: r.code, name: r.name, level: r.level,
        parentId: parentId ?? null,
        type: r.type, normalSide: r.normalSide,
        isSystem: r.isSystem, isActive: true,
        description: r.description ?? null,
      },
    });
    codeToId.set(r.code, created.id);
    inserted++;
  }
  return { inserted, skipped };
}

export async function getSystemAccount(tenantId: string, key: keyof typeof SYSTEM_ACCOUNT_CODES) {
  const code = SYSTEM_ACCOUNT_CODES[key];
  const a = await getByCode(tenantId, code);
  if (!a) throw new NotFoundError(`系統科目 ${code} (${key}) 不存在 — 是否已啟用會計模組？`);
  return a;
}

export async function create(tenantId: string, data: {
  code: string; name: string; type: string; normalSide: string;
  level?: number; parentId?: string | null; description?: string | null;
}) {
  if (!/^\d{4}$/.test(data.code)) throw new ValidationError('科目編號需 4 位數字');
  const exists = await getByCode(tenantId, data.code);
  if (exists) throw new ValidationError(`科目 ${data.code} 已存在`);
  return prisma.chartOfAccount.create({
    data: {
      tenantId, code: data.code, name: data.name,
      type: data.type, normalSide: data.normalSide,
      level: data.level ?? 2, parentId: data.parentId ?? null,
      description: data.description ?? null,
      isSystem: false, isActive: true,
    },
  });
}

export async function update(tenantId: string, id: string, data: {
  name?: string; description?: string | null; isActive?: boolean;
}) {
  const a = await getById(tenantId, id);
  return prisma.chartOfAccount.update({
    where: { id: a.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });
}

export async function remove(tenantId: string, id: string) {
  const a = await getById(tenantId, id);
  if (a.isSystem) throw new ValidationError('系統預設科目不可刪除（可改名稱或停用）');
  // 有交易過的科目不可刪
  const used = await prisma.journalLine.findFirst({ where: { accountId: a.id }, select: { id: true } });
  if (used) throw new ValidationError('此科目已有傳票引用，無法刪除（可改為停用）');
  await prisma.chartOfAccount.delete({ where: { id: a.id } });
}

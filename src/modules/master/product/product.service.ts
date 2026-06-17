import type { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/prisma.js';
import { AppError, NotFoundError } from '../../../shared/errors.js';

/**
 * v2.10.1: 把 Prisma P2002（product code 撞舊資料）翻成可行動的中文訊息。
 * Product.code 的 unique 是 (tenantId, code)；清單預設隱藏停用品項，
 * 所以使用者常常「看不到重複的卻被擋」。回查同 code 的產品（含停用）並
 * 在錯誤訊息中明示，省得使用者一頭霧水。
 */
async function explainProductCodeConflict(
  tenantId: string,
  code: string,
): Promise<never> {
  const existing = await prisma.product.findFirst({
    where: { tenantId, code },
    select: { name: true, isActive: true },
  });
  if (existing) {
    const status = existing.isActive === false ? '已停用' : '啟用中';
    throw new AppError(
      409,
      `產品編號「${code}」已被使用（產品「${existing.name}」，狀態：${status}）。請改用其他編號；若要重新啟用該品項，請勾「含停用」後編輯。`,
      'CONFLICT',
    );
  }
  throw new AppError(409, `產品編號「${code}」重複。`, 'CONFLICT');
}

export async function list(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
) {
  return prisma.product.findMany({
    where: {
      tenantId,
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    orderBy: { code: 'asc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const product = await prisma.product.findFirst({
    where: { id, tenantId },
  });
  if (!product) {
    throw new NotFoundError('Product', id);
  }
  return product;
}

export async function create(
  tenantId: string,
  data: {
    code: string;
    name: string;
    category?: string;
    salePrice: number;
    costPrice: number;
    note?: string;
  },
) {
  try {
    return await prisma.product.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        category: data.category,
        salePrice: data.salePrice,
        costPrice: data.costPrice,
        note: data.note,
      },
    });
  } catch (err) {
    const e = err as { code?: string };
    if (e?.code === 'P2002') {
      await explainProductCodeConflict(tenantId, data.code);
    }
    throw err;
  }
}

export async function update(
  tenantId: string,
  id: string,
  data: Prisma.ProductUpdateInput,
) {
  await getById(tenantId, id);
  return prisma.product.update({
    where: { id },
    data,
  });
}

export async function deactivate(tenantId: string, id: string) {
  await getById(tenantId, id);
  return prisma.product.update({
    where: { id },
    data: { isActive: false },
  });
}

export async function findByNameOrCode(tenantId: string, query: string) {
  return prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { name: 'asc' },
    take: 20,
  });
}

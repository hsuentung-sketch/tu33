/**
 * 業績獎金（commission）月結計算（v2.15.0+）。
 *
 * 公式：單筆獎金 =（成交單價 unitPrice − 成交時售價 salePriceAtSale）× quantity。
 * salePriceAtSale 為成交快照；無快照（歷史 / 自由輸入品名）→ fallback 當前
 * Product.salePrice；連產品都查不到 → 用成交價（該筆獎金 0）。
 * 建單時已擋「成交價 < 售價」，故單筆獎金恆 ≥ 0。
 *
 * 詳見 docs/modules/commission.md。
 */
import { prisma } from '../../../shared/prisma.js';

export interface CommissionItemRow {
  productName: string;
  quantity: number;
  unitPrice: number;
  salePrice: number;
  bonus: number;
  /** true = 無成交快照，用當前產品售價估算（提醒此筆獎金可能隨改價變動） */
  isFallback: boolean;
}

export interface CommissionOrderRow {
  orderNo: string;
  orderDate: string; // YYYY-MM-DD
  customerName: string;
  salesPersonName: string;
  createdBy: string;
  items: CommissionItemRow[];
  orderBonus: number;
}

export interface CommissionReport {
  year: number;
  month: number;
  employeeId: string | null;
  rows: CommissionOrderRow[];
  totalBonus: number;
  deductPct: number;
  netAmount: number;
}

const ALLOWED_DEDUCT = [0, 8, 10, 13];

export async function getMonthlyReport(
  tenantId: string,
  opts: { year: number; month: number; employeeId?: string; deductPct?: number },
): Promise<CommissionReport> {
  const { year, month, employeeId } = opts;
  // orderDate 在建單時以 new Date(年,月-1,日) 寫入（UTC 容器 = 該日 00:00 UTC）；
  // 月邊界用同樣構造保持一致。
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const orders = await prisma.salesOrder.findMany({
    where: {
      tenantId,
      isDeleted: false,
      orderDate: { gte: start, lt: end },
      ...(employeeId ? { createdBy: employeeId } : {}),
    },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      customer: { select: { name: true } },
    },
    orderBy: { orderDate: 'asc' },
  });

  // fallback：無快照的品項查當前產品售價。
  const fallbackNames = [
    ...new Set(
      orders.flatMap((o) =>
        o.items.filter((it) => it.salePriceAtSale == null).map((it) => it.productName),
      ),
    ),
  ];
  const products = fallbackNames.length
    ? await prisma.product.findMany({
        where: { tenantId, name: { in: fallbackNames } },
        select: { name: true, salePrice: true },
      })
    : [];
  const curPrice = new Map(products.map((p) => [p.name, Number(p.salePrice)]));

  // 業務姓名對照（createdBy → name），salesPerson 字串為主、查不到再 fallback。
  const empIds = [...new Set(orders.map((o) => o.createdBy))];
  const emps = empIds.length
    ? await prisma.employee.findMany({
        where: { tenantId, id: { in: empIds } },
        select: { id: true, name: true },
      })
    : [];
  const empName = new Map(emps.map((e) => [e.id, e.name]));

  const rows: CommissionOrderRow[] = [];
  let totalBonus = 0;

  for (const o of orders) {
    const items: CommissionItemRow[] = [];
    let orderBonus = 0;
    for (const it of o.items) {
      const snap = it.salePriceAtSale == null ? null : Number(it.salePriceAtSale);
      const unitPrice = Number(it.unitPrice);
      // 快照優先；無 → 當前售價；都無 → 用成交價（獎金 0）
      const salePrice = snap ?? curPrice.get(it.productName) ?? unitPrice;
      const bonus = (unitPrice - salePrice) * it.quantity;
      orderBonus += bonus;
      items.push({
        productName: it.productName,
        quantity: it.quantity,
        unitPrice,
        salePrice,
        bonus,
        isFallback: snap == null,
      });
    }
    totalBonus += orderBonus;
    rows.push({
      orderNo: o.orderNo,
      orderDate: o.orderDate.toISOString().slice(0, 10),
      customerName: o.customer.name,
      salesPersonName: o.salesPerson || empName.get(o.createdBy) || o.createdBy,
      createdBy: o.createdBy,
      items,
      orderBonus,
    });
  }

  const deductPct = ALLOWED_DEDUCT.includes(opts.deductPct ?? 0) ? (opts.deductPct ?? 0) : 0;
  const netAmount = Math.round(totalBonus * (1 - deductPct / 100));

  return { year, month, employeeId: employeeId ?? null, rows, totalBonus, deductPct, netAmount };
}

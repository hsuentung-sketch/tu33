/**
 * 業績獎金（commission）月結計算（v2.16.0 改寫）。
 *
 * 公式（毛利分潤，扣營業稅）：
 *   每張單獎金 = Σ(成交單價 unitPrice − 成交時進價 costAtSale) × 數量 − 該單營業稅
 *   累積獎金   = Σ每張單獎金
 *   實發金額   = max(0, 累積 × (1 − 該業務員工稅率 taxDeductRate/100))
 *
 * costAtSale 為成交快照；無快照（歷史 / 自由輸入品名）→ fallback 當前 Product.costPrice；
 * 連產品都查不到 → 用成交價（該筆毛利 0）。負獎金（虧本單）照實抵減累積，
 * 但實發以 max(0,...) 保護，不倒扣業務。
 *
 * 報表針對「單一業務」（employeeId 必填，因實發需該業務的稅率）。
 * 業務（SALES）模式 includeItemDetail=false：只回每張單獎金，不回進價 / 毛利明細（不洩漏成本）。
 *
 * 詳見 docs/modules/commission.md。
 */
import { prisma } from '../../../shared/prisma.js';

export interface CommissionItemRow {
  productName: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  grossProfit: number; // (unitPrice − costPrice) × quantity
  isFallback: boolean; // true = 無進價快照，用當前產品進價估算
}

export interface CommissionOrderRow {
  orderNo: string;
  orderDate: string; // YYYY-MM-DD
  customerName: string;
  orderBonus: number; // 該單獎金 = 毛利合計 − 營業稅
  // 以下僅 includeItemDetail=true（主管/會計）回傳；業務看不到（不洩漏成本）
  grossProfitTotal?: number;
  taxAmount?: number;
  items?: CommissionItemRow[];
}

export interface CommissionReport {
  year: number;
  month: number;
  employeeId: string | null;
  employeeName: string | null;
  taxDeductRate: number; // 該業務的扣除稅率 %
  rows: CommissionOrderRow[];
  totalBonus: number;    // 累積獎金（可為負）
  netAmount: number;     // 實發 = max(0, 累積 × (1 − 稅率/100))
  includeItemDetail: boolean;
}

export async function getMonthlyReport(
  tenantId: string,
  opts: { year: number; month: number; employeeId?: string; includeItemDetail?: boolean },
): Promise<CommissionReport> {
  const { year, month, employeeId } = opts;
  const includeItemDetail = opts.includeItemDetail ?? false;
  // orderDate 建單時以 new Date(年,月-1,日) 寫入（UTC 容器 = 該日 00:00 UTC）；月邊界同構造。
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  // 實發需該業務的稅率 → employeeId 必填；未指定回空報表。
  if (!employeeId) {
    return {
      year, month, employeeId: null, employeeName: null, taxDeductRate: 0,
      rows: [], totalBonus: 0, netAmount: 0, includeItemDetail,
    };
  }

  const emp = await prisma.employee.findFirst({
    where: { id: employeeId, tenantId },
    select: { name: true, taxDeductRate: true },
  });
  const taxDeductRate = emp?.taxDeductRate != null ? Number(emp.taxDeductRate) : 0;

  const orders = await prisma.salesOrder.findMany({
    where: {
      tenantId,
      isDeleted: false,
      orderDate: { gte: start, lt: end },
      createdBy: employeeId,
    },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      customer: { select: { name: true } },
    },
    orderBy: { orderDate: 'asc' },
  });

  // fallback：無進價快照的品項查當前 costPrice。
  const fbNames = [
    ...new Set(
      orders.flatMap((o) =>
        o.items.filter((it) => it.costAtSale == null).map((it) => it.productName),
      ),
    ),
  ];
  const products = fbNames.length
    ? await prisma.product.findMany({
        where: { tenantId, name: { in: fbNames } },
        select: { name: true, costPrice: true },
      })
    : [];
  const curCost = new Map(products.map((p) => [p.name, Number(p.costPrice)]));

  const rows: CommissionOrderRow[] = [];
  let totalBonus = 0;

  for (const o of orders) {
    let grossProfitTotal = 0;
    const items: CommissionItemRow[] = [];
    for (const it of o.items) {
      const snap = it.costAtSale == null ? null : Number(it.costAtSale);
      const unitPrice = Number(it.unitPrice);
      // 快照優先；無 → 當前進價；都無 → 用成交價（毛利 0）
      const costPrice = snap ?? curCost.get(it.productName) ?? unitPrice;
      const grossProfit = (unitPrice - costPrice) * it.quantity;
      grossProfitTotal += grossProfit;
      items.push({
        productName: it.productName,
        quantity: it.quantity,
        unitPrice,
        costPrice,
        grossProfit,
        isFallback: snap == null,
      });
    }
    const taxAmount = Number(o.taxAmount);
    const orderBonus = grossProfitTotal - taxAmount;
    totalBonus += orderBonus;

    if (includeItemDetail) {
      rows.push({
        orderNo: o.orderNo,
        orderDate: o.orderDate.toISOString().slice(0, 10),
        customerName: o.customer.name,
        orderBonus,
        grossProfitTotal,
        taxAmount,
        items,
      });
    } else {
      // 業務模式：只回每單獎金，不含進價 / 毛利 / 品項明細
      rows.push({
        orderNo: o.orderNo,
        orderDate: o.orderDate.toISOString().slice(0, 10),
        customerName: o.customer.name,
        orderBonus,
      });
    }
  }

  const netAmount = Math.max(0, Math.round(totalBonus * (1 - taxDeductRate / 100)));

  return {
    year, month,
    employeeId,
    employeeName: emp?.name ?? null,
    taxDeductRate,
    rows,
    totalBonus,
    netAmount,
    includeItemDetail,
  };
}

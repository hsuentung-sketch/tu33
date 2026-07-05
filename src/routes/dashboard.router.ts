import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../shared/prisma.js';
import { taipeiNow } from '../shared/timezone.js';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenantId;
    const tp = taipeiNow();
    const monthStart = new Date(Date.UTC(tp.year, tp.month - 1, 1, -8));
    const monthEnd = new Date(Date.UTC(tp.year, tp.month, 1, -8));

    // Past 6 months window (含本月) for 月營業額 / 毛利條狀圖。
    const monthly: Array<{ year: number; month: number; start: Date; end: Date }> = [];
    for (let i = 5; i >= 0; i--) {
      let y = tp.year;
      let m = tp.month - i;
      while (m <= 0) { m += 12; y -= 1; }
      const start = new Date(Date.UTC(y, m - 1, 1, -8));
      const end = new Date(Date.UTC(y, m, 1, -8));
      monthly.push({ year: y, month: m, start, end });
    }
    const monthlyWindowStart = monthly[0].start;
    const monthlyWindowEnd = monthly[monthly.length - 1].end;

    const [
      customerCount,
      productCount,
      supplierCount,
      overdueAr,
      monthSales,
      monthPurchase,
      unpaidAr,
      unpaidAp,
      monthlyOrders,
    ] = await Promise.all([
      prisma.customer.count({ where: { tenantId, isActive: true } }),
      prisma.product.count({ where: { tenantId, isActive: true } }),
      prisma.supplier.count({ where: { tenantId, isActive: true } }),
      prisma.accountReceivable.count({
        where: { tenantId, isPaid: false, dueDate: { lt: new Date() } },
      }),
      prisma.salesOrder.aggregate({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.purchaseOrder.aggregate({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.accountReceivable.aggregate({
        where: { tenantId, isPaid: false },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.accountPayable.aggregate({
        where: { tenantId, isPaid: false },
        _sum: { amount: true },
        _count: true,
      }),
      // 一次撈近 6 個月所有銷貨單 + items（用 createdAt 分月）。
      // 毛利 = Σ items.(unitPrice - costAtSale) × quantity；costAtSale 為 null 時該筆略過毛利計算。
      prisma.salesOrder.findMany({
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: monthlyWindowStart, lt: monthlyWindowEnd },
        },
        select: {
          createdAt: true,
          totalAmount: true,
          items: {
            select: { quantity: true, unitPrice: true, costAtSale: true },
          },
        },
      }),
    ]);

    const monthlyMap = new Map<string, { revenue: number; grossProfit: number }>();
    for (const m of monthly) {
      monthlyMap.set(`${m.year}-${m.month}`, { revenue: 0, grossProfit: 0 });
    }
    for (const so of monthlyOrders) {
      // Bucket by Asia/Taipei calendar month.
      const d = new Date(so.createdAt.getTime() + 8 * 60 * 60 * 1000);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const key = `${y}-${m}`;
      const bucket = monthlyMap.get(key);
      if (!bucket) continue;
      bucket.revenue += Number(so.totalAmount);
      for (const it of so.items) {
        if (it.costAtSale == null) continue;
        bucket.grossProfit += (Number(it.unitPrice) - Number(it.costAtSale)) * it.quantity;
      }
    }
    const monthlyStats = monthly.map((m) => {
      const b = monthlyMap.get(`${m.year}-${m.month}`)!;
      return {
        period: `${m.year}-${String(m.month).padStart(2, '0')}`,
        revenue: Math.round(b.revenue),
        grossProfit: Math.round(b.grossProfit),
      };
    });

    res.json({
      counts: { customerCount, productCount, supplierCount, overdueAr },
      monthSales: {
        total: Number(monthSales._sum.totalAmount ?? 0),
        count: monthSales._count,
      },
      monthPurchase: {
        total: Number(monthPurchase._sum.totalAmount ?? 0),
        count: monthPurchase._count,
      },
      unpaidAr: {
        total: Number(unpaidAr._sum.amount ?? 0),
        count: unpaidAr._count,
      },
      unpaidAp: {
        total: Number(unpaidAp._sum.amount ?? 0),
        count: unpaidAp._count,
      },
      monthlyStats,
      period: `${tp.year}-${String(tp.month).padStart(2, '0')}`,
    });
  } catch (err) {
    next(err);
  }
});

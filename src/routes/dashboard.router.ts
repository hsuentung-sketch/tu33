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

    const [
      customerCount,
      productCount,
      supplierCount,
      overdueAr,
      monthSales,
      monthPurchase,
      unpaidAr,
      unpaidAp,
      topCustomers,
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
      prisma.salesOrder.groupBy({
        by: ['customerId'],
        where: {
          tenantId,
          isDeleted: false,
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { totalAmount: true },
        _count: true,
        orderBy: { _sum: { totalAmount: 'desc' } },
        take: 5,
      }),
    ]);

    const customerIds = topCustomers.map((c) => c.customerId);
    const customers = customerIds.length
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = new Map(customers.map((c) => [c.id, c.name]));

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
      topCustomers: topCustomers.map((c) => ({
        customerId: c.customerId,
        customerName: nameMap.get(c.customerId) ?? '(未知)',
        total: Number(c._sum.totalAmount ?? 0),
        count: c._count,
      })),
      period: `${tp.year}-${String(tp.month).padStart(2, '0')}`,
    });
  } catch (err) {
    next(err);
  }
});

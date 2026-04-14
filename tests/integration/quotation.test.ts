import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/shared/prisma.js';
import * as quotationService from '../../src/modules/sales/quotation/quotation.service.js';
import { seedFixtures } from './fixtures.js';

describe('quotationService.convertToSalesOrder', () => {
  it('creates sales order with matching items and receivable, marks WON', async () => {
    const f = await seedFixtures();
    const quotation = await quotationService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'Test',
      createdBy: f.employeeId,
      items: [
        { productName: 'EK-C-215', quantity: 2, unitPrice: 17200 },
        { productName: 'EK-SS-6280', quantity: 1, unitPrice: 5000 },
      ],
    });

    const order = await quotationService.convertToSalesOrder(f.tenantId, quotation.id, f.employeeId);

    expect(order.items).toHaveLength(2);
    expect(Number(order.totalAmount)).toBe(Number(quotation.totalAmount));
    expect(order.quotationId).toBe(quotation.id);
    expect(order.receivable).not.toBeNull();

    const refreshed = await prisma.quotation.findUnique({ where: { id: quotation.id } });
    expect(refreshed?.status).toBe('WON');
    expect(refreshed?.dealClosed).toBe(true);
  });

  it('rejects double conversion', async () => {
    const f = await seedFixtures();
    const quotation = await quotationService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'Test',
      createdBy: f.employeeId,
      items: [{ productName: 'X', quantity: 1, unitPrice: 100 }],
    });
    await quotationService.convertToSalesOrder(f.tenantId, quotation.id, f.employeeId);
    await expect(
      quotationService.convertToSalesOrder(f.tenantId, quotation.id, f.employeeId),
    ).rejects.toThrow(/already converted/);
  });

  it('rejects converting a LOST quotation', async () => {
    const f = await seedFixtures();
    const quotation = await quotationService.create(f.tenantId, {
      customerId: f.customerId,
      salesPerson: 'Test',
      createdBy: f.employeeId,
      items: [{ productName: 'X', quantity: 1, unitPrice: 100 }],
    });
    // Move SENT → LOST via valid transitions
    await quotationService.updateStatus(f.tenantId, quotation.id, 'SENT');
    await quotationService.updateStatus(f.tenantId, quotation.id, 'LOST');
    await expect(
      quotationService.convertToSalesOrder(f.tenantId, quotation.id, f.employeeId),
    ).rejects.toThrow(/status LOST/);
  });
});

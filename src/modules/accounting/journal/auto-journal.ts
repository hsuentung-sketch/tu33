/**
 * Auto Journal — 自動分錄 event handlers
 *
 * 監聽業務事件，自動產生會計傳票（直接 posted）。
 * 若租戶尚未啟用會計模組（無 ChartOfAccount / FiscalPeriod），靜默跳過。
 *
 * 觸發事件：
 *  - salesOrder:created  → 借 AR / 貸 銷貨收入 + 銷項稅
 *  - invoice:paid        → 借 銀行存款 / 貸 AR
 *  - purchaseOrder:created → 借 進貨 + 進項稅 / 貸 AP
 *  - payment:received    → 借 AP / 貸 銀行存款
 */
import { eventBus, ERPEventMap } from '../../../shared/event-bus.js';
import { prisma } from '../../../shared/prisma.js';
import { logger } from '../../../shared/logger.js';
import { SYSTEM_ACCOUNT_CODES } from '../coa/default-coa-template.js';
import * as journalService from './journal.service.js';

const CODES = SYSTEM_ACCOUNT_CODES;

// ────────────────────────────────────────────────────────────
// Helper: resolve account code → id, returns null if not found
// ────────────────────────────────────────────────────────────
async function resolveAccount(tenantId: string, code: string): Promise<string | null> {
  const acct = await prisma.chartOfAccount.findUnique({
    where: { tenantId_code: { tenantId, code } },
    select: { id: true },
  });
  return acct?.id ?? null;
}

async function resolveAccounts(tenantId: string, codes: string[]): Promise<Map<string, string> | null> {
  const map = new Map<string, string>();
  for (const code of codes) {
    const id = await resolveAccount(tenantId, code);
    if (!id) return null; // 會計模組未啟用（缺科目）
    map.set(code, id);
  }
  return map;
}

// ────────────────────────────────────────────────────────────
// 1. 銷貨 → 借 AR / 貸 銷貨收入 + 銷項稅
// ────────────────────────────────────────────────────────────
async function onSalesOrderCreated(payload: ERPEventMap['salesOrder:created']) {
  const { tenantId, salesOrderId } = payload;

  const so = await prisma.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { orderNo: true, subtotal: true, taxAmount: true, totalAmount: true, orderDate: true },
  });
  if (!so) return;

  const accts = await resolveAccounts(tenantId, [CODES.AR, CODES.SALES_REVENUE, CODES.TAX_OUTPUT]);
  if (!accts) return; // 會計未啟用

  const total = Number(so.totalAmount);
  const sub = Number(so.subtotal);
  const tax = Number(so.taxAmount);

  const lines = [
    { accountId: accts.get(CODES.AR)!, debit: total, credit: 0, description: `銷貨 ${so.orderNo}` },
    { accountId: accts.get(CODES.SALES_REVENUE)!, debit: 0, credit: sub, description: `銷貨收入` },
  ];
  if (tax > 0) {
    lines.push({ accountId: accts.get(CODES.TAX_OUTPUT)!, debit: 0, credit: tax, description: '銷項稅額' });
  }

  await journalService.create(tenantId, null, {
    entryDate: so.orderDate,
    description: `銷貨 ${so.orderNo}`,
    source: 'sales',
    sourceId: salesOrderId,
    status: 'posted',
    lines,
  });

  logger.info('Auto journal: sales', { tenantId, salesOrderId });
}

// ────────────────────────────────────────────────────────────
// 2. 收款 → 借 銀行存款 / 貸 AR
// ────────────────────────────────────────────────────────────
async function onInvoicePaid(payload: ERPEventMap['invoice:paid']) {
  const { tenantId, invoiceId, amount } = payload;

  const accts = await resolveAccounts(tenantId, [CODES.BANK, CODES.AR]);
  if (!accts) return;

  // invoiceId 實際上是 AR id（receivable.service markPaid emit 的）
  const ar = await prisma.accountReceivable.findFirst({
    where: { id: invoiceId, tenantId },
    select: { salesOrder: { select: { orderNo: true } } },
  });
  const orderNo = ar?.salesOrder?.orderNo ?? '';

  await journalService.create(tenantId, null, {
    entryDate: new Date(),
    description: `收款 ${orderNo}`,
    source: 'receipt',
    sourceId: invoiceId,
    status: 'posted',
    lines: [
      { accountId: accts.get(CODES.BANK)!, debit: amount, credit: 0, description: `收款` },
      { accountId: accts.get(CODES.AR)!, debit: 0, credit: amount, description: `沖銷應收` },
    ],
  });

  logger.info('Auto journal: receipt', { tenantId, invoiceId });
}

// ────────────────────────────────────────────────────────────
// 3. 進貨 → 借 進貨 + 進項稅 / 貸 AP
// ────────────────────────────────────────────────────────────
async function onPurchaseOrderCreated(payload: ERPEventMap['purchaseOrder:created']) {
  const { tenantId, purchaseOrderId } = payload;

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { orderNo: true, subtotal: true, taxAmount: true, totalAmount: true, orderDate: true },
  });
  if (!po) return;

  const accts = await resolveAccounts(tenantId, [CODES.PURCHASES, CODES.TAX_INPUT, CODES.AP]);
  if (!accts) return;

  const total = Number(po.totalAmount);
  const sub = Number(po.subtotal);
  const tax = Number(po.taxAmount);

  const lines = [
    { accountId: accts.get(CODES.PURCHASES)!, debit: sub, credit: 0, description: `進貨 ${po.orderNo}` },
  ];
  if (tax > 0) {
    lines.push({ accountId: accts.get(CODES.TAX_INPUT)!, debit: tax, credit: 0, description: '進項稅額' });
  }
  lines.push({ accountId: accts.get(CODES.AP)!, debit: 0, credit: total, description: `應付帳款` });

  await journalService.create(tenantId, null, {
    entryDate: po.orderDate,
    description: `進貨 ${po.orderNo}`,
    source: 'purchase',
    sourceId: purchaseOrderId,
    status: 'posted',
    ...(tax > 0 ? {
      vatDeductType: 'deductible',
      vatInputAmount: tax,
      deductibleVat: tax,
      withholdingTax: 0,
    } : {}),
    lines,
  });

  logger.info('Auto journal: purchase', { tenantId, purchaseOrderId });
}

// ────────────────────────────────────────────────────────────
// 4. 付款 → 借 AP / 貸 銀行存款
// ────────────────────────────────────────────────────────────
async function onPaymentReceived(payload: ERPEventMap['payment:received']) {
  const { tenantId, paymentId, amount } = payload;

  const accts = await resolveAccounts(tenantId, [CODES.AP, CODES.BANK]);
  if (!accts) return;

  // paymentId 實際上是 AP id（payable.service markPaid emit 的）
  const ap = await prisma.accountPayable.findFirst({
    where: { id: paymentId, tenantId },
    select: { purchaseOrder: { select: { orderNo: true } } },
  });
  const orderNo = ap?.purchaseOrder?.orderNo ?? '';

  await journalService.create(tenantId, null, {
    entryDate: new Date(),
    description: `付款 ${orderNo}`,
    source: 'payment',
    sourceId: paymentId,
    status: 'posted',
    lines: [
      { accountId: accts.get(CODES.AP)!, debit: amount, credit: 0, description: `沖銷應付` },
      { accountId: accts.get(CODES.BANK)!, debit: 0, credit: amount, description: `付款` },
    ],
  });

  logger.info('Auto journal: payment', { tenantId, paymentId });
}

// ────────────────────────────────────────────────────────────
// 5. 單據修改 / 刪除 / 取消收付款 → 反沖原自動傳票（已過帳傳票不直接改）
// ────────────────────────────────────────────────────────────
/** 反沖某單據所有仍有效的自動傳票，回傳反沖張數。 */
async function reverseSourceEntries(
  tenantId: string, source: string, sourceId: string, actorId: string | undefined, reason: string,
): Promise<number> {
  const entries = await prisma.journalEntry.findMany({
    where: { tenantId, source, sourceId, status: 'posted' },
    select: { id: true },
  });
  for (const e of entries) {
    await journalService.reverse(tenantId, e.id, actorId ?? 'system', reason);
  }
  if (entries.length) logger.info('Auto journal: reversed', { tenantId, source, sourceId, count: entries.length });
  return entries.length;
}

// 只有原本已入帳的單據才重開傳票；會計啟用前建立的單據維持不入帳。
async function onSalesOrderUpdated(p: ERPEventMap['salesOrder:updated']) {
  const n = await reverseSourceEntries(p.tenantId, 'sales', p.salesOrderId, p.actorId, '銷貨單修改');
  if (n > 0) await onSalesOrderCreated({ tenantId: p.tenantId, salesOrderId: p.salesOrderId });
}

async function onPurchaseOrderUpdated(p: ERPEventMap['purchaseOrder:updated']) {
  const n = await reverseSourceEntries(p.tenantId, 'purchase', p.purchaseOrderId, p.actorId, '進貨單修改');
  if (n > 0) await onPurchaseOrderCreated({ tenantId: p.tenantId, purchaseOrderId: p.purchaseOrderId, supplierId: '' });
}

// ────────────────────────────────────────────────────────────
// 註冊所有 handler
// ────────────────────────────────────────────────────────────
export function registerAutoJournalHandlers(): void {
  eventBus.on('salesOrder:created', onSalesOrderCreated);
  eventBus.on('invoice:paid', onInvoicePaid);
  eventBus.on('purchaseOrder:created', onPurchaseOrderCreated);
  eventBus.on('payment:received', onPaymentReceived);
  eventBus.on('salesOrder:updated', onSalesOrderUpdated);
  eventBus.on('purchaseOrder:updated', onPurchaseOrderUpdated);
  eventBus.on('salesOrder:deleted', async (p) => {
    await reverseSourceEntries(p.tenantId, 'sales', p.salesOrderId, p.actorId, '銷貨單刪除');
  });
  eventBus.on('purchaseOrder:deleted', async (p) => {
    await reverseSourceEntries(p.tenantId, 'purchase', p.purchaseOrderId, p.actorId, '進貨單刪除');
  });
  eventBus.on('invoice:unpaid', async (p) => {
    await reverseSourceEntries(p.tenantId, 'receipt', p.invoiceId, p.actorId, '取消收款');
  });
  eventBus.on('payment:unpaid', async (p) => {
    await reverseSourceEntries(p.tenantId, 'payment', p.paymentId, p.actorId, '取消付款');
  });
  logger.info('Auto journal handlers registered');
}

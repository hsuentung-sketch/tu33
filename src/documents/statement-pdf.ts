import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;

interface StatementRow {
  orderNo: string;
  orderDate: Date;
  amount: Decimal | number;
  dueDate: Date;
  isPaid: boolean;
}

interface CustomerStatementPdfData {
  companyHeader: string;
  period: string; // e.g. "2026/03"
  customer: {
    name: string;
    taxId?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  rows: StatementRow[];
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  pdfFooter?: string;
}

interface SupplierStatementPdfData {
  companyHeader: string;
  period: string;
  supplier: {
    name: string;
    taxId?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  rows: StatementRow[];
  totalAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  pdfFooter?: string;
}

// Font path for CJK support - use system fonts
const CJK_FONT = 'C:/Windows/Fonts/msjh.ttc';

function formatDate(date: Date): string {
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function toNumber(val: Decimal | number): number {
  return typeof val === 'number' ? val : Number(val);
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString('zh-TW');
}

function drawStatementBody(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  data: {
    companyHeader: string;
    period: string;
    party: { name: string; taxId?: string | null; address?: string | null; phone?: string | null };
    partyLabel: string;
    rows: StatementRow[];
    totalAmount: number;
    paidAmount: number;
    unpaidAmount: number;
    pdfFooter?: string;
  },
): void {
  doc.font(CJK_FONT);

  // Header
  doc.fontSize(20).text(title, { align: 'center' });
  doc.fontSize(12).text(data.companyHeader, { align: 'right' });
  doc.moveDown();

  // Party info
  doc.fontSize(10);
  doc.text(`${data.partyLabel}: ${data.party.name}`);
  if (data.party.taxId) doc.text(`統一編號: ${data.party.taxId}`);
  if (data.party.phone) doc.text(`電話: ${data.party.phone}`);
  if (data.party.address) doc.text(`地址: ${data.party.address}`);
  doc.moveDown();

  doc.text(`對帳期間: ${data.period}`);
  doc.moveDown();

  // Table header
  const tableTop = doc.y;
  doc.fontSize(9);
  doc.text('銷貨單號', 50, tableTop, { width: 130 });
  doc.text('開單日期', 185, tableTop, { width: 80 });
  doc.text('金額', 270, tableTop, { width: 90, align: 'right' });
  doc.text('到期日', 365, tableTop, { width: 80 });
  doc.text('狀態', 450, tableTop, { width: 105 });
  doc.moveTo(50, tableTop + 15).lineTo(555, tableTop + 15).stroke();

  // Rows
  let y = tableTop + 20;
  data.rows.forEach((row) => {
    doc.text(row.orderNo, 50, y, { width: 130 });
    doc.text(formatDate(row.orderDate), 185, y, { width: 80 });
    doc.text(formatCurrency(toNumber(row.amount)), 270, y, { width: 90, align: 'right' });
    doc.text(formatDate(row.dueDate), 365, y, { width: 80 });
    doc.text(row.isPaid ? 'paid' : 'unpaid', 450, y, { width: 105 });
    y += 18;
  });

  // Totals
  y += 10;
  doc.moveTo(300, y).lineTo(555, y).stroke();
  y += 5;
  const totalLabel = data.partyLabel === '客戶' ? '本期應收合計' : '本期應付合計';
  doc.text(totalLabel, 300, y, { width: 150, align: 'right' });
  doc.text(formatCurrency(data.totalAmount), 455, y, { width: 100, align: 'right' });
  y += 15;
  doc.text('已收合計', 300, y, { width: 150, align: 'right' });
  doc.text(formatCurrency(data.paidAmount), 455, y, { width: 100, align: 'right' });
  y += 15;
  doc.fontSize(11);
  doc.text('未收合計', 300, y, { width: 150, align: 'right' });
  doc.text(formatCurrency(data.unpaidAmount), 455, y, { width: 100, align: 'right' });

  // Footer
  if (data.pdfFooter) {
    doc.fontSize(8).text(data.pdfFooter, 50, 750, { align: 'center' });
  }
}

export function generateCustomerStatementPdf(
  data: CustomerStatementPdfData,
): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  drawStatementBody(doc, '客戶月結對帳單', {
    companyHeader: data.companyHeader,
    period: data.period,
    party: data.customer,
    partyLabel: '客戶',
    rows: data.rows,
    totalAmount: data.totalAmount,
    paidAmount: data.paidAmount,
    unpaidAmount: data.unpaidAmount,
    pdfFooter: data.pdfFooter,
  });
  doc.end();
  return doc;
}

export function generateSupplierStatementPdf(
  data: SupplierStatementPdfData,
): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  drawStatementBody(doc, '供應商月結對帳單', {
    companyHeader: data.companyHeader,
    period: data.period,
    party: data.supplier,
    partyLabel: '供應商',
    rows: data.rows,
    totalAmount: data.totalAmount,
    paidAmount: data.paidAmount,
    unpaidAmount: data.unpaidAmount,
    pdfFooter: data.pdfFooter,
  });
  doc.end();
  return doc;
}

/**
 * Drain a pdfkit document stream into a Buffer so it can be emailed.
 */
export function pdfToBuffer(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

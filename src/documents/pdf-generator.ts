import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;

interface DocumentItem {
  productName: string;
  quantity: number;
  unitPrice: Decimal | number;
  amount: Decimal | number;
  note?: string | null;
}

interface QuotationPdfData {
  companyHeader: string;
  quotationNo: string;
  date: Date;
  customer: {
    name: string;
    contactName?: string | null;
    zipCode?: string | null;
    address?: string | null;
  };
  salesPerson: string;
  salesPhone?: string | null;
  items: DocumentItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  supplyTime?: string | null;
  paymentTerms?: string | null;
  validUntil?: string | null;
  note?: string | null;
  pdfFooter?: string;
  isDraft?: boolean;
}

interface SalesOrderPdfData {
  companyHeader: string;
  orderNo: string;
  date: Date;
  customer: {
    name: string;
    contactName?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  salesPerson: string;
  salesPhone?: string | null;
  companyAddress?: string;
  deliveryNote?: string | null;
  items: DocumentItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  deliveredBy?: string | null;
  receivedBy?: string | null;
  pdfFooter?: string;
}

interface PurchaseOrderPdfData {
  companyHeader: string;
  orderNo: string;
  date: Date;
  supplier: {
    name: string;
    contactName?: string | null;
    taxId?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  internalStaff: string;
  staffPhone?: string | null;
  companyAddress?: string;
  deliveryNote?: string | null;
  items: (DocumentItem & { referenceCost?: number | null })[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
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

export function generateQuotationPdf(data: QuotationPdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  doc.font(CJK_FONT);

  // Header
  doc.fontSize(20).text('報價單', { align: 'center' });
  doc.fontSize(12).text(data.companyHeader, { align: 'right' });
  doc.moveDown();

  // Draft watermark
  if (data.isDraft) {
    doc.save();
    doc.fontSize(60).fillColor('#CCCCCC').opacity(0.3);
    doc.text('草稿', 150, 300);
    doc.restore();
  }

  // Customer info
  doc.fontSize(10);
  doc.text(`致: ${data.customer.name}`);
  if (data.customer.contactName) doc.text(`${data.customer.contactName} 先生/小姐`);
  if (data.customer.address) doc.text(data.customer.address);
  doc.moveDown();

  // Sales info
  doc.text(`業務: ${data.salesPerson}    電話: ${data.salesPhone || ''}`);
  doc.text(`報價單號: ${data.quotationNo}    報價日期: ${formatDate(data.date)}`);
  doc.moveDown();

  // Items table header
  const tableTop = doc.y;
  doc.font(CJK_FONT).fontSize(9);
  doc.text('編號', 50, tableTop, { width: 30 });
  doc.text('品項', 85, tableTop, { width: 200 });
  doc.text('數量', 290, tableTop, { width: 50, align: 'right' });
  doc.text('單價', 345, tableTop, { width: 70, align: 'right' });
  doc.text('金額', 420, tableTop, { width: 70, align: 'right' });
  doc.text('備註', 495, tableTop, { width: 60 });

  doc.moveTo(50, tableTop + 15).lineTo(555, tableTop + 15).stroke();

  // Items
  let y = tableTop + 20;
  data.items.forEach((item, i) => {
    doc.text(String(i + 1), 50, y, { width: 30 });
    doc.text(item.productName, 85, y, { width: 200 });
    doc.text(String(item.quantity), 290, y, { width: 50, align: 'right' });
    doc.text(formatCurrency(toNumber(item.unitPrice)), 345, y, { width: 70, align: 'right' });
    doc.text(formatCurrency(toNumber(item.amount)), 420, y, { width: 70, align: 'right' });
    if (item.note) doc.text(item.note, 495, y, { width: 60 });
    y += 18;
  });

  // Totals
  y += 10;
  doc.moveTo(350, y).lineTo(555, y).stroke();
  y += 5;
  doc.text('小計', 350, y, { width: 65, align: 'right' });
  doc.text(formatCurrency(data.subtotal), 420, y, { width: 70, align: 'right' });
  y += 15;
  doc.text('營業稅(5%)', 350, y, { width: 65, align: 'right' });
  doc.text(formatCurrency(data.taxAmount), 420, y, { width: 70, align: 'right' });
  y += 15;
  doc.font(CJK_FONT).fontSize(11);
  doc.text('總計', 350, y, { width: 65, align: 'right' });
  doc.text(formatCurrency(data.totalAmount), 420, y, { width: 70, align: 'right' });

  // Terms
  doc.fontSize(9).font(CJK_FONT);
  y += 30;
  if (data.supplyTime) doc.text(`可供貨時間: ${data.supplyTime}`, 50, y);
  if (data.paymentTerms) { y += 15; doc.text(`付款期限: ${data.paymentTerms}`, 50, y); }
  if (data.validUntil) { y += 15; doc.text(`報價單有效日期: ${data.validUntil}`, 50, y); }
  if (data.note) { y += 15; doc.text(`其他備註事項: ${data.note}`, 50, y); }

  // Footer
  if (data.pdfFooter) {
    doc.fontSize(8).text(data.pdfFooter, 50, 750, { align: 'center' });
  }

  doc.end();
  return doc;
}

export function generateSalesOrderPdf(data: SalesOrderPdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.font(CJK_FONT);

  // Header
  doc.fontSize(20).text('銷貨單', { align: 'center' });
  doc.fontSize(12).text(data.companyHeader, { align: 'right' });
  doc.moveDown();

  // Customer info
  doc.fontSize(10);
  doc.text(`公司: ${data.customer.name}`);
  if (data.customer.contactName) doc.text(`聯絡人: ${data.customer.contactName}`);
  if (data.customer.taxId) doc.text(`統一編號: ${data.customer.taxId}`);
  if (data.customer.phone) doc.text(`電話: ${data.customer.phone}`);
  if (data.customer.address) doc.text(`地址: ${data.customer.address}`);
  doc.moveDown();

  // Order info
  doc.text(`業務: ${data.salesPerson}    電話: ${data.salesPhone || ''}`);
  doc.text(`訂單編號: ${data.orderNo}    開單日期: ${formatDate(data.date)}`);
  if (data.deliveryNote) doc.text(`送貨備註: ${data.deliveryNote}`);
  doc.moveDown();

  // Items table
  const tableTop = doc.y;
  doc.fontSize(9);
  doc.text('編號', 50, tableTop, { width: 30 });
  doc.text('品項', 85, tableTop, { width: 200 });
  doc.text('數量', 290, tableTop, { width: 50, align: 'right' });
  doc.text('單價', 345, tableTop, { width: 70, align: 'right' });
  doc.text('金額', 420, tableTop, { width: 70, align: 'right' });
  doc.text('說明', 495, tableTop, { width: 60 });
  doc.moveTo(50, tableTop + 15).lineTo(555, tableTop + 15).stroke();

  let y = tableTop + 20;
  data.items.forEach((item, i) => {
    doc.text(String(i + 1), 50, y, { width: 30 });
    doc.text(item.productName, 85, y, { width: 200 });
    doc.text(String(item.quantity), 290, y, { width: 50, align: 'right' });
    doc.text(formatCurrency(toNumber(item.unitPrice)), 345, y, { width: 70, align: 'right' });
    doc.text(formatCurrency(toNumber(item.amount)), 420, y, { width: 70, align: 'right' });
    if (item.note) doc.text(item.note, 495, y, { width: 60 });
    y += 18;
  });

  // Totals
  y += 10;
  doc.moveTo(350, y).lineTo(555, y).stroke();
  y += 5;
  doc.text('小計', 350, y, { width: 65, align: 'right' });
  doc.text(formatCurrency(data.subtotal), 420, y, { width: 70, align: 'right' });
  y += 15;
  doc.text('營業稅(5%)', 350, y, { width: 65, align: 'right' });
  doc.text(formatCurrency(data.taxAmount), 420, y, { width: 70, align: 'right' });
  y += 15;
  doc.fontSize(11);
  doc.text('總計', 350, y, { width: 65, align: 'right' });
  doc.text(formatCurrency(data.totalAmount), 420, y, { width: 70, align: 'right' });

  // Signatures
  y += 40;
  doc.fontSize(10);
  doc.text(`出貨人: ${data.deliveredBy || ''}`, 50, y);
  doc.text(`收貨人: ${data.receivedBy || ''}`, 300, y);

  doc.end();
  return doc;
}

export function generatePurchaseOrderPdf(data: PurchaseOrderPdfData): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.font(CJK_FONT);

  // Header
  doc.fontSize(20).text('進貨單', { align: 'center' });
  doc.fontSize(12).text(data.companyHeader, { align: 'right' });
  doc.moveDown();

  // Supplier info
  doc.fontSize(10);
  doc.text(`供應商: ${data.supplier.name}`);
  if (data.supplier.contactName) doc.text(`聯絡人: ${data.supplier.contactName}`);
  if (data.supplier.taxId) doc.text(`統一編號: ${data.supplier.taxId}`);
  if (data.supplier.phone) doc.text(`電話: ${data.supplier.phone}`);
  if (data.supplier.address) doc.text(`地址: ${data.supplier.address}`);
  doc.moveDown();

  // Order info
  doc.text(`內勤: ${data.internalStaff}    電話: ${data.staffPhone || ''}`);
  doc.text(`進貨單編號: ${data.orderNo}    開單日期: ${formatDate(data.date)}`);
  if (data.deliveryNote) doc.text(`送貨備註: ${data.deliveryNote}`);
  doc.moveDown();

  // Items table
  const tableTop = doc.y;
  doc.fontSize(9);
  doc.text('編號', 50, tableTop, { width: 30 });
  doc.text('品項', 85, tableTop, { width: 180 });
  doc.text('數量', 270, tableTop, { width: 40, align: 'right' });
  doc.text('單價', 315, tableTop, { width: 65, align: 'right' });
  doc.text('金額', 385, tableTop, { width: 65, align: 'right' });
  doc.text('說明', 455, tableTop, { width: 50 });
  doc.text('進價', 510, tableTop, { width: 45, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(555, tableTop + 15).stroke();

  let y = tableTop + 20;
  data.items.forEach((item, i) => {
    doc.text(String(i + 1), 50, y, { width: 30 });
    doc.text(item.productName, 85, y, { width: 180 });
    doc.text(String(item.quantity), 270, y, { width: 40, align: 'right' });
    doc.text(formatCurrency(toNumber(item.unitPrice)), 315, y, { width: 65, align: 'right' });
    doc.text(formatCurrency(toNumber(item.amount)), 385, y, { width: 65, align: 'right' });
    if (item.note) doc.text(item.note, 455, y, { width: 50 });
    if (item.referenceCost) doc.text(formatCurrency(item.referenceCost), 510, y, { width: 45, align: 'right' });
    y += 18;
  });

  // Totals
  y += 10;
  doc.moveTo(320, y).lineTo(555, y).stroke();
  y += 5;
  doc.text('小計', 320, y, { width: 60, align: 'right' });
  doc.text(formatCurrency(data.subtotal), 385, y, { width: 65, align: 'right' });
  y += 15;
  doc.text('營業稅(5%)', 320, y, { width: 60, align: 'right' });
  doc.text(formatCurrency(data.taxAmount), 385, y, { width: 65, align: 'right' });
  y += 15;
  doc.fontSize(11);
  doc.text('總計', 320, y, { width: 60, align: 'right' });
  doc.text(formatCurrency(data.totalAmount), 385, y, { width: 65, align: 'right' });

  doc.end();
  return doc;
}

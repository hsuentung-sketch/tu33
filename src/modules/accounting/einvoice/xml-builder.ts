/**
 * MIG 3.2.1 XML builder for 財政部 Turnkey.
 *
 * Generates:
 *  - C0401 (一般稅額 / 開立): B2B 三聯式 or B2C 二聯式
 *  - C0501 (作廢): 當期內作廢
 *
 * This implementation stays minimal — it produces the documents the
 * 國稅局 Turnkey accepts for common應稅開立 / 作廢 scenarios. It does
 * NOT cover 折讓 (D0401/D0501), 載具, or 捐贈碼 — those are Phase 2.
 *
 * Reference: 電子發票資料交換標準 MIG 3.2.1
 *            https://www.einvoice.nat.gov.tw/
 */

export interface XmlSeller {
  identifier: string; // 8-digit 統編
  name: string;
  address?: string;
}

export interface XmlBuyer {
  identifier: string | null; // null / empty → "0000000000" for B2C
  name: string;
  address?: string;
}

export interface XmlInvoiceItem {
  sequence: number;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
}

export interface XmlInvoiceInput {
  invoiceNo: string;       // "AB12345678"
  invoiceDate: Date;
  seller: XmlSeller;
  buyer: XmlBuyer;
  items: XmlInvoiceItem[];
  salesAmount: number;     // 未稅
  taxAmount: number;
  totalAmount: number;
  taxType: string;         // "1" | "2" | "3"
  taxRate?: number;        // default 0.05
}

export interface XmlVoidInput {
  invoiceNo: string;
  invoiceDate: Date;  // 原開立日期
  voidDate: Date;
  voidReason: string;
}

// ---------- helpers ----------

/** Escape `<>&'"` for safe XML text / attribute content. */
function esc(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** YYYYMMDD in Asia/Taipei. MIG expects Western year (not ROC) for C0401 date fields. */
function ymd(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}${m}${d}`;
}

/** HHmmss in Asia/Taipei. */
function hms(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')!.value;
  const m = parts.find((p) => p.type === 'minute')!.value;
  const s = parts.find((p) => p.type === 'second')!.value;
  return `${h}${m}${s}`;
}

/** MIG amounts: numbers rounded to integer or fixed 2-decimal, no thousands separator. */
function amt(n: number, decimals = 0): string {
  return n.toFixed(decimals);
}

/** MIG invoice number is 10 chars: "AB12345678" — seller-assigned. */
function splitInvoiceNo(no: string): { track: string; number: string } {
  return { track: no.slice(0, 2), number: no.slice(2) };
}

// ---------- C0401 開立 ----------

export function buildC0401(input: XmlInvoiceInput): string {
  const taxRate = input.taxRate ?? 0.05;
  const buyerId = input.buyer.identifier && input.buyer.identifier.trim()
    ? input.buyer.identifier.trim()
    : '0000000000';

  const itemsXml = input.items.map((it) => `
    <ProductItem>
      <Description>${esc(it.description)}</Description>
      <Quantity>${amt(it.quantity, 4)}</Quantity>
      ${it.unit ? `<Unit>${esc(it.unit)}</Unit>` : ''}
      <UnitPrice>${amt(it.unitPrice, 4)}</UnitPrice>
      <Amount>${amt(it.amount, 0)}</Amount>
      <SequenceNumber>${it.sequence}</SequenceNumber>
    </ProductItem>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:GEINV:eInvoiceMessage:C0401:3.2">
  <Main>
    <InvoiceNumber>${esc(input.invoiceNo)}</InvoiceNumber>
    <InvoiceDate>${ymd(input.invoiceDate)}</InvoiceDate>
    <InvoiceTime>${hms(input.invoiceDate)}</InvoiceTime>
    <Seller>
      <Identifier>${esc(input.seller.identifier)}</Identifier>
      <Name>${esc(input.seller.name)}</Name>
      ${input.seller.address ? `<Address>${esc(input.seller.address)}</Address>` : ''}
    </Seller>
    <Buyer>
      <Identifier>${esc(buyerId)}</Identifier>
      <Name>${esc(input.buyer.name)}</Name>
      ${input.buyer.address ? `<Address>${esc(input.buyer.address)}</Address>` : ''}
    </Buyer>
  </Main>
  <Details>${itemsXml}
  </Details>
  <Amount>
    <SalesAmount>${amt(input.salesAmount, 0)}</SalesAmount>
    <TaxType>${esc(input.taxType)}</TaxType>
    <TaxRate>${amt(taxRate, 4)}</TaxRate>
    <TaxAmount>${amt(input.taxAmount, 0)}</TaxAmount>
    <TotalAmount>${amt(input.totalAmount, 0)}</TotalAmount>
  </Amount>
</Invoice>
`;
}

// ---------- C0501 作廢 ----------

export function buildC0501(input: XmlVoidInput): string {
  const { track, number } = splitInvoiceNo(input.invoiceNo);
  void track; void number;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelInvoice xmlns="urn:GEINV:eInvoiceMessage:C0501:3.2">
  <Main>
    <CancelInvoiceNumber>${esc(input.invoiceNo)}</CancelInvoiceNumber>
    <InvoiceDate>${ymd(input.invoiceDate)}</InvoiceDate>
    <CancelDate>${ymd(input.voidDate)}</CancelDate>
    <CancelTime>${hms(input.voidDate)}</CancelTime>
    <CancelReason>${esc(input.voidReason)}</CancelReason>
  </Main>
</CancelInvoice>
`;
}

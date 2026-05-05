/**
 * MIG 4.1 XML builder for 財政部 Turnkey v3.2+。
 *
 * 升級自 3.2.1 重點（114-12-16 全面、115-01-01 強制）：
 *  - 所有 namespace 從 `:3.2` 升 `:4.1`（5 種訊息）
 *  - Main 區塊新增：MainRemark / CustomsClearanceMark / ZeroTaxRateReason
 *  - ProductItem 新增 TaxType（混合稅率支援）
 *  - RandomNumber 改為非必填（O）
 *  - 折讓單僅賣方可開立或作廢（D0401/D0501 type=1 賣方）
 *  - 日期格式：民國 YYYMMDD 或 西元 YYYYMMDD（皆受理；本實作沿用西元）
 *
 * 涵蓋訊息：
 *  - C0401 B2C 開立發票（B2B 開立用 A0101，本系統一律走 C0401 並依買受人有無統編切換）
 *  - C0501 B2C 作廢發票
 *  - D0401 折讓單（賣方開立）
 *  - D0501 折讓單作廢
 *  - C0701 空白未使用字軌回報
 *
 * Reference: 電子發票資料交換標準 MIG 4.1（114-10-29）
 *            https://www.einvoice.nat.gov.tw/static/ptl/ein_upload/download/5340.pdf
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
  /** MIG 4.1 新增：每品項稅別（支援混合稅率）。預設沿用全發票 taxType。 */
  taxType?: string;
  /** 該品項稅額（混合稅情境下品項分別計稅）。MIG 4.1 ProductItem 內可有 Tax，但本實作仍以 Amount 區塊總稅額為準。 */
  remark?: string;
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
  taxType: string;         // "1"=應稅 "2"=零稅率 "3"=免稅 "4"=應稅(特種稅率)
  taxRate?: number;        // default 0.05
  /** 4 碼隨機碼，B2C 證明聯 QR 驗證用；MIG 4.1 改為非必填，缺省時 builder 會產生 "0000" */
  randomCode?: string;
  /** 載具類別：3J0002=手機條碼 CQ0001=自然人憑證 EJ0113=會員載具等 */
  carrierType?: string;
  carrierId?: string;
  /** 捐贈碼（NPOBAN 3-7 位數字） */
  npoban?: string;
  /** Y=列印 N=不列印 */
  printFlag?: string;
  /** MIG 4.1 新增：總備註，最多 200 字 */
  mainRemark?: string;
  /** MIG 4.1 新增：通關方式（"1"=非經海關出口 "2"=經海關出口），零稅率必填 */
  customsClearanceMark?: string;
  /** MIG 4.1 新增：零稅率原因（搭配 taxType=2 使用） */
  zeroTaxRateReason?: string;
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
  const randomCode = input.randomCode ?? '0000';
  const printFlag = input.printFlag ?? 'Y';

  // MIG 4.1：每品項 TaxType（無填則沿用全發票 taxType），支援混合稅率。
  const itemsXml = input.items.map((it) => `
    <ProductItem>
      <Description>${esc(it.description)}</Description>
      <Quantity>${amt(it.quantity, 4)}</Quantity>
      ${it.unit ? `<Unit>${esc(it.unit)}</Unit>` : ''}
      <UnitPrice>${amt(it.unitPrice, 4)}</UnitPrice>
      <TaxType>${esc(it.taxType ?? input.taxType)}</TaxType>
      <Amount>${amt(it.amount, 0)}</Amount>
      <SequenceNumber>${it.sequence}</SequenceNumber>${it.remark ? `
      <Remark>${esc(it.remark)}</Remark>` : ''}
    </ProductItem>`).join('');

  // 載具 / 捐贈碼 區塊（擇一或皆無）
  let carrierBlock = '';
  if (input.carrierType && input.carrierId) {
    carrierBlock = `
    <CarrierType>${esc(input.carrierType)}</CarrierType>
    <CarrierId1>${esc(input.carrierId)}</CarrierId1>
    <CarrierId2>${esc(input.carrierId)}</CarrierId2>`;
  }
  const donationBlock = input.npoban
    ? `
    <NPOBAN>${esc(input.npoban)}</NPOBAN>`
    : '';

  // MIG 4.1 新增 Main-level optional 欄位
  const mainRemarkBlock = input.mainRemark ? `
    <MainRemark>${esc(input.mainRemark.slice(0, 200))}</MainRemark>` : '';
  const customsBlock = input.customsClearanceMark ? `
    <CustomsClearanceMark>${esc(input.customsClearanceMark)}</CustomsClearanceMark>` : '';
  const zeroTaxBlock = input.zeroTaxRateReason ? `
    <ZeroTaxRateReason>${esc(input.zeroTaxRateReason)}</ZeroTaxRateReason>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:GEINV:eInvoiceMessage:C0401:4.1">
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
    </Buyer>${mainRemarkBlock}${customsBlock}
    <InvoiceType>07</InvoiceType>
    <DonateMark>${input.npoban ? '1' : '0'}</DonateMark>
    <PrintMark>${esc(printFlag)}</PrintMark>
    <RandomNumber>${esc(randomCode)}</RandomNumber>${zeroTaxBlock}${carrierBlock}${donationBlock}
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

// ---------- D0401 / D0501 折讓單 ----------

export interface XmlAllowanceItem {
  sequence: number;
  originalSequence?: number;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount: number;
  taxType: string;
  taxAmount: number;
}

export interface XmlAllowanceInput {
  allowanceNo: string;
  allowanceDate: Date;
  seller: XmlSeller;
  buyer: XmlBuyer;
  originalInvoiceNo: string;
  originalInvoiceDate: Date;
  items: XmlAllowanceItem[];
  salesAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export function buildD0401(input: XmlAllowanceInput): string {
  const buyerId = input.buyer.identifier && input.buyer.identifier.trim()
    ? input.buyer.identifier.trim()
    : '0000000000';

  const itemsXml = input.items.map((it) => `
    <ProductItem>
      <OriginalSequenceNumber>${it.originalSequence ?? it.sequence}</OriginalSequenceNumber>
      <OriginalInvoiceNumber>${esc(input.originalInvoiceNo)}</OriginalInvoiceNumber>
      <OriginalInvoiceDate>${ymd(input.originalInvoiceDate)}</OriginalInvoiceDate>
      <OriginalDescription>${esc(it.description)}</OriginalDescription>
      <Quantity>${amt(it.quantity, 4)}</Quantity>
      ${it.unit ? `<Unit>${esc(it.unit)}</Unit>` : ''}
      <UnitPrice>${amt(it.unitPrice, 4)}</UnitPrice>
      <Amount>${amt(it.amount, 0)}</Amount>
      <TaxType>${esc(it.taxType)}</TaxType>
      <Tax>${amt(it.taxAmount, 0)}</Tax>
      <SequenceNumber>${it.sequence}</SequenceNumber>
    </ProductItem>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Allowance xmlns="urn:GEINV:eInvoiceMessage:D0401:4.1">
  <Main>
    <AllowanceNumber>${esc(input.allowanceNo)}</AllowanceNumber>
    <AllowanceDate>${ymd(input.allowanceDate)}</AllowanceDate>
    <AllowanceType>1</AllowanceType>
    <Seller>
      <Identifier>${esc(input.seller.identifier)}</Identifier>
      <Name>${esc(input.seller.name)}</Name>
    </Seller>
    <Buyer>
      <Identifier>${esc(buyerId)}</Identifier>
      <Name>${esc(input.buyer.name)}</Name>
    </Buyer>
  </Main>
  <Details>${itemsXml}
  </Details>
  <Amount>
    <TaxAmount>${amt(input.taxAmount, 0)}</TaxAmount>
    <TotalAmount>${amt(input.totalAmount, 0)}</TotalAmount>
  </Amount>
</Allowance>
`;
}

export interface XmlAllowanceVoidInput {
  allowanceNo: string;
  allowanceDate: Date;
  voidDate: Date;
  voidReason: string;
  seller: XmlSeller;
  buyer: XmlBuyer;
}

export function buildD0501(input: XmlAllowanceVoidInput): string {
  const buyerId = input.buyer.identifier && input.buyer.identifier.trim()
    ? input.buyer.identifier.trim()
    : '0000000000';
  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelAllowance xmlns="urn:GEINV:eInvoiceMessage:D0501:4.1">
  <Main>
    <CancelAllowanceNumber>${esc(input.allowanceNo)}</CancelAllowanceNumber>
    <AllowanceDate>${ymd(input.allowanceDate)}</AllowanceDate>
    <CancelDate>${ymd(input.voidDate)}</CancelDate>
    <CancelReason>${esc(input.voidReason)}</CancelReason>
    <Seller>
      <Identifier>${esc(input.seller.identifier)}</Identifier>
    </Seller>
    <Buyer>
      <Identifier>${esc(buyerId)}</Identifier>
    </Buyer>
  </Main>
</CancelAllowance>
`;
}

// ---------- C0701 空白字軌回報 ----------

export interface XmlBlankRangeInput {
  seller: XmlSeller;
  yearMonth: string;   // "11311"
  trackAlpha: string;  // "AB"
  startNumber: string; // "12345678"
  endNumber: string;   // "12349999"
  reason: '1' | '2' | '3'; // 1=跳開 2=未使用 3=其他
}

export function buildC0701(input: XmlBlankRangeInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<BlankInvoiceNumber xmlns="urn:GEINV:eInvoiceMessage:C0701:4.1">
  <Main>
    <Seller>
      <Identifier>${esc(input.seller.identifier)}</Identifier>
      <Name>${esc(input.seller.name)}</Name>
    </Seller>
    <InvoiceTrack>${esc(input.trackAlpha)}</InvoiceTrack>
    <InvoiceBeginNo>${esc(input.startNumber)}</InvoiceBeginNo>
    <InvoiceEndNo>${esc(input.endNumber)}</InvoiceEndNo>
    <InvoiceYearMonth>${esc(input.yearMonth)}</InvoiceYearMonth>
    <BlankReason>${esc(input.reason)}</BlankReason>
  </Main>
</BlankInvoiceNumber>
`;
}

// ---------- C0501 作廢 ----------

export function buildC0501(input: XmlVoidInput): string {
  const { track, number } = splitInvoiceNo(input.invoiceNo);
  void track; void number;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelInvoice xmlns="urn:GEINV:eInvoiceMessage:C0501:4.1">
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

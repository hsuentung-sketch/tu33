/**
 * MIG 4.1 XML builder for 財政部 Turnkey v3.2+（存證發票 F/G 系列）。
 *
 * 依「電子發票 Turnkey 上線前自行檢測作業 V4.8」（113-12-30）與
 * 「電子發票資料交換標準 MIG 4.1」（114-10-29）規範。
 *
 * 涵蓋訊息：
 *  - F0401 存證發票開立（B2C；有統編買方也走此格式）
 *  - F0501 存證發票作廢（限當期內作廢）
 *  - F0701 存證發票註銷（跨期或需重開時使用）
 *  - G0401 折讓證明單（賣方開立）
 *  - G0501 作廢折讓證明單
 *  - E0402 空白未使用字軌回報（每期 10 號前必上傳）
 *
 * 稅別金額分區（MIG 4.1 Amount 區塊）：
 *  - TaxType=1 應稅：SalesAmount>0, FreeTax=0, ZeroTax=0, TaxAmount=Sales×Rate
 *  - TaxType=2 零稅：SalesAmount=0, FreeTax=0, ZeroTax>0, TaxAmount=0
 *  - TaxType=3 免稅：SalesAmount=0, FreeTax>0, ZeroTax=0, TaxAmount=0
 *  - TaxType=9 混稅：Sales>0 且 FreeTax>0（依品項 taxType 分區）
 */

// ---------- 共用型別 ----------

export interface XmlSeller {
  identifier: string; // 8 碼統編
  name: string;
  address?: string;
  /** 賣方負責人姓名（MIG 4.1 檢測要求） */
  personInCharge?: string;
  /** 賣方電話（檢測要求） */
  telephoneNumber?: string;
  /** 賣方傳真（選填） */
  facsimileNumber?: string;
}

export interface XmlBuyer {
  identifier: string | null; // null / 空白 → "0000000000" (B2C)
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
  /** 每品項稅別（混稅情境用）；預設沿用全發票 taxType */
  taxType?: string;
  remark?: string;
}

export interface XmlInvoiceInput {
  invoiceNo: string;       // "AB12345678"
  invoiceDate: Date;
  seller: XmlSeller;
  buyer: XmlBuyer;
  items: XmlInvoiceItem[];
  /** 應稅銷售額（TaxType=1 部分的合計） */
  salesAmount: number;
  /** 免稅銷售額（TaxType=3 部分的合計，MIG 4.1 required 欄位） */
  freeTaxSalesAmount: number;
  /** 零稅率銷售額（TaxType=2 部分的合計，MIG 4.1 required 欄位） */
  zeroTaxSalesAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** 全發票稅別："1"=應稅 "2"=零稅 "3"=免稅 "9"=混稅 */
  taxType: string;
  taxRate?: number;        // default 0.05
  /** 4 碼隨機碼；MIG 4.1 為非必填但買方為消費者時建議填 */
  randomCode?: string;
  /** 載具類別：3J0002=手機條碼 CQ0001=自然人憑證 EJ0113=會員載具等 */
  carrierType?: string;
  /** 載具顯碼（Id1）。手機條碼情境：Id1=Id2 皆為手機碼 */
  carrierId1?: string;
  /** 載具隱碼（Id2）。若未提供，會 fallback 為 Id1 */
  carrierId2?: string;
  /** 捐贈碼 NPOBAN 3-7 位數字 */
  npoban?: string;
  /** Y=列印證明聯 N=不列印 */
  printFlag?: string;
  /** 總備註最多 200 字（MIG 4.1 新增） */
  mainRemark?: string;
  /** 通關方式 "1"=非經海關 "2"=經海關；零稅率必填（MIG 4.1 新增） */
  customsClearanceMark?: string;
  /** 零稅率原因（搭配 taxType=2 使用；MIG 4.1 新增） */
  zeroTaxRateReason?: string;
}

export interface XmlVoidInput {
  invoiceNo: string;
  invoiceDate: Date;    // 原開立日期
  voidDate: Date;
  voidReason: string;
  buyer?: XmlBuyer;     // 用於填 BuyerId
  seller?: XmlSeller;   // 用於填 SellerId
}

/** F0701 註銷發票輸入（跨期修正用） */
export interface XmlVoidF0701Input {
  invoiceNo: string;
  invoiceDate: Date;    // 原開立日期
  voidDate: Date;       // 註銷日期
  voidReason: string;
  buyer: XmlBuyer;
  seller: XmlSeller;
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

/** YYYYMMDD in Asia/Taipei. MIG 接受西元或民國，本實作沿用西元。 */
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

/** HH:MM:SS in Asia/Taipei（MIG 4.1 VoidTime/CancelTime 使用冒號分隔） */
function hmsColon(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const h = parts.find((p) => p.type === 'hour')!.value;
  const m = parts.find((p) => p.type === 'minute')!.value;
  const s = parts.find((p) => p.type === 'second')!.value;
  return `${h}:${m}:${s}`;
}

/** HHmmss (no separator) — legacy fmt for InvoiceTime */
function hms(date: Date): string {
  return hmsColon(date).replace(/:/g, '');
}

/** MIG amounts: numbers rounded to integer or fixed 2-decimal, no thousands separator. */
function amt(n: number, decimals = 0): string {
  return n.toFixed(decimals);
}

/** 買方統編補齊：空白/null → 10 個 0（B2C） */
function normalizeBuyerId(id: string | null | undefined): string {
  const v = (id ?? '').trim();
  return v ? v : '0000000000';
}

/** 賣方擴充資訊區塊 */
function sellerExtraTags(s: XmlSeller): string {
  const parts: string[] = [];
  if (s.address) parts.push(`<Address>${esc(s.address)}</Address>`);
  if (s.personInCharge) parts.push(`<PersonInCharge>${esc(s.personInCharge)}</PersonInCharge>`);
  if (s.telephoneNumber) parts.push(`<TelephoneNumber>${esc(s.telephoneNumber)}</TelephoneNumber>`);
  if (s.facsimileNumber) parts.push(`<FacsimileNumber>${esc(s.facsimileNumber)}</FacsimileNumber>`);
  return parts.length ? '\n      ' + parts.join('\n      ') : '';
}

// ---------- F0401 存證發票開立 ----------

export function buildF0401(input: XmlInvoiceInput): string {
  const taxRate = input.taxRate ?? 0.05;
  const buyerId = normalizeBuyerId(input.buyer.identifier);
  const randomCode = input.randomCode ?? '0000';
  const printFlag = input.printFlag ?? 'Y';

  // 每品項 TaxType（無填則沿用全發票 taxType），支援混合稅率。
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

  // 載具區塊：CarrierId1=顯碼、CarrierId2=隱碼（若未提供隱碼則沿用顯碼）
  let carrierBlock = '';
  if (input.carrierType && input.carrierId1) {
    const id1 = input.carrierId1;
    const id2 = input.carrierId2 ?? input.carrierId1;
    carrierBlock = `
    <CarrierType>${esc(input.carrierType)}</CarrierType>
    <CarrierId1>${esc(id1)}</CarrierId1>
    <CarrierId2>${esc(id2)}</CarrierId2>`;
  }
  const donationBlock = input.npoban
    ? `
    <NPOBAN>${esc(input.npoban)}</NPOBAN>`
    : '';

  // MIG 4.1 Main-level optional 欄位
  const mainRemarkBlock = input.mainRemark ? `
    <MainRemark>${esc(input.mainRemark.slice(0, 200))}</MainRemark>` : '';
  const customsBlock = input.customsClearanceMark ? `
    <CustomsClearanceMark>${esc(input.customsClearanceMark)}</CustomsClearanceMark>` : '';
  const zeroTaxBlock = input.zeroTaxRateReason ? `
    <ZeroTaxRateReason>${esc(input.zeroTaxRateReason)}</ZeroTaxRateReason>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:GEINV:eInvoiceMessage:F0401:4.1">
  <Main>
    <InvoiceNumber>${esc(input.invoiceNo)}</InvoiceNumber>
    <InvoiceDate>${ymd(input.invoiceDate)}</InvoiceDate>
    <InvoiceTime>${hmsColon(input.invoiceDate)}</InvoiceTime>
    <Seller>
      <Identifier>${esc(input.seller.identifier)}</Identifier>
      <Name>${esc(input.seller.name)}</Name>${sellerExtraTags(input.seller)}
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
    <FreeTaxSalesAmount>${amt(input.freeTaxSalesAmount, 0)}</FreeTaxSalesAmount>
    <ZeroTaxSalesAmount>${amt(input.zeroTaxSalesAmount, 0)}</ZeroTaxSalesAmount>
    <TaxType>${esc(input.taxType)}</TaxType>
    <TaxRate>${amt(taxRate, 4)}</TaxRate>
    <TaxAmount>${amt(input.taxAmount, 0)}</TaxAmount>
    <TotalAmount>${amt(input.totalAmount, 0)}</TotalAmount>
  </Amount>
</Invoice>
`;
}

// ---------- F0501 存證發票作廢（當期內） ----------

export function buildF0501(input: XmlVoidInput): string {
  const buyerId = normalizeBuyerId(input.buyer?.identifier);
  const sellerId = input.seller?.identifier ?? '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelInvoice xmlns="urn:GEINV:eInvoiceMessage:F0501:4.1">
  <Main>
    <CancelInvoiceNumber>${esc(input.invoiceNo)}</CancelInvoiceNumber>
    <BuyerId>${esc(buyerId)}</BuyerId>
    <SellerId>${esc(sellerId)}</SellerId>
    <InvoiceDate>${ymd(input.invoiceDate)}</InvoiceDate>
    <CancelDate>${ymd(input.voidDate)}</CancelDate>
    <CancelTime>${hmsColon(input.voidDate)}</CancelTime>
    <CancelReason>${esc(input.voidReason)}</CancelReason>
  </Main>
</CancelInvoice>
`;
}

// ---------- F0701 存證發票註銷（跨期或需重開時） ----------

export function buildF0701(input: XmlVoidF0701Input): string {
  const buyerId = normalizeBuyerId(input.buyer.identifier);
  const sellerId = input.seller.identifier;
  return `<?xml version="1.0" encoding="UTF-8"?>
<VoidInvoice xmlns="urn:GEINV:eInvoiceMessage:F0701:4.1">
  <Main>
    <VoidInvoiceNumber>${esc(input.invoiceNo)}</VoidInvoiceNumber>
    <BuyerId>${esc(buyerId)}</BuyerId>
    <SellerId>${esc(sellerId)}</SellerId>
    <InvoiceDate>${ymd(input.invoiceDate)}</InvoiceDate>
    <VoidDate>${ymd(input.voidDate)}</VoidDate>
    <VoidTime>${hmsColon(input.voidDate)}</VoidTime>
    <VoidReason>${esc(input.voidReason)}</VoidReason>
  </Main>
</VoidInvoice>
`;
}

// ---------- G0401 折讓證明單 ----------

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
  freeTaxSalesAmount: number;
  zeroTaxSalesAmount: number;
  taxAmount: number;
  totalAmount: number;
  /** 折讓種類："1"=買方 "2"=賣方 "3"=雙方；MIG 4.1 依實際發起方填入 */
  allowanceType: string;
}

export function buildG0401(input: XmlAllowanceInput): string {
  const buyerId = normalizeBuyerId(input.buyer.identifier);

  // MIG 4.1 G0401 ProductItem XSD 要求：Tax 後必須至少一個 {Unit, AllowanceSequenceNumber} 才能到 SequenceNumber。
  // 補上 AllowanceSequenceNumber = 原發票品項序號，滿足 choice group。
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
      <AllowanceSequenceNumber>${it.originalSequence ?? it.sequence}</AllowanceSequenceNumber>
      <SequenceNumber>${it.sequence}</SequenceNumber>
    </ProductItem>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Allowance xmlns="urn:GEINV:eInvoiceMessage:G0401:4.1">
  <Main>
    <AllowanceNumber>${esc(input.allowanceNo)}</AllowanceNumber>
    <AllowanceDate>${ymd(input.allowanceDate)}</AllowanceDate>
    <AllowanceType>${esc(input.allowanceType)}</AllowanceType>
    <Seller>
      <Identifier>${esc(input.seller.identifier)}</Identifier>
      <Name>${esc(input.seller.name)}</Name>${sellerExtraTags(input.seller)}
    </Seller>
    <Buyer>
      <Identifier>${esc(buyerId)}</Identifier>
      <Name>${esc(input.buyer.name)}</Name>
    </Buyer>
  </Main>
  <Details>${itemsXml}
  </Details>
  <Amount>
    <SalesAmount>${amt(input.salesAmount, 0)}</SalesAmount>
    <FreeTaxSalesAmount>${amt(input.freeTaxSalesAmount, 0)}</FreeTaxSalesAmount>
    <ZeroTaxSalesAmount>${amt(input.zeroTaxSalesAmount, 0)}</ZeroTaxSalesAmount>
    <TaxAmount>${amt(input.taxAmount, 0)}</TaxAmount>
    <TotalAmount>${amt(input.totalAmount, 0)}</TotalAmount>
  </Amount>
</Allowance>
`;
}

// ---------- G0501 作廢折讓證明單 ----------

export interface XmlAllowanceVoidInput {
  allowanceNo: string;
  allowanceDate: Date;
  voidDate: Date;
  voidReason: string;
  seller: XmlSeller;
  buyer: XmlBuyer;
  /** 折讓種類（同 G0401） */
  allowanceType: string;
}

export function buildG0501(input: XmlAllowanceVoidInput): string {
  const buyerId = normalizeBuyerId(input.buyer.identifier);
  return `<?xml version="1.0" encoding="UTF-8"?>
<CancelAllowance xmlns="urn:GEINV:eInvoiceMessage:G0501:4.1">
  <Main>
    <CancelAllowanceNumber>${esc(input.allowanceNo)}</CancelAllowanceNumber>
    <AllowanceDate>${ymd(input.allowanceDate)}</AllowanceDate>
    <CancelDate>${ymd(input.voidDate)}</CancelDate>
    <CancelTime>${hmsColon(input.voidDate)}</CancelTime>
    <CancelReason>${esc(input.voidReason)}</CancelReason>
    <AllowanceType>${esc(input.allowanceType)}</AllowanceType>
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

// ---------- E0402 空白未使用字軌回報 ----------

export interface XmlBlankRangeInput {
  seller: XmlSeller;
  /** 期別：民國 3+2+2 = 7 碼，例 "1131112" = 民國 113 年 11-12 月期 */
  yearMonth: string;
  /** 字軌 2 碼英文 */
  trackAlpha: string;
  /** 起號 8 碼 */
  startNumber: string;
  /** 迄號 8 碼 */
  endNumber: string;
  /** 空白原因 "1"=跳開 "2"=未使用 "3"=其他 */
  reason: '1' | '2' | '3';
}

export function buildE0402(input: XmlBlankRangeInput): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<BlankInvoiceNumber xmlns="urn:GEINV:eInvoiceMessage:E0402:4.1">
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

// ---------- 稅別金額分區 helper（供 service 呼叫） ----------

export interface TaxBreakdown {
  /** 應稅銷售額（TaxType=1 部分） */
  salesAmount: number;
  /** 免稅銷售額（TaxType=3 部分） */
  freeTaxSalesAmount: number;
  /** 零稅率銷售額（TaxType=2 部分） */
  zeroTaxSalesAmount: number;
  /** 稅額 = 應稅銷售額 × 稅率（四捨五入） */
  taxAmount: number;
  /** 總計 */
  totalAmount: number;
  /** 全發票稅別（1/2/3/9），依 items 內容自動判斷 */
  overallTaxType: string;
}

/**
 * 依品項 taxType 分區計算 SalesAmount / FreeTaxSalesAmount / ZeroTaxSalesAmount。
 *
 * MIG 4.1 金額規則：
 *  - 應稅（1）→ SalesAmount>0, FreeTax=0, ZeroTax=0, TaxAmount=Sales×Rate
 *  - 零稅（2）→ SalesAmount=0, FreeTax=0, ZeroTax>0, TaxAmount=0
 *  - 免稅（3）→ SalesAmount=0, FreeTax>0, ZeroTax=0, TaxAmount=0
 *  - 混稅（9）→ 至少兩種同時 >0；本 helper 自動偵測並回傳 overallTaxType='9'
 *
 * @param items 每筆需含 amount 與 taxType
 * @param taxRate 應稅稅率，預設 0.05
 * @param fallbackTaxType 若品項未填 taxType 時的預設值
 */
export function computeTaxBreakdown(
  items: Array<{ amount: number; taxType?: string }>,
  taxRate: number,
  fallbackTaxType: string,
): TaxBreakdown {
  let sales = 0;
  let free = 0;
  let zero = 0;
  const seen = new Set<string>();
  for (const it of items) {
    const t = it.taxType ?? fallbackTaxType;
    seen.add(t);
    if (t === '1') sales += it.amount;
    else if (t === '2') zero += it.amount;
    else if (t === '3') free += it.amount;
    else {
      // 未知 taxType 一律歸應稅（安全 fallback）
      sales += it.amount;
      seen.add('1');
    }
  }
  const taxAmount = Math.round(sales * taxRate);
  const totalAmount = sales + free + zero + taxAmount;
  const overallTaxType = seen.size > 1 ? '9' : ([...seen][0] ?? fallbackTaxType);
  return {
    salesAmount: Math.round(sales),
    freeTaxSalesAmount: Math.round(free),
    zeroTaxSalesAmount: Math.round(zero),
    taxAmount,
    totalAmount: Math.round(totalAmount),
    overallTaxType,
  };
}

import { prisma } from '../../../shared/prisma.js';
import { NotFoundError, ValidationError } from '../../../shared/errors.js';
import { getTenantSettings } from '../../../shared/utils.js';
import { writeAudit } from '../../../shared/audit.js';
import { buildF0401, buildF0501, buildF0701, computeTaxBreakdown } from './xml-builder.js';
import { writeIssueXml, writeVoidXml, writeNullifyXml } from './turnkey-writer.js';
import { assertTenantIsolation } from "../../../shared/tenant-isolation.js";

export interface IssueItemInput {
  sequence?: number;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  amount?: number; // defaults to round(quantity * unitPrice)
  /** 品項稅別 "1"=應稅 "2"=零稅 "3"=免稅；未填則沿用全發票 taxType */
  taxType?: string;
}

export interface IssueInput {
  receivableId?: string;
  salesOrderId?: string;
  buyerTaxId?: string | null; // null / empty → B2C 二聯式
  buyerName: string;
  buyerAddress?: string;
  items: IssueItemInput[];
  taxType?: string;           // default from tenant settings；混稅由 items 自動偵測
  invoiceDate?: Date;         // default now
  /** 載具類別：3J0002=手機條碼 CQ0001=自然人憑證 EJ0113=會員載具 */
  carrierType?: string;
  /**
   * 載具 ID（v2.17+ 起）：
   *  - 一般情境（手機條碼/自然人憑證）：填 carrierId1，若未提供 carrierId2 則沿用 carrierId1
   *  - 信用卡載具：carrierId1=刷卡日期+金額；carrierId2=加密卡號（不同值）
   * 舊參數 carrierId 保留向後相容，內部映射為 carrierId1。
   */
  carrierId1?: string;
  carrierId2?: string;
  /** @deprecated 用 carrierId1 / carrierId2；本欄位保留 backward compat */
  carrierId?: string;
  /** 捐贈碼 3-7 碼數字 */
  npoban?: string;
  /** Y=列印證明聯 N=不列印；預設依 tenant 設定 */
  printFlag?: string;
  /** MIG 4.1：總備註（200 字內），寫入 XML <MainRemark> */
  mainRemark?: string;
  /** MIG 4.1：通關方式 "1"=非經海關 "2"=經海關，零稅率時必填 */
  customsClearanceMark?: string;
  /** MIG 4.1：零稅率原因（搭配 taxType=2 ） */
  zeroTaxRateReason?: string;
  /** 分支機構 id；總公司 = null/undefined。決定從哪個分支的字軌池配號（項 9(3)）。 */
  branchId?: string | null;
  createdBy?: string;
}

function randomFourDigits(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function validateCarrier(type?: string, id?: string): void {
  if (!type && !id) return;
  if (!type || !id) throw new ValidationError('載具類別與載具 ID 需同時填寫');
  const trimmed = id.trim();
  if (type === '3J0002') {
    if (!/^\/[0-9A-Z.\-+]{7}$/.test(trimmed)) {
      throw new ValidationError('手機條碼格式錯誤（需以 / 開頭，共 8 碼）');
    }
  } else if (type === 'CQ0001') {
    if (!/^[A-Z]{2}\d{14}$/.test(trimmed)) {
      throw new ValidationError('自然人憑證格式錯誤（2 英文 + 14 數字）');
    }
  } else if (!/^[A-Z]{2}\d{4}$/.test(type)) {
    throw new ValidationError('載具類別代碼格式錯誤');
  }
}

function validateNpoban(code?: string): void {
  if (!code) return;
  if (!/^\d{3,7}$/.test(code.trim())) {
    throw new ValidationError('捐贈碼需為 3-7 位數字');
  }
}

// ----- pool -----

export async function listPools(tenantId: string, opts: { includeInactive?: boolean } = {}) {
  return prisma.einvoiceNumberPool.findMany({
    where: { tenantId, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createPool(tenantId: string, data: {
  yearMonth: string; trackAlpha: string; rangeStart: number; rangeEnd: number;
  /** 分支機構 id；總公司 = null。多分店字軌隔離用（自行檢測表項 9(3)）。 */
  branchId?: string | null;
  note?: string; createdBy?: string;
}) {
  if (!/^[A-Z]{2}$/.test(data.trackAlpha)) {
    throw new ValidationError('字軌必須為兩個大寫英文字母');
  }
  // 期別格式：民國年(3) + 單月(2) + 雙月(2) = 7 碼。例 "1131112" = 113 年 11-12 月期。
  // 依財政部「自行檢測表」項 5：須為 年(3碼)+單月(2碼)+雙月(2碼)。
  if (!/^\d{7}$/.test(data.yearMonth)) {
    throw new ValidationError('期別格式錯誤（須為 7 碼，民國年 3 碼 + 單月 2 碼 + 雙月 2 碼，如 "1131112" 代表民國 113 年 11-12 月期）');
  }
  const ymY = Number(data.yearMonth.slice(0, 3));
  const ymOdd = Number(data.yearMonth.slice(3, 5));
  const ymEven = Number(data.yearMonth.slice(5, 7));
  if (ymY < 100 || ymOdd < 1 || ymOdd > 12 || ymOdd % 2 !== 1 || ymEven !== ymOdd + 1) {
    throw new ValidationError('期別月份不合法：單月須為 1/3/5/7/9/11，雙月須為單月+1（如 1131112、1140102）');
  }
  if (data.rangeStart < 0 || data.rangeEnd <= data.rangeStart) {
    throw new ValidationError('起訖號碼錯誤');
  }
  return prisma.einvoiceNumberPool.create({
    data: {
      tenantId,
      yearMonth: data.yearMonth,
      trackAlpha: data.trackAlpha,
      rangeStart: data.rangeStart,
      rangeEnd: data.rangeEnd,
      nextNumber: data.rangeStart,
      branchId: data.branchId ?? null,
      note: data.note,
      createdBy: data.createdBy,
    },
  });
}

export async function updatePool(tenantId: string, id: string, data: { isActive?: boolean; note?: string | null }) {
  const existing = await prisma.einvoiceNumberPool.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('EinvoiceNumberPool', id);
  return prisma.einvoiceNumberPool.update({ where: { id }, data });
}

/**
 * 匯入「整合服務平台」下發的配號 CSV。
 * 依財政部「自行檢測表」項 1(1)：以平台產出 CSV 配號檔匯入。
 *
 * 容忍多種欄位命名（中/英）：
 *   - 期別 / 年期別 / yearMonth / InvoiceYearMonth
 *   - 字軌 / 字軌號碼 / track / trackAlpha / InvoiceTrack
 *   - 起號 / InvoiceBeginNo / rangeStart
 *   - 迄號 / 訖號 / InvoiceEndNo / rangeEnd
 *
 * 解析自動 strip UTF-8 BOM。任何欄位驗證失敗的列會被計入 errors，不中斷匯入。
 * 同 (tenantId, yearMonth, trackAlpha, rangeStart) 已存在則 skip。
 */
export interface ImportPoolsCsvResult {
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export async function importPoolsCsv(
  tenantId: string,
  csvText: string,
  createdBy?: string,
  /** 這批 CSV 屬於哪個分支；總公司 = null。CSV 本身不含分支概念，由匯入時指定。 */
  branchId: string | null = null,
): Promise<ImportPoolsCsvResult> {
  const result: ImportPoolsCsvResult = { inserted: 0, skipped: 0, errors: [] };
  const stripped = csvText.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!stripped) throw new ValidationError('CSV 內容為空');
  const lines = stripped.split('\n').filter((l) => l.length);
  if (lines.length < 2) throw new ValidationError('CSV 至少需 1 列標頭 + 1 列資料');

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const idxOf = (...alts: string[]) => {
    for (const a of alts) {
      const i = headers.findIndex((h) => h === a || h.replace(/\s/g, '') === a);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iY = idxOf('期別', '年期別', 'yearMonth', 'InvoiceYearMonth', '發票期別');
  const iT = idxOf('字軌', '字軌號碼', 'track', 'trackAlpha', 'InvoiceTrack', '發票字軌名稱');
  const iS = idxOf('起號', 'InvoiceBeginNo', 'rangeStart', '起', '發票起號');
  const iE = idxOf('迄號', '訖號', 'InvoiceEndNo', 'rangeEnd', '迄', '發票迄號');
  if (iY < 0 || iT < 0 || iS < 0 || iE < 0) {
    throw new ValidationError(`CSV 欄位缺漏：期別=${iY} 字軌=${iT} 起號=${iS} 迄號=${iE}（headers=${headers.join('|')}）`);
  }

  for (let r = 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r]).map((c) => c.trim());
    if (cells.every((c) => !c)) continue;
    try {
      const yearMonth = normalizeYearMonth(cells[iY]);
      const trackAlpha = cells[iT].toUpperCase();
      const rangeStart = Number(cells[iS]);
      const rangeEnd = Number(cells[iE]);
      if (!/^\d{7}$/.test(yearMonth)) throw new Error(`期別 ${cells[iY]} 無法解析為 7 碼（如 1150708）`);
      if (!/^[A-Z]{2}$/.test(trackAlpha)) throw new Error(`字軌 ${trackAlpha} 非兩碼大寫英文`);
      if (!Number.isInteger(rangeStart) || rangeStart < 0) throw new Error(`起號 ${cells[iS]} 不合法`);
      if (!Number.isInteger(rangeEnd) || rangeEnd <= rangeStart) throw new Error(`迄號 ${cells[iE]} 不合法`);

      const exists = await prisma.einvoiceNumberPool.findFirst({
        where: { tenantId, yearMonth, trackAlpha, rangeStart, branchId },
      });
      if (exists) { result.skipped++; continue; }

      await prisma.einvoiceNumberPool.create({
        data: {
          tenantId, yearMonth, trackAlpha, rangeStart, rangeEnd,
          nextNumber: rangeStart, branchId, createdBy,
          note: 'imported via CSV',
        },
      });
      result.inserted++;
    } catch (err) {
      result.errors.push({ row: r + 1, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/**
 * 正規化期別為 7 碼（民國年 3 + 單月 2 + 雙月 2）。
 * 接受：
 *   "1150708"        → "1150708"
 *   "115/07 ~ 115/08" → "1150708"
 *   "115/07~115/08"  → "1150708"
 *   "115/07-08"      → "1150708"
 *   "115/07"         → "1150708"（自動補雙月）
 */
function normalizeYearMonth(raw: string): string {
  const s = raw.replace(/\s|～/g, '').replace(/~|-|—|–/g, '-');
  if (/^\d{7}$/.test(s)) return s;
  let m = s.match(/^(\d{3})\/(\d{1,2})-(\d{3})\/(\d{1,2})$/);
  if (m) return `${m[1]}${m[2].padStart(2, '0')}${m[4].padStart(2, '0')}`;
  m = s.match(/^(\d{3})\/(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{3})\/(\d{1,2})$/);
  if (m) {
    const odd = parseInt(m[2], 10);
    const start = odd % 2 === 1 ? odd : odd - 1;
    const end = start + 1;
    return `${m[1]}${String(start).padStart(2, '0')}${String(end).padStart(2, '0')}`;
  }
  return raw;
}

/** Minimal CSV line parser supporting quoted cells with embedded commas/quotes. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 由 Date 推導對應期別 7 碼（民國年 3 + 單月 2 + 雙月 2，台北時區）。
 * 例：2026-05-15 → 民國 115 年 5-6 月期 → "1150506"
 */
export function periodOfDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year')!.value) - 1911;
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const odd = m % 2 === 1 ? m : m - 1;
  const even = odd + 1;
  return `${String(y).padStart(3, '0')}${String(odd).padStart(2, '0')}${String(even).padStart(2, '0')}`;
}

/**
 * Allocate the next invoice number from a pool whose 期別 covers `invoiceDate`.
 * 依財政部「自行檢測表」項 2(2)：依交易時間其發票號碼必須為當期所屬字軌號碼。
 * 依項 9(3)：分支機構不可誤用其他分支的字軌號碼 —— pool 以 branchId 隔離，
 *           總公司開單 branchId=null 只抓 branchId=null 的 pool。
 *
 * Pool 必須 isActive=true、yearMonth === periodOfDate(invoiceDate) 且 branchId 相符。
 * 同期若有多 pool 用 FIFO（createdAt asc）；耗盡則自動停用後再 retry。
 * Optimistic concurrency: UPDATE ... WHERE nextNumber = expected。
 */
async function allocateNumber(
  tenantId: string,
  invoiceDate: Date,
  branchId: string | null = null,
): Promise<{ poolId: string; trackAlpha: string; number: number }> {
  const wantedPeriod = periodOfDate(invoiceDate);
  for (let attempt = 0; attempt < 8; attempt++) {
    const pool = await prisma.einvoiceNumberPool.findFirst({
      where: { tenantId, isActive: true, yearMonth: wantedPeriod, branchId },
      orderBy: { createdAt: 'asc' },
    });
    if (!pool) break;
    if (pool.nextNumber > pool.rangeEnd) {
      // Defensive: auto-deactivate exhausted pool and retry.
      await prisma.einvoiceNumberPool.update({ where: { id: pool.id }, data: { isActive: false } }).catch(() => {});
      continue;
    }
    const taken = pool.nextNumber;
    // Atomic increment guarded by nextNumber equality.
    const { count } = await prisma.einvoiceNumberPool.updateMany({
      where: { id: pool.id, nextNumber: taken },
      data: { nextNumber: taken + 1 },
    });
    if (count === 1) {
      // Auto-deactivate when just-incremented value exceeds the range.
      if (taken + 1 > pool.rangeEnd) {
        await prisma.einvoiceNumberPool.update({ where: { id: pool.id }, data: { isActive: false } }).catch(() => {});
      }
      return { poolId: pool.id, trackAlpha: pool.trackAlpha, number: taken };
    }
    // Race lost → retry.
  }
  throw new ValidationError(
    `無可用配號：交易日 ${invoiceDate.toISOString().slice(0, 10)} 對應期別 ${wantedPeriod}`
    + `${branchId ? `（分支 ${branchId}）` : '（總公司）'}，請先新增該期配號`,
  );
}

function formatInvoiceNo(trackAlpha: string, number: number): string {
  return `${trackAlpha}${String(number).padStart(8, '0')}`;
}

function roundMoney(n: number): number {
  return Math.round(n);
}

// ----- issue -----

export async function issue(tenantId: string, input: IssueInput) {
  if (!input.items?.length) throw new ValidationError('至少需要一個品項');
  if (!input.buyerName?.trim()) throw new ValidationError('請填寫買受人名稱');
  if (input.buyerTaxId && !/^\d{8}$/.test(input.buyerTaxId.trim())) {
    throw new ValidationError('買受人統一編號應為 8 碼數字（B2C 可留空）');
  }
  // Backward-compat: 舊呼叫端傳 carrierId → 映射到 carrierId1
  const carrierId1 = input.carrierId1 ?? input.carrierId;
  const carrierId2 = input.carrierId2 ?? carrierId1;
  if (input.carrierType || carrierId1 || input.npoban) {
    if (input.buyerTaxId) {
      throw new ValidationError('B2B（有統編）不可使用載具或捐贈碼');
    }
  }
  if (input.carrierType && input.npoban) {
    throw new ValidationError('載具與捐贈碼只能擇一');
  }
  validateCarrier(input.carrierType, carrierId1);
  if (carrierId2 && carrierId2 !== carrierId1) validateCarrier(input.carrierType, carrierId2);
  validateNpoban(input.npoban);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  const einvCfg = settings.einvoice;
  // 賣方資訊一律取自「公司資料」（Tenant.companyName / taxId / address），
  // 不再讀 settings.einvoice.sellerXxx override —— 防止使用者誤填造成 XML
  // <Seller> 區塊填到客戶資料而被財政部退件。
  const sellerTaxId = tenant.taxId || '';
  const sellerName = tenant.companyName;
  const sellerAddress = tenant.address || '';
  if (!/^\d{8}$/.test(sellerTaxId)) {
    throw new ValidationError('Tenant.taxId 未設定或格式錯誤（請至「公司資料」填 8 碼統編）');
  }
  if (!einvCfg.turnkeyInboundDir) {
    throw new ValidationError('尚未設定 Turnkey 匯入目錄（settings.einvoice.turnkeyInboundDir）');
  }
  // 依財政部「自行檢測表」項 8(8)：QRCode 內容須包含正確加密驗證資訊。
  // 正式上線後強制設定整合服務平台下發的 AES-128 金鑰（32 碼 hex）。
  // 檢測期間（尚未取得 turnkeyOnlineCode）可留空，proof-barcodes.ts 用 stub key 並 log 警示。
  if (process.env.NODE_ENV === 'production' && einvCfg.turnkeyOnlineCode) {
    if (!einvCfg.qrAesKey || !/^[0-9a-fA-F]{32}$/.test(einvCfg.qrAesKey)) {
      throw new ValidationError(
        'settings.einvoice.qrAesKey 未設定或格式錯誤：正式上線後須填整合服務平台下發的 32 碼 hex AES-128 金鑰',
      );
    }
  }

  // Optional linkage checks.
  if (input.receivableId) {
    const ar = await prisma.accountReceivable.findFirst({
      where: { id: input.receivableId, tenantId },
      include: { einvoice: true },
    });
    if (!ar) throw new NotFoundError('AccountReceivable', input.receivableId);
    if (ar.einvoice && ar.einvoice.status !== 'voided') {
      throw new ValidationError('此應收帳款已有有效電子發票');
    }
  }

  const now = new Date();
  const invoiceDate = input.invoiceDate ?? now;
  const taxType = input.taxType ?? einvCfg.defaultTaxType ?? '1';
  const taxRate = settings.taxRate;
  const randomCode = randomFourDigits();
  const printFlag = input.printFlag
    ?? ((input.carrierType || input.npoban) ? 'N' : (einvCfg.defaultPrintFlag || 'Y'));

  const preparedItems = input.items.map((it, idx) => {
    const amount = it.amount ?? roundMoney(it.quantity * it.unitPrice);
    return {
      sequence: it.sequence ?? idx + 1,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unitPrice: it.unitPrice,
      amount,
      taxType: it.taxType,
    };
  });

  // MIG 4.1 稅別分區：依品項 taxType 自動計算 SalesAmount / FreeTaxSalesAmount / ZeroTaxSalesAmount。
  // 若品項有多種 taxType，overallTaxType 自動變 '9' 混稅。
  const breakdown = computeTaxBreakdown(preparedItems, taxRate, taxType);
  const overallTaxType = breakdown.overallTaxType;
  const { salesAmount, freeTaxSalesAmount, zeroTaxSalesAmount, taxAmount, totalAmount } = breakdown;

  // Allocate BEFORE creating XML so filename / XML use the real number.
  // branchId 隔離：總公司開單抓 branchId=null 的 pool，分支抓自己的（項 9(3)）。
  const branchId = input.branchId ?? null;
  const allocated = await allocateNumber(tenantId, invoiceDate, branchId);
  const invoiceNo = formatInvoiceNo(allocated.trackAlpha, allocated.number);

  // MIG 4.1：零稅率必填通關方式，前端未帶則拒絕。
  if ((overallTaxType === '2' || zeroTaxSalesAmount > 0) && !input.customsClearanceMark) {
    throw new ValidationError('零稅率（taxType=2 或含零稅品項）必須填通關方式 customsClearanceMark（1=非經海關 2=經海關）');
  }

  const xml = buildF0401({
    invoiceNo,
    invoiceDate,
    seller: {
      identifier: sellerTaxId,
      name: sellerName,
      address: sellerAddress || undefined,
      personInCharge: einvCfg.sellerPersonInCharge || undefined,
      telephoneNumber: einvCfg.sellerTelephoneNumber || undefined,
      facsimileNumber: einvCfg.sellerFacsimileNumber || undefined,
    },
    buyer: {
      identifier: input.buyerTaxId?.trim() || null,
      name: input.buyerName.trim(),
      address: input.buyerAddress,
    },
    items: preparedItems,
    salesAmount,
    freeTaxSalesAmount,
    zeroTaxSalesAmount,
    taxAmount,
    totalAmount,
    taxType: overallTaxType,
    taxRate,
    randomCode,
    carrierType: input.carrierType,
    carrierId1,
    carrierId2,
    npoban: input.npoban,
    printFlag,
    mainRemark: input.mainRemark,
    customsClearanceMark: input.customsClearanceMark,
    zeroTaxRateReason: input.zeroTaxRateReason,
  });

  let xmlPath: string | null = null;
  try {
    const wrote = await writeIssueXml({ inboundDir: einvCfg.turnkeyInboundDir, invoiceNo, xml });
    xmlPath = wrote.absolutePath;
  } catch (err) {
    // If the write fails we intentionally keep the number allocated — the
    // number is already considered "used" and must not be reused per
    // 財政部 rules. We surface the error; ADMIN can retry from scratch.
    throw err instanceof Error ? err : new Error(String(err));
  }

  const created = await prisma.einvoice.create({
    data: {
      tenantId,
      invoiceNo,
      invoiceDate,
      buyerTaxId: input.buyerTaxId?.trim() || null,
      buyerName: input.buyerName.trim(),
      buyerAddress: input.buyerAddress,
      salesAmount,
      taxAmount,
      totalAmount,
      taxType: overallTaxType,
      status: 'issued',
      branchId,
      xmlPath,
      // 二份備份：XML 內容直接存 DB，Turnkey 主機毀損仍可從 DB 重建（項 11）
      xmlBody: xml,
      // MIG 4.1 新增欄位
      mainRemark: input.mainRemark,
      customsClearanceMark: input.customsClearanceMark,
      zeroTaxRateReason: input.zeroTaxRateReason,
      randomCode,
      carrierType: input.carrierType,
      carrierId: carrierId1,
      npoban: input.npoban,
      printFlag,
      receivableId: input.receivableId,
      salesOrderId: input.salesOrderId,
      createdBy: input.createdBy,
      items: {
        create: preparedItems.map((it) => ({
          sequence: it.sequence,
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      },
    },
    include: { items: { orderBy: { sequence: 'asc' } } },
  });

  // Back-fill AR.invoiceNo so the existing AR list shows it.
  if (input.receivableId) {
    await prisma.accountReceivable.update({
      where: { id: input.receivableId },
      data: { invoiceNo },
    }).catch(() => { /* non-fatal */ });
  }

  if (input.createdBy) {
    await writeAudit({
      tenantId, userId: input.createdBy,
      action: 'EINVOICE_ISSUE', entity: 'Einvoice', entityId: created.id,
      detail: { invoiceNo, totalAmount, buyerTaxId: input.buyerTaxId ?? null },
    });
  }

  return created;
}

// ----- void -----

export async function voidInvoice(tenantId: string, id: string, reason: string, voidedBy?: string) {
  if (!reason?.trim()) throw new ValidationError('請填寫作廢原因');
  const inv = await prisma.einvoice.findFirst({ where: { id, tenantId } });
  if (!inv) throw new NotFoundError('Einvoice', id);
  if (inv.status === 'voided') throw new ValidationError('此發票已作廢');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  if (!settings.einvoice.turnkeyInboundDir) {
    throw new ValidationError('尚未設定 Turnkey 匯入目錄');
  }

  const voidDate = new Date();
  // C0501 跨期檢核：依規範，作廢只能在發票當期內進行；跨期需走折讓單（D0401）。
  const invPeriod = periodOfDate(inv.invoiceDate);
  const voidPeriod = periodOfDate(voidDate);
  if (invPeriod !== voidPeriod) {
    throw new ValidationError(
      `發票期別 ${invPeriod} 與作廢日期 ${voidPeriod} 不同期，跨期作廢請改用「註銷」(F0701) 或折讓單 (G0401)`,
    );
  }
  const sellerTaxId = tenant.taxId || '';
  const xml = buildF0501({
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    voidDate,
    voidReason: reason.trim(),
    buyer: {
      identifier: inv.buyerTaxId,
      name: inv.buyerName,
    },
    seller: {
      identifier: sellerTaxId,
      name: tenant.companyName,
    },
  });
  const wrote = await writeVoidXml({
    inboundDir: settings.einvoice.turnkeyInboundDir,
    invoiceNo: inv.invoiceNo,
    xml,
  });

  const updated = await prisma.einvoice.update({
    where: { id },
    data: {
      status: 'voided',
      voidedAt: voidDate,
      voidReason: reason.trim(),
      voidXmlPath: wrote.absolutePath,
      voidXmlBody: xml,
    },
  });

  // If this invoice was linked to an AR, clear the cached invoiceNo so the
  // AR list no longer surfaces a voided number as "the" invoice.
  if (inv.receivableId) {
    await prisma.accountReceivable.update({
      where: { id: inv.receivableId }, data: { invoiceNo: null },
    }).catch(() => {});
  }

  if (voidedBy) {
    await writeAudit({
      tenantId, userId: voidedBy,
      action: 'EINVOICE_VOID', entity: 'Einvoice', entityId: id,
      detail: { invoiceNo: inv.invoiceNo, reason: reason.trim() },
    });
  }

  return updated;
}

// ----- nullify (F0701 註銷) -----

/**
 * F0701 註銷發票。用於：
 *  1. 跨期修正（發票已跨期，F0501 作廢不再受理）
 *  2. 發票內容錯誤需正式撤銷後重開
 *
 * 允許來源狀態：
 *  - 'issued'（直接註銷）
 *  - 'voided'（先作廢後註銷，通常搭配情境 1 或需重開的情境）
 *
 * 註銷後：status=nullified，AR 上的 invoiceNo 清空，可重開新發票（走 issue()）。
 */
export async function nullifyInvoice(tenantId: string, id: string, reason: string, actedBy?: string) {
  if (!reason?.trim()) throw new ValidationError('請填寫註銷原因');
  const inv = await prisma.einvoice.findFirst({ where: { id, tenantId } });
  if (!inv) throw new NotFoundError('Einvoice', id);
  if (inv.status === 'nullified') throw new ValidationError('此發票已註銷');
  if (inv.status !== 'issued' && inv.status !== 'voided') {
    throw new ValidationError(`此狀態（${inv.status}）不可註銷；僅 issued / voided 可執行 F0701`);
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);
  const settings = getTenantSettings(tenant.settings);
  const einvCfg = settings.einvoice;
  if (!einvCfg.turnkeyInboundDir) {
    throw new ValidationError('尚未設定 Turnkey 匯入目錄');
  }
  const sellerTaxId = tenant.taxId || '';
  if (!/^\d{8}$/.test(sellerTaxId)) {
    throw new ValidationError('Tenant.taxId 未設定或格式錯誤（請至「公司資料」填 8 碼統編）');
  }

  const voidDate = new Date();
  const xml = buildF0701({
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    voidDate,
    voidReason: reason.trim(),
    buyer: { identifier: inv.buyerTaxId, name: inv.buyerName },
    seller: { identifier: sellerTaxId, name: tenant.companyName },
  });
  const wrote = await writeNullifyXml({
    inboundDir: einvCfg.turnkeyInboundDir,
    invoiceNo: inv.invoiceNo,
    xml,
  });

  const updated = await prisma.einvoice.update({
    where: { id },
    data: {
      status: 'nullified',
      nullifiedAt: voidDate,
      nullifyReason: reason.trim(),
      nullifyXmlPath: wrote.absolutePath,
      nullifyXmlBody: xml,
    },
  });

  // 註銷後 AR 的 invoiceNo 清空，代表可重開新發票
  if (inv.receivableId) {
    await prisma.accountReceivable.update({
      where: { id: inv.receivableId }, data: { invoiceNo: null },
    }).catch(() => {});
  }

  if (actedBy) {
    await writeAudit({
      tenantId, userId: actedBy,
      action: 'EINVOICE_NULLIFY', entity: 'Einvoice', entityId: id,
      detail: { invoiceNo: inv.invoiceNo, reason: reason.trim(), previousStatus: inv.status },
    });
  }

  return updated;
}

// ----- list / read -----

export async function list(tenantId: string, filters: {
  status?: string; salesOrderId?: string; receivableId?: string;
} = {}) {
  return prisma.einvoice.findMany({
    where: {
      tenantId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.salesOrderId ? { salesOrderId: filters.salesOrderId } : {}),
      ...(filters.receivableId ? { receivableId: filters.receivableId } : {}),
    },
    include: {
      items: { orderBy: { sequence: 'asc' } },
      salesOrder: { select: { id: true, orderNo: true } },
      receivable: { select: { id: true } },
    },
    orderBy: { invoiceDate: 'desc' },
  });
}

export async function getById(tenantId: string, id: string) {
  const row = await prisma.einvoice.findFirst({
    where: { id, tenantId },
    include: {
      items: { orderBy: { sequence: 'asc' } },
      salesOrder: { select: { id: true, orderNo: true } },
      receivable: { select: { id: true } },
    },
  });
  if (!row) throw new NotFoundError('Einvoice', id);
  return row;
}

/**
 * Read the raw F0401 / F0501 / F0701 XML — DB 內容（項 11 二份備份）優先，
 * fallback 到 turnkey 目錄。
 */
export async function readXml(
  tenantId: string,
  id: string,
  kind: 'issue' | 'void' | 'nullify',
): Promise<string | null> {
  const row = await prisma.einvoice.findFirst({ where: { id, tenantId } });
  if (!row) throw new NotFoundError('Einvoice', id);
  const body = kind === 'issue' ? row.xmlBody
    : kind === 'void' ? row.voidXmlBody
    : row.nullifyXmlBody;
  if (body) return body;
  const p = kind === 'issue' ? row.xmlPath
    : kind === 'void' ? row.voidXmlPath
    : row.nullifyXmlPath;
  if (!p) return null;
  const { promises: fs } = await import('node:fs');
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

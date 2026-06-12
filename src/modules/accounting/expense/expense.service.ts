/**
 * 快速費用登記 + 零用金調撥服務。
 *
 * Phase A 抽象：給 ADMIN/ACCOUNTING 一個簡化 UI 取代手填傳票。
 * 後端在這層自動產出借貸平衡的 JournalEntry，使用者不需懂科目代碼。
 *
 * 兩種動作：
 *  1. quickExpense — 一般費用支出
 *     依「用途說明」自動判斷費用科目（關鍵字規則表 EXPENSE_KEYWORDS）。
 *     付款方式三選一：現金 (1101) / 銀行存款 (1111) / 應付帳款 (2101)。
 *     產 JE：Dr <費用科目> / Cr <付款帳戶>
 *     同時自動填入稅務扣抵欄位（依 TAX_RULES）。
 *
 *  2. pettyCashTransfer — 零用金調撥
 *     direction='withdraw'：從銀行提領補充零用金 → Dr 1101 現金 / Cr 1111 銀行
 *     direction='deposit'：零用金繳回銀行 → Dr 1111 銀行 / Cr 1101 現金
 *
 * ── 稅務扣抵規則（台灣稅法）──────────────────────────────────────────────────
 *  vatDeductType:
 *    'deductible'     — 進項稅額可全額扣抵（水電/文具/郵電/租金有統一發票）
 *    'non_deductible' — 進項稅額不可扣抵（交際費、個人費用）
 *    'withholding'    — 需代扣繳稅款（薪資5%、自然人租金10%）
 *    'review'         — 需人工審核（計程車收據 vs ETC、雜項）
 *
 *  含稅金額（amount）計算邏輯：
 *    進項稅額 = amount × 5 / 105（內含稅5%）
 *    扣繳稅額 = amount × withholdingRate（外加稅，直接對全額）
 */
import { ValidationError, NotFoundError } from '../../../shared/errors.js';
import * as coaService from '../coa/coa.service.js';
import * as journalService from '../journal/journal.service.js';

// ─────────────────────────────────────────────────────────────
// 稅務扣抵規則表（台灣稅法）
// ─────────────────────────────────────────────────────────────

/** 稅務扣抵類型 */
export type VatDeductType = 'deductible' | 'non_deductible' | 'withholding' | 'review';

/** 各費用科目對應的稅務規則 */
export interface TaxRule {
  vatDeductType: VatDeductType;
  /** 扣繳稅率（0~1），0=不需扣繳 */
  withholdingRate: number;
  /** 給會計師的說明 */
  note: string;
}

/**
 * 費用科目代碼 → 稅務規則。
 * 規則依台灣《加值型及非加值型營業稅法》及《所得稅法》第88條。
 */
export const TAX_RULES: Record<string, TaxRule> = {
  '6101': {
    vatDeductType: 'withholding',
    withholdingRate: 0.05,
    note: '薪資所得：月薪 ≤ 88,501 免扣繳；超過依稅率表；需申報各類所得扣繳憑單（50A）',
  },
  '6201': {
    vatDeductType: 'deductible',
    withholdingRate: 0,
    note: '租金：承租自營利事業且有統一發票→進項可扣抵；自然人出租→不發票但須代扣繳10%（另計）',
  },
  '6211': {
    vatDeductType: 'deductible',
    withholdingRate: 0,
    note: '水電瓦斯：台電/台水/瓦斯公司帳單即為合法進項憑證，5%進項可扣抵',
  },
  '6221': {
    vatDeductType: 'deductible',
    withholdingRate: 0,
    note: '文具用品：需收集統一發票，5%進項可扣抵；三聯式發票填公司統編始有效',
  },
  '6231': {
    vatDeductType: 'review',
    withholdingRate: 0,
    note: '交通：ETC扣款/高鐵電子票/台鐵電子票→進項可扣抵；計程車手寫收據→不可扣抵；請逐筆審核',
  },
  '6241': {
    vatDeductType: 'deductible',
    withholdingRate: 0,
    note: '郵電通訊：中華電信/遠傳等帳單為合法進項，5%進項可扣抵',
  },
  '6291': {
    vatDeductType: 'review',
    withholdingRate: 0,
    note: '雜項：交際費進項不可扣抵且有上限（收入0.625% vs 費用1%取低）；其餘需人工判斷',
  },
};

/**
 * 依金額與稅務規則計算各稅務欄位。
 * amount 為「含稅」金額（客戶付出的總額，5%稅內含）。
 */
export function calcTaxDeduction(amount: number, rule: TaxRule): {
  vatDeductType: VatDeductType;
  vatInputAmount: number;
  deductibleVat: number;
  withholdingTax: number;
} {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  if (rule.vatDeductType === 'deductible') {
    const vat = round2(amount * 5 / 105);
    return { vatDeductType: 'deductible', vatInputAmount: vat, deductibleVat: vat, withholdingTax: 0 };
  }
  if (rule.vatDeductType === 'withholding') {
    const wht = round2(amount * rule.withholdingRate);
    return { vatDeductType: 'withholding', vatInputAmount: 0, deductibleVat: 0, withholdingTax: wht };
  }
  if (rule.vatDeductType === 'non_deductible') {
    return { vatDeductType: 'non_deductible', vatInputAmount: 0, deductibleVat: 0, withholdingTax: 0 };
  }
  // review
  return { vatDeductType: 'review', vatInputAmount: 0, deductibleVat: 0, withholdingTax: 0 };
}

/**
 * 給前端用的稅務規則說明（含 label）。
 */
export function getTaxRules(): Array<{ code: string; label: string; vatDeductType: VatDeductType; note: string }> {
  const labelMap: Record<string, string> = {
    '6101': '薪資費用', '6201': '租金', '6211': '水電瓦斯',
    '6221': '文具', '6231': '交通', '6241': '郵電', '6291': '雜項',
  };
  return Object.entries(TAX_RULES).map(([code, r]) => ({
    code, label: labelMap[code] ?? code, vatDeductType: r.vatDeductType, note: r.note,
  }));
}

// ─────────────────────────────────────────────────────────────

/**
 * 費用關鍵字 → 科目代碼映射表。
 * 順序由具體到泛用：先匹配的優先。
 *
 * 預設科目對照（src/modules/accounting/coa/default-coa-template.ts）：
 *  6101 薪資費用 / 6201 租金 / 6211 水電瓦斯 / 6221 文具
 *  6231 交通 / 6241 郵電 / 6291 雜項
 */
const EXPENSE_KEYWORDS: Array<{ keywords: string[]; code: string; label: string }> = [
  { code: '6101', label: '薪資費用',
    keywords: ['薪資', '薪水', '工資', '加班費', '獎金', '年終', '勞報', '兼職費', '時薪'] },
  { code: '6201', label: '租金',
    keywords: ['租金', '房租', '辦公室租', '倉庫租', '停車位月租'] },
  { code: '6211', label: '水電瓦斯',
    keywords: ['電費', '水費', '瓦斯', '水電', '電力', '台電', '自來水'] },
  { code: '6221', label: '文具',
    keywords: ['文具', '紙張', '影印紙', '印表機', '碳粉', '墨水匣', '原子筆', '釘書機', 'A4'] },
  { code: '6231', label: '交通',
    keywords: ['計程車', '油錢', '加油', '高鐵', '台鐵', '火車', '公車', '捷運', '停車費', '過路費', 'ETC', '機票', 'Uber', '叫車'] },
  { code: '6241', label: '郵電',
    keywords: ['郵資', '郵票', '快遞', '宅急便', '電話費', '手機費', '網路費', '寬頻', '中華電信', 'ADSL', '光纖'] },
];

/**
 * 由「用途說明」推論費用科目。命中關鍵字回對應 code，皆無命中回 6291 雜項。
 * 若該 code 在此 tenant 不存在或停用，fallback 到 6291；連 6291 都沒有則 throw。
 */
export async function inferExpenseAccount(tenantId: string, description: string): Promise<{
  code: string; name: string; id: string; matchedKeyword?: string;
}> {
  const desc = description || '';
  let matchedCode = '6291';
  let matchedKeyword: string | undefined;
  for (const r of EXPENSE_KEYWORDS) {
    const hit = r.keywords.find((k) => desc.includes(k));
    if (hit) {
      matchedCode = r.code;
      matchedKeyword = hit;
      break;
    }
  }
  let acct = await coaService.getByCode(tenantId, matchedCode);
  if (!acct || !acct.isActive) {
    acct = await coaService.getByCode(tenantId, '6291');
    matchedKeyword = undefined;
  }
  if (!acct) {
    throw new ValidationError('找不到費用科目（請確認會計模組已啟用 + 6291 雜項已建立）');
  }
  return { code: acct.code, name: acct.name, id: acct.id, matchedKeyword };
}

export interface QuickExpenseInput {
  date: Date;
  description: string;
  amount: number;
  /** cash=庫存現金 (1101) / bank=銀行存款 (1111) / payable=應付帳款 (2101) */
  paymentMethod: 'cash' | 'bank' | 'payable';
  /** 若指定，覆蓋自動推論結果（手動選科目）。 */
  expenseAccountId?: string;
  /** 收據/憑證號，寫入 JournalEntry.sourceId */
  voucherNo?: string;
  /** 預設 'pending'；ADMIN 可選 'posted' 直接過帳 */
  status?: 'pending' | 'posted';
}

const PAYMENT_CODE: Record<QuickExpenseInput['paymentMethod'], string> = {
  cash: '1101',
  bank: '1111',
  payable: '2101',
};

export async function quickExpense(
  tenantId: string,
  createdBy: string | null,
  input: QuickExpenseInput,
) {
  if (!input.description?.trim()) throw new ValidationError('請填寫用途說明');
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('金額需大於 0');
  }
  if (!PAYMENT_CODE[input.paymentMethod]) {
    throw new ValidationError(`付款方式不合法：${input.paymentMethod}`);
  }

  // 1. 費用科目（手動 override 或自動推論）
  let expenseAcct: { id: string; code: string; name: string; matchedKeyword?: string };
  if (input.expenseAccountId) {
    const a = await coaService.getById(tenantId, input.expenseAccountId);
    if (!a.isActive) throw new ValidationError(`科目 ${a.code} ${a.name} 已停用`);
    if (a.type !== 'expense' && a.type !== 'cost') {
      throw new ValidationError(`科目 ${a.code} ${a.name} 不是費用/成本類，無法用快速登記`);
    }
    expenseAcct = { id: a.id, code: a.code, name: a.name };
  } else {
    expenseAcct = await inferExpenseAccount(tenantId, input.description);
  }

  // 2. 付款帳戶
  const paymentCode = PAYMENT_CODE[input.paymentMethod];
  const paymentAcct = await coaService.getByCode(tenantId, paymentCode);
  if (!paymentAcct) {
    throw new NotFoundError(`找不到付款帳戶 ${paymentCode}（請確認會計模組已啟用）`);
  }

  // 3. 計算稅務扣抵
  const taxRule = TAX_RULES[expenseAcct.code];
  const taxCalc = taxRule
    ? calcTaxDeduction(input.amount, taxRule)
    : { vatDeductType: 'review' as VatDeductType, vatInputAmount: 0, deductibleVat: 0, withholdingTax: 0 };

  // 4. 產 JE：Dr 費用 / Cr 付款帳戶，附稅務欄位
  const entry = await journalService.create(tenantId, createdBy, {
    entryDate: input.date,
    description: input.description.trim(),
    source: 'expense',
    sourceId: input.voucherNo?.trim() || null,
    status: input.status === 'posted' ? 'posted' : 'pending',
    vatDeductType: taxCalc.vatDeductType,
    vatInputAmount: taxCalc.vatInputAmount,
    deductibleVat: taxCalc.deductibleVat,
    withholdingTax: taxCalc.withholdingTax,
    lines: [
      { accountId: expenseAcct.id, debit: input.amount, description: input.description.trim() },
      { accountId: paymentAcct.id, credit: input.amount, description: input.description.trim() },
    ],
  });

  return {
    entry,
    inferred: {
      expenseCode: expenseAcct.code,
      expenseName: expenseAcct.name,
      matchedKeyword: expenseAcct.matchedKeyword ?? null,
      paymentCode: paymentAcct.code,
      paymentName: paymentAcct.name,
    },
    tax: {
      vatDeductType: taxCalc.vatDeductType,
      vatInputAmount: taxCalc.vatInputAmount,
      deductibleVat: taxCalc.deductibleVat,
      withholdingTax: taxCalc.withholdingTax,
      note: taxRule?.note ?? '未知科目，請人工審核',
    },
  };
}

export interface PettyCashTransferInput {
  date: Date;
  /** withdraw=銀行 → 零用金（提領補充）/ deposit=零用金 → 銀行（繳回） */
  direction: 'withdraw' | 'deposit';
  amount: number;
  description?: string;
}

export async function pettyCashTransfer(
  tenantId: string,
  createdBy: string | null,
  input: PettyCashTransferInput,
) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('金額需大於 0');
  }
  if (input.direction !== 'withdraw' && input.direction !== 'deposit') {
    throw new ValidationError('方向需為 withdraw 或 deposit');
  }
  const cash = await coaService.getByCode(tenantId, '1101');
  const bank = await coaService.getByCode(tenantId, '1111');
  if (!cash || !bank) {
    throw new NotFoundError('找不到 1101 現金 或 1111 銀行存款 科目');
  }

  // withdraw: Dr 現金 / Cr 銀行（從銀行提現補零用金）
  // deposit:  Dr 銀行 / Cr 現金（零用金繳回銀行）
  const lines = input.direction === 'withdraw'
    ? [
      { accountId: cash.id, debit: input.amount, description: '零用金撥補' },
      { accountId: bank.id, credit: input.amount, description: '零用金撥補' },
    ]
    : [
      { accountId: bank.id, debit: input.amount, description: '零用金繳回' },
      { accountId: cash.id, credit: input.amount, description: '零用金繳回' },
    ];

  const desc = input.description?.trim()
    || (input.direction === 'withdraw' ? '零用金撥補' : '零用金繳回');

  const entry = await journalService.create(tenantId, createdBy, {
    entryDate: input.date,
    description: desc,
    source: 'petty_cash',
    sourceId: null,
    status: 'posted',
    lines,
  });

  return { entry };
}

/**
 * 給前端 live preview 用：傳描述回推測科目 + 稅務規則，不建立任何資料。
 */
export async function previewExpenseAccount(tenantId: string, description: string) {
  const acct = await inferExpenseAccount(tenantId, description);
  const taxRule = TAX_RULES[acct.code];
  return {
    ...acct,
    vatDeductType: taxRule?.vatDeductType ?? 'review',
    taxNote: taxRule?.note ?? '未知科目，請人工審核',
  };
}

/** 公開鎖定的關鍵字規則（給前端 UI hint 顯示，使用者不可改）。 */
export function getExpenseRules() {
  return EXPENSE_KEYWORDS.map((r) => ({
    code: r.code,
    label: r.label,
    keywords: r.keywords,
    vatDeductType: TAX_RULES[r.code]?.vatDeductType ?? 'review',
    taxNote: TAX_RULES[r.code]?.note ?? '',
  }));
}

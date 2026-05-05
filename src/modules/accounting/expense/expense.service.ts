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
 *
 *  2. pettyCashTransfer — 零用金調撥
 *     direction='withdraw'：從銀行提領補充零用金 → Dr 1101 現金 / Cr 1111 銀行
 *     direction='deposit'：零用金繳回銀行 → Dr 1111 銀行 / Cr 1101 現金
 */
import { ValidationError, NotFoundError } from '../../../shared/errors.js';
import * as coaService from '../coa/coa.service.js';
import * as journalService from '../journal/journal.service.js';

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

  // 3. 產 JE：Dr 費用 / Cr 付款帳戶
  const entry = await journalService.create(tenantId, createdBy, {
    entryDate: input.date,
    description: input.description.trim(),
    source: 'expense',
    sourceId: input.voucherNo?.trim() || null,
    status: input.status === 'posted' ? 'posted' : 'pending',
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
    // 零用金調撥屬資金內部移轉，直接過帳（無爭議性）
    status: 'posted',
    lines,
  });

  return { entry };
}

/** 給前端 live preview 用：傳描述回推測科目，不建立任何資料。 */
export async function previewExpenseAccount(tenantId: string, description: string) {
  return inferExpenseAccount(tenantId, description);
}

/** 公開鎖定的關鍵字規則（給前端 UI hint 顯示，使用者不可改）。 */
export function getExpenseRules() {
  return EXPENSE_KEYWORDS.map((r) => ({ code: r.code, label: r.label, keywords: r.keywords }));
}

/**
 * Phase A 預設科目範本（台灣中小企業常用 ~30 個）。
 * 啟用會計模組時種子到 ChartOfAccount。
 *
 * 命名遵循商業會計法第 27 條與一般公認會計原則：
 *  - 1xxx 資產（debit normal）
 *  - 2xxx 負債（credit normal）
 *  - 3xxx 權益（credit normal）
 *  - 4xxx 收入（credit normal）
 *  - 5xxx 成本（debit normal）
 *  - 6xxx 費用（debit normal）
 */
export interface CoaTemplateRow {
  code: string;
  name: string;
  level: number;
  parent?: string; // parent code
  type: 'asset' | 'liability' | 'equity' | 'income' | 'cost' | 'expense';
  normalSide: 'debit' | 'credit';
  isSystem: boolean;
  description?: string;
}

export const DEFAULT_COA: CoaTemplateRow[] = [
  // ===== 資產 =====
  { code: '1000', name: '資產', level: 1, type: 'asset', normalSide: 'debit', isSystem: true },
  { code: '1101', name: '現金', level: 2, parent: '1000', type: 'asset', normalSide: 'debit', isSystem: true },
  { code: '1102', name: '零用金', level: 2, parent: '1000', type: 'asset', normalSide: 'debit', isSystem: false },
  { code: '1111', name: '銀行存款', level: 2, parent: '1000', type: 'asset', normalSide: 'debit', isSystem: true },
  { code: '1131', name: '應收帳款', level: 2, parent: '1000', type: 'asset', normalSide: 'debit', isSystem: true,
    description: '銷貨開單時自動借記' },
  { code: '1139', name: '備抵呆帳', level: 2, parent: '1000', type: 'asset', normalSide: 'credit', isSystem: false,
    description: '應收帳款的減項（貸方正常）' },
  { code: '1141', name: '應收票據', level: 2, parent: '1000', type: 'asset', normalSide: 'debit', isSystem: false },
  { code: '1411', name: '存貨', level: 2, parent: '1000', type: 'asset', normalSide: 'debit', isSystem: false },

  // ===== 負債 =====
  { code: '2000', name: '負債', level: 1, type: 'liability', normalSide: 'credit', isSystem: true },
  { code: '2101', name: '應付帳款', level: 2, parent: '2000', type: 'liability', normalSide: 'credit', isSystem: true,
    description: '進貨開單時自動貸記' },
  { code: '2102', name: '應付票據', level: 2, parent: '2000', type: 'liability', normalSide: 'credit', isSystem: false },
  { code: '2107', name: '預收貨款', level: 2, parent: '2000', type: 'liability', normalSide: 'credit', isSystem: false },
  { code: '2121', name: '應付薪資', level: 2, parent: '2000', type: 'liability', normalSide: 'credit', isSystem: false },
  { code: '2131', name: '銷項稅額', level: 2, parent: '2000', type: 'liability', normalSide: 'credit', isSystem: true,
    description: '銷貨營業稅，月底沖轉應付營業稅' },
  { code: '2132', name: '進項稅額', level: 2, parent: '2000', type: 'liability', normalSide: 'debit', isSystem: true,
    description: '進貨營業稅，貸方科目但餘額為借方' },
  { code: '2133', name: '應付營業稅', level: 2, parent: '2000', type: 'liability', normalSide: 'credit', isSystem: false },

  // ===== 權益 =====
  { code: '3000', name: '權益', level: 1, type: 'equity', normalSide: 'credit', isSystem: true },
  { code: '3101', name: '業主資本', level: 2, parent: '3000', type: 'equity', normalSide: 'credit', isSystem: true,
    description: '期初開帳對方科目' },
  { code: '3201', name: '本期損益', level: 2, parent: '3000', type: 'equity', normalSide: 'credit', isSystem: true },
  { code: '3211', name: '累積盈虧', level: 2, parent: '3000', type: 'equity', normalSide: 'credit', isSystem: true },

  // ===== 收入 =====
  { code: '4000', name: '收入', level: 1, type: 'income', normalSide: 'credit', isSystem: true },
  { code: '4101', name: '銷貨收入', level: 2, parent: '4000', type: 'income', normalSide: 'credit', isSystem: true,
    description: '銷貨開單時自動貸記' },
  { code: '4111', name: '銷貨退回', level: 2, parent: '4000', type: 'income', normalSide: 'debit', isSystem: false,
    description: '銷貨收入的減項（借方）' },
  { code: '4121', name: '銷貨折讓', level: 2, parent: '4000', type: 'income', normalSide: 'debit', isSystem: false },

  // ===== 成本 =====
  { code: '5000', name: '銷貨成本', level: 1, type: 'cost', normalSide: 'debit', isSystem: true },
  { code: '5101', name: '進貨', level: 2, parent: '5000', type: 'cost', normalSide: 'debit', isSystem: true,
    description: '進貨開單時自動借記（無存貨制）' },
  { code: '5121', name: '進貨退出', level: 2, parent: '5000', type: 'cost', normalSide: 'credit', isSystem: false },
  { code: '5201', name: '銷貨成本', level: 2, parent: '5000', type: 'cost', normalSide: 'debit', isSystem: false },

  // ===== 費用 =====
  { code: '6000', name: '營業費用', level: 1, type: 'expense', normalSide: 'debit', isSystem: true },
  { code: '6101', name: '薪資費用', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
  { code: '6201', name: '租金費用', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
  { code: '6211', name: '水電瓦斯', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
  { code: '6221', name: '文具用品', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
  { code: '6231', name: '交通費', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
  { code: '6241', name: '郵電費', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
  { code: '6291', name: '雜項費用', level: 2, parent: '6000', type: 'expense', normalSide: 'debit', isSystem: false },
];

/** 系統科目 code 對照（自動分錄會用到，保留 reference） */
export const SYSTEM_ACCOUNT_CODES = {
  CASH: '1101',
  BANK: '1111',
  AR: '1131',
  INVENTORY: '1411',
  AP: '2101',
  TAX_OUTPUT: '2131',
  TAX_INPUT: '2132',
  CAPITAL: '3101',
  PERIOD_INCOME: '3201',
  RETAINED_EARNINGS: '3211',
  SALES_REVENUE: '4101',
  PURCHASES: '5101',
} as const;

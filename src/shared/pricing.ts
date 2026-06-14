export const PRODUCT_CATEGORIES = [
  'PART',
  'NEW_MACHINE',
  'USED_MACHINE',
  'SERVICE',
  'OTHER',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_LABEL: Record<string, string> = {
  PART: '零件',
  NEW_MACHINE: '新機',
  USED_MACHINE: '二手機',
  SERVICE: '服務/工時',
  OTHER: '其他',
};

export const PRICE_TIER_DISCOUNT: Record<number, number> = {
  1: 1.0,
  2: 0.9,
  3: 0.8,
  4: 0.7,
  5: 0.6,
};

export const PRICE_TIER_LABEL: Record<number, string> = {
  1: '一般',
  2: '常客',
  3: '熟客',
  4: '職業客戶',
  5: '五金客戶',
};

export function applyTierDiscount(listPrice: number, tier: number): number {
  const rate = PRICE_TIER_DISCOUNT[tier] ?? 1.0;
  return Math.round(listPrice * rate);
}

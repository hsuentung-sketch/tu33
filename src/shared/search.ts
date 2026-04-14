import { prisma } from './prisma.js';

/**
 * Fuzzy search using PostgreSQL pg_trgm extension.
 * Searches across customers, products, and suppliers.
 */
export async function fuzzySearch(
  tenantId: string,
  query: string,
  options: { types?: Array<'customer' | 'product' | 'supplier'>; limit?: number } = {},
) {
  const { types = ['customer', 'product', 'supplier'], limit = 10 } = options;
  const results: Array<{ type: string; id: string; name: string; detail?: string }> = [];

  if (types.includes('customer')) {
    const customers = await prisma.$queryRaw<Array<{ id: string; name: string; contact_name: string | null }>>`
      SELECT id, name, "contactName" as contact_name
      FROM "Customer"
      WHERE "tenantId" = ${tenantId}
        AND "isActive" = true
        AND (name % ${query} OR name ILIKE ${'%' + query + '%'})
      ORDER BY similarity(name, ${query}) DESC
      LIMIT ${limit}
    `;
    for (const c of customers) {
      results.push({ type: 'customer', id: c.id, name: c.name, detail: c.contact_name || undefined });
    }
  }

  if (types.includes('product')) {
    const products = await prisma.$queryRaw<Array<{ id: string; name: string; category: string | null }>>`
      SELECT id, name, category
      FROM "Product"
      WHERE "tenantId" = ${tenantId}
        AND "isActive" = true
        AND (name % ${query} OR name ILIKE ${'%' + query + '%'} OR code ILIKE ${'%' + query + '%'})
      ORDER BY similarity(name, ${query}) DESC
      LIMIT ${limit}
    `;
    for (const p of products) {
      results.push({ type: 'product', id: p.id, name: p.name, detail: p.category || undefined });
    }
  }

  if (types.includes('supplier')) {
    const suppliers = await prisma.$queryRaw<Array<{ id: string; name: string; type: string | null }>>`
      SELECT id, name, type
      FROM "Supplier"
      WHERE "tenantId" = ${tenantId}
        AND "isActive" = true
        AND (name % ${query} OR name ILIKE ${'%' + query + '%'})
      ORDER BY similarity(name, ${query}) DESC
      LIMIT ${limit}
    `;
    for (const s of suppliers) {
      results.push({ type: 'supplier', id: s.id, name: s.name, detail: s.type || undefined });
    }
  }

  return results;
}

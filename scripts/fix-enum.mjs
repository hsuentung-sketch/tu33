import 'dotenv/config';
import pg from 'pg';
const c = new pg.Client(process.env.DATABASE_URL);
await c.connect();
const r = await c.query(`UPDATE "InventoryTransaction" SET reason='ADJUSTMENT' WHERE reason='REFURBISH_OUT'`);
console.log(`Updated ${r.rowCount} rows`);
await c.end();

import 'dotenv/config';
import pg from 'pg';

async function main() {
  // Check both DATABASE_URL (runtime) and DIRECT_URL (CLI) connections
  const urls: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  };

  for (const [name, url] of Object.entries(urls)) {
    if (!url) { console.log(`${name}: not set`); continue; }
    console.log(`\n--- ${name} (host: ${new URL(url).hostname}) ---`);
    const client = new pg.Client(url);
    await client.connect();
    for (const t of ['Customer', 'Product']) {
      const r = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position',
        [t],
      );
      console.log(`${t}: ${r.rows.map((x: any) => x.column_name).join(', ')}`);
    }
    await client.end();
  }
}
main();

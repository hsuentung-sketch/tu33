/**
 * Set up a Rich Menu for a given tenant.
 *
 * Usage:
 *   npx tsx src/tools/setup-rich-menu.ts <tenantId> [imagePath]
 *
 * The tenant must already have lineAccessToken in the DB.
 * imagePath is optional — if omitted, a 2500x1686 solid-color PNG is generated on the fly.
 * For production, design a proper image (2500x1686 or 2500x843) and pass its path.
 *
 * Layout (2x3 grid on 2500x1686):
 *   ┌─────────┬─────────┬─────────┐
 *   │ 報價    │ 銷貨    │ 進貨    │
 *   ├─────────┼─────────┼─────────┤
 *   │ 帳務    │ 查詢    │ 管理    │
 *   └─────────┴─────────┴─────────┘
 */
import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../shared/prisma.js';
import { logger } from '../shared/logger.js';

interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: { type: 'postback'; data: string; displayText?: string };
}

const WIDTH = 2500;
const HEIGHT = 1686;
const COL_W = Math.floor(WIDTH / 3);
const ROW_H = Math.floor(HEIGHT / 2);

const AREAS: RichMenuArea[] = [
  { bounds: { x: 0, y: 0, width: COL_W, height: ROW_H }, action: { type: 'postback', data: 'action=quotation:menu', displayText: '報價' } },
  { bounds: { x: COL_W, y: 0, width: COL_W, height: ROW_H }, action: { type: 'postback', data: 'action=sales:menu', displayText: '銷貨' } },
  { bounds: { x: COL_W * 2, y: 0, width: WIDTH - COL_W * 2, height: ROW_H }, action: { type: 'postback', data: 'action=purchase:menu', displayText: '進貨' } },
  { bounds: { x: 0, y: ROW_H, width: COL_W, height: HEIGHT - ROW_H }, action: { type: 'postback', data: 'action=accounting:menu', displayText: '帳務' } },
  { bounds: { x: COL_W, y: ROW_H, width: COL_W, height: HEIGHT - ROW_H }, action: { type: 'postback', data: 'action=master:search&q=', displayText: '查詢' } },
  { bounds: { x: COL_W * 2, y: ROW_H, width: WIDTH - COL_W * 2, height: HEIGHT - ROW_H }, action: { type: 'postback', data: 'action=management:menu', displayText: '管理' } },
];

const MENU_DEFINITION = {
  size: { width: WIDTH, height: HEIGHT },
  selected: true,
  name: 'ERP Main Menu',
  chatBarText: 'ERP 選單',
  areas: AREAS,
};

async function fetchLine(path: string, token: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.line.me${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`LINE API ${path} ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Minimal PNG placeholder (1x1 gray, stretched by LINE).
 * Replace with a real designed image for production.
 */
function generatePlaceholderPng(): Buffer {
  // Pre-baked 1x1 gray PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

async function main() {
  const [tenantId, imagePath] = process.argv.slice(2);
  if (!tenantId) {
    console.error('Usage: tsx src/tools/setup-rich-menu.ts <tenantId> [imagePath]');
    process.exit(1);
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.lineAccessToken) {
    console.error(`Tenant ${tenantId} has no lineAccessToken configured.`);
    process.exit(1);
  }
  const token = tenant.lineAccessToken;

  logger.info('Creating rich menu', { tenantId });
  const created = await fetchLine('/v2/bot/richmenu', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(MENU_DEFINITION),
  });
  const richMenuId = created.richMenuId as string;
  logger.info('Rich menu created', { richMenuId });

  let imageBuffer: Buffer;
  let contentType = 'image/png';
  if (imagePath) {
    imageBuffer = await readFile(imagePath);
    if (imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    }
  } else {
    logger.warn('No image path given — uploading 1x1 placeholder. Replace with a real design.');
    imageBuffer = generatePlaceholderPng();
  }

  // LINE requires image upload via api-data.line.me, not api.line.me.
  const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: new Uint8Array(imageBuffer),
  });
  if (!uploadRes.ok) {
    throw new Error(`Rich menu image upload failed ${uploadRes.status}: ${await uploadRes.text()}`);
  }
  logger.info('Rich menu image uploaded');

  // Set as default for all users of this bot.
  await fetchLine(`/v2/bot/user/all/richmenu/${richMenuId}`, token, { method: 'POST' });
  logger.info('Rich menu set as default for all users', { richMenuId });

  // Write the id to a sidecar file so you can delete/update later.
  const sidecar = join(tmpdir(), `richmenu-${tenantId}.json`);
  await writeFile(sidecar, JSON.stringify({ tenantId, richMenuId, createdAt: new Date().toISOString() }, null, 2));
  console.log(`\n✅ Rich menu deployed.\n   richMenuId: ${richMenuId}\n   sidecar: ${sidecar}\n`);
}

main()
  .catch((err) => {
    logger.error('setup-rich-menu failed', { error: err });
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

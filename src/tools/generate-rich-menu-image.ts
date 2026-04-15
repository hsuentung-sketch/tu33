/**
 * Generate a 2500x1686 PNG suitable for LINE Rich Menu (2x3 grid).
 *
 * Usage:
 *   npx tsx src/tools/generate-rich-menu-image.ts [outputPath]
 *
 * Default outputPath: ./public/rich-menu.png
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const WIDTH = 2500;
const HEIGHT = 1686;
const COL_W = Math.floor(WIDTH / 3);
const ROW_H = Math.floor(HEIGHT / 2);

interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub: string;
  fill: string;
  fontSize?: number;
}

const DEFAULT_FONT = 240;

const CELLS: Cell[] = [
  { x: 0,         y: 0,     w: COL_W,             h: ROW_H,             label: '報價',     sub: 'Quotation',  fill: '#2E7D32' },
  { x: COL_W,     y: 0,     w: COL_W,             h: ROW_H,             label: '銷貨',     sub: 'Sales',      fill: '#1565C0' },
  { x: COL_W * 2, y: 0,     w: WIDTH - COL_W * 2, h: ROW_H,             label: '進貨',     sub: 'Purchase',   fill: '#6A1B9A' },
  { x: 0,         y: ROW_H, w: COL_W,             h: HEIGHT - ROW_H,    label: '帳務',     sub: 'Accounting', fill: '#E65100' },
  { x: COL_W,     y: ROW_H, w: COL_W,             h: HEIGHT - ROW_H,    label: '查詢',     sub: 'Search',     fill: '#00838F' },
  { x: COL_W * 2, y: ROW_H, w: WIDTH - COL_W * 2, h: HEIGHT - ROW_H,    label: '管理',     sub: 'Manage',     fill: '#AD1457' },
];

function buildSvg(): string {
  const rects = CELLS.map((c) => {
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    return `
      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${c.fill}" />
      <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="white" stroke-width="8" />
      <text x="${cx}" y="${cy - 30}"
            font-family="Microsoft JhengHei, PingFang TC, Noto Sans TC, sans-serif"
            font-size="${c.fontSize ?? DEFAULT_FONT}" font-weight="bold"
            text-anchor="middle" dominant-baseline="middle"
            fill="white">${c.label}</text>
      <text x="${cx}" y="${cy + 160}"
            font-family="Arial, sans-serif"
            font-size="80"
            text-anchor="middle" dominant-baseline="middle"
            fill="white" fill-opacity="0.85">${c.sub}</text>
    `;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#FAFAFA" />
  ${rects}
</svg>`;
}

async function main() {
  const outputPath = resolve(process.argv[2] ?? './public/rich-menu.png');
  await mkdir(dirname(outputPath), { recursive: true });

  const svg = buildSvg();
  const png = await sharp(Buffer.from(svg, 'utf-8')).png().toBuffer();
  await writeFile(outputPath, png);

  console.log(`Generated rich menu image: ${outputPath}`);
  console.log(`Size: ${WIDTH} x ${HEIGHT} (${png.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

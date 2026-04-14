#!/usr/bin/env node
/**
 * Download NotoSansTC-Regular.otf (Apache-2.0 licensed) to assets/fonts/
 * so the PDF generator can render Traditional Chinese on hosts that do
 * not have a CJK system font installed (e.g. Render's default Linux).
 *
 * Runs as part of the Render build step. No-op if the file already exists.
 */
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const DEST_DIR = resolve(process.cwd(), 'assets/fonts');
const DEST = resolve(DEST_DIR, 'NotoSansTC-Regular.otf');
const URL = 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/TraditionalChinese/NotoSansTC-Regular.otf';

async function main() {
  if (existsSync(DEST)) {
    console.log(`[fonts] already present: ${DEST}`);
    return;
  }
  mkdirSync(DEST_DIR, { recursive: true });
  console.log(`[fonts] downloading ${URL}`);
  const res = await fetch(URL);
  if (!res.ok || !res.body) {
    throw new Error(`Font download failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(DEST));
  console.log(`[fonts] saved to ${DEST}`);
}

main().catch((err) => {
  // Don't break the build if the font host is unreachable — PDF will
  // fall back to Helvetica (tofu boxes for CJK).
  console.warn(`[fonts] skipped: ${err.message}`);
  process.exit(0);
});

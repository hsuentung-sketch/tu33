#!/usr/bin/env node
/**
 * Download NotoSansTC-Regular.otf (SIL OFL-1.1) to assets/fonts/ so the
 * PDF generator can render Traditional Chinese on hosts without a CJK
 * system font (e.g. Render's default Linux container).
 *
 * Why jsDelivr and not raw.githubusercontent.com:
 *   notofonts/noto-cjk stores the OTF via Git LFS. raw.githubusercontent
 *   serves the LFS pointer (a ~130-byte text stub), not the real file,
 *   so the download "succeeds" but PDFKit can't load it. jsDelivr
 *   transparently resolves LFS pointers to the actual binary.
 *
 * We verify the downloaded size (>1 MB) before trusting it — an LFS
 * stub or an HTML error page would be tiny and must fail loudly.
 */
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const DEST_DIR = resolve(process.cwd(), 'assets/fonts');
// TTF from google/fonts — a regular (non-LFS) ~12 MB variable-weight TTF.
// Filename encodes the [wght] axis; PDFKit treats it as a normal TTF.
const DEST = resolve(DEST_DIR, 'NotoSansTC-Regular.ttf');
const URLS = [
  'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf',
];
const MIN_BYTES = 1_000_000; // real file is ~10 MB; LFS pointer is ~130 B

async function tryDownload(url) {
  console.log(`[fonts] fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  await pipeline(res.body, createWriteStream(DEST));
  const size = statSync(DEST).size;
  if (size < MIN_BYTES) {
    unlinkSync(DEST);
    throw new Error(`File too small (${size} bytes) — probably an LFS pointer or error page`);
  }
  console.log(`[fonts] saved ${size} bytes to ${DEST}`);
}

async function main() {
  if (existsSync(DEST) && statSync(DEST).size >= MIN_BYTES) {
    console.log(`[fonts] already present: ${DEST}`);
    return;
  }
  mkdirSync(DEST_DIR, { recursive: true });
  let lastErr;
  for (const url of URLS) {
    try {
      await tryDownload(url);
      return;
    } catch (err) {
      console.warn(`[fonts] ${url} -> ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('no mirrors worked');
}

main().catch((err) => {
  console.error(`[fonts] FAILED: ${err.message}`);
  // Fail the build — a silent fallback produces garbled PDFs (mojibake),
  // which is worse than an obvious deploy failure.
  process.exit(1);
});

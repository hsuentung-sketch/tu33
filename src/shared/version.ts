/**
 * System version info surfaced in the admin console footer.
 *
 * - `version` comes from package.json (bumped manually on releases)
 * - `commit` is the short git SHA. Render injects `RENDER_GIT_COMMIT`;
 *   fall back to GIT_COMMIT env, else "dev" for local
 * - `deployedAt` is the ISO timestamp when the process started
 *   (effectively the deploy time on Render since every deploy restarts)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readPackageVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function shortSha(full: string): string {
  if (!full || full === 'dev') return full || 'dev';
  return full.slice(0, 7);
}

export const VERSION_INFO = {
  version: readPackageVersion(),
  commit: shortSha(process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? 'dev'),
  deployedAt: new Date().toISOString(),
};

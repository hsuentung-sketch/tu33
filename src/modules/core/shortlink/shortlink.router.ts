/**
 * Public short-link resolver — `/s/:code` → 302 redirect to stored target.
 *
 * Mounted BEFORE authMiddleware in src/index.ts so LINE users can tap
 * the short URL straight from a chat without authenticating.
 */
import { Router, type Request, type Response } from 'express';
import { resolveShortLink } from './shortlink.service.js';
import { logger } from '../../../shared/logger.js';

export const shortLinkRouter = Router();

const CODE_RE = /^[A-Z0-9]{4,16}$/;

shortLinkRouter.get('/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  if (!CODE_RE.test(code)) {
    return res.status(400).send('無效的連結代碼');
  }
  try {
    const r = await resolveShortLink(code);
    if (!r) return res.status(404).send('連結不存在');
    if (r.expired) return res.status(410).send('連結已過期');
    if (!r.target) return res.status(500).send('連結目標遺失');
    return res.redirect(302, r.target);
  } catch (err) {
    logger.error('Short link resolve failed', {
      code,
      error: (err as Error).message,
    });
    return res.status(500).send('伺服器錯誤');
  }
});

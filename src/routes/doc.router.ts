/**
 * Public document download routes (v2.16.0+).
 *
 * Replaces the old Supabase-signed-URL flow. Each link carries a JWT
 * produced by signDocToken(). Mounted BEFORE authMiddleware so LINE
 * users can tap the link and download directly.
 *
 * GET /doc/product/:id?token=...   -> streams ProductDocument.fileData
 * GET /doc/supplier/:id?token=...  -> streams SupplierDocument.fileData
 */
import { Router, type Request, type Response } from 'express';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { prisma } from '../shared/prisma.js';
import { verifyDocToken, type DocKind } from '../documents/doc-link.js';
import { getTenantSettings } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

const BANK_DOC_DIR = process.env.BANK_DOC_DIR
  || (existsSync('/data') ? '/data/bank-docs' : resolve(process.cwd(), 'data/bank-docs'));

export const docRouter = Router();

function tokenFor(req: Request): string | null {
  const t = req.query.token;
  return typeof t === 'string' ? t : null;
}

async function streamDoc(req: Request, res: Response) {
  const token = tokenFor(req);
  if (!token) { res.status(401).json({ error: 'Missing token' }); return; }

  const payload = verifyDocToken(token);
  if (!payload) { res.status(401).json({ error: 'Invalid or expired token' }); return; }

  const kind: DocKind = req.params.kind as DocKind;
  if (kind !== payload.k) { res.status(403).json({ error: 'Token/kind mismatch' }); return; }

  const docId = req.params.id;
  if (docId !== payload.i) { res.status(403).json({ error: 'Token/id mismatch' }); return; }

  try {
    let doc: { fileName: string; mimeType: string; fileData: Uint8Array | null; fileSize: number } | null = null;

    if (kind === 'product') {
      doc = await prisma.productDocument.findFirst({
        where: { id: docId, tenantId: payload.t },
        select: { fileName: true, mimeType: true, fileData: true, fileSize: true },
      });
    } else if (kind === 'supplier') {
      doc = await prisma.supplierDocument.findFirst({
        where: { id: docId, tenantId: payload.t },
        select: { fileName: true, mimeType: true, fileData: true, fileSize: true },
      });
    } else if (kind === 'bank-doc') {
      // Bank-doc: file on disk, metadata in tenant settings. docId = 'file'.
      const tenant = await prisma.tenant.findUnique({ where: { id: payload.t } });
      const settings = getTenantSettings(tenant?.settings);
      const meta = (settings as any).bankDoc;
      if (!meta?.hasDoc || !meta.filename) {
        res.status(404).json({ error: 'No bank document uploaded' });
        return;
      }
      const filePath = resolve(BANK_DOC_DIR, `${payload.t}-${meta.filename}`);
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'Bank document file not found' });
        return;
      }
      const buf = await readFile(filePath);
      const ext = meta.filename.split('.').pop()?.toLowerCase();
      const mime = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
      res.end(buf);
      return;
    } else {
      res.status(400).json({ error: 'Unknown document kind' });
      return;
    }

    if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
    if (!doc.fileData) {
      // Legacy row without fileData (uploaded before v2.16.0 migration)
      res.status(410).json({ error: 'File data unavailable (legacy upload — please re-upload)' });
      return;
    }

    const safeName = doc.fileName.replace(/[^\w.\-一-鿿　-〿]/g, '_');
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', doc.fileData.length);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );
    res.end(doc.fileData);
  } catch (err) {
    logger.error('doc download failed', err as Error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed' });
    }
  }
}

docRouter.get('/:kind/:id', streamDoc);

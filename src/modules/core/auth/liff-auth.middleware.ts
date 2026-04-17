import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../shared/prisma.js';
import { UnauthorizedError, ForbiddenError } from '../../../shared/errors.js';
import { getTenantSettings } from '../../../shared/utils.js';
import { runWithAuditContext } from '../../../shared/audit.js';
import { updateRequestContext } from '../../../shared/error-log.js';
import { logger } from '../../../shared/logger.js';

/**
 * LIFF authentication: expects `Authorization: Bearer <LIFF ID token>`.
 * Flow:
 *   1. Decode the JWT payload (unverified) to read `aud` (channel id).
 *   2. Look up the tenant by `lineChannelId = aud`.
 *   3. Call LINE `/oauth2/v2.1/verify` with that channel id to validate
 *      the token's signature + audience + expiry.
 *   4. Resolve the `sub` (LINE userId) to an employee in that tenant.
 */
export async function liffAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const auth = req.header('authorization') ?? '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedError('Missing bearer token');

    const idToken = match[1];
    const unverified = decodeJwtPayload(idToken);
    if (!unverified.aud) throw new UnauthorizedError('Invalid LIFF token (no aud)');

    // LIFF tokens are issued by a LINE Login channel, not the Messaging API
    // channel. We look up tenant by either the messaging channel id (legacy)
    // or the login channel id stored in tenant.settings.lineLoginChannelId.
    const tenant = await prisma.tenant.findFirst({
      where: {
        isActive: true,
        OR: [
          { lineChannelId: unverified.aud },
          { settings: { path: ['lineLoginChannelId'], equals: unverified.aud } },
        ],
      },
    });
    if (!tenant) {
      logger.warn('LIFF auth: no tenant matches aud', { aud: unverified.aud });
      throw new UnauthorizedError(`找不到對應此 LIFF channel 的租戶 (aud=${unverified.aud})`);
    }

    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: unverified.aud }),
    });
    if (!verifyRes.ok) {
      const bodyText = await verifyRes.text().catch(() => '');
      logger.warn('LIFF auth: LINE verify failed', { status: verifyRes.status, body: bodyText.slice(0, 200) });
      throw new UnauthorizedError(`LINE token 驗證失敗 (${verifyRes.status}): ${bodyText.slice(0, 120)}`);
    }

    const payload = (await verifyRes.json()) as { sub?: string };
    if (!payload.sub) throw new UnauthorizedError('LIFF token 無 sub 欄位');

    const employee = await prisma.employee.findFirst({
      where: { tenantId: tenant.id, lineUserId: payload.sub, isActive: true },
    });
    if (!employee) {
      logger.warn('LIFF auth: employee not bound', { tenantId: tenant.id, lineUserId: payload.sub });
      throw new UnauthorizedError(`LINE 使用者 (${payload.sub.slice(0, 8)}…) 未綁定員工帳號`);
    }

    req.tenantId = tenant.id;
    req.employee = {
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      role: employee.role,
      lineUserId: employee.lineUserId,
    };
    req.tenantSettings = getTenantSettings(tenant.settings);

    updateRequestContext({ tenantId: tenant.id, userId: employee.id });
    runWithAuditContext({ tenantId: tenant.id, userId: employee.id }, async () => {
      next();
    }).catch(next);
  } catch (err) {
    next(err);
  }
}

function decodeJwtPayload(token: string): { aud?: string; sub?: string; exp?: number } {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

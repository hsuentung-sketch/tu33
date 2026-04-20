/**
 * Web console auth: email/employeeId + password login, HTTP-only cookie
 * session. Separate from LIFF/LINE-bot auth.
 *
 * Endpoints:
 *   POST /api/auth/web/login   { tenantCompany?, employeeId, password } → 200, Set-Cookie
 *   POST /api/auth/web/logout
 *   GET  /api/auth/web/session
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../shared/prisma.js';
import { UnauthorizedError, ValidationError } from '../../../shared/errors.js';
import { config } from '../../../config/index.js';
import { writeAudit } from '../../../shared/audit.js';
import { tryConsume } from '../../../shared/rate-limit.js';

export const webAuthRouter = Router();

const SESSION_COOKIE = 'ep_session';
const SESSION_TTL_HOURS = 12;

const loginSchema = z.object({
  tenantCompany: z.string().optional(),
  employeeId: z.string().min(1),
  password: z.string().min(1),
});

webAuthRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid payload');
    const { tenantCompany, employeeId, password } = parsed.data;

    // 10 attempts per (IP, employeeId) per 10 minutes. Blocks credential-stuffing
    // and slow password-spraying while leaving honest users room for typos.
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (!tryConsume(`login:${ip}:${employeeId}`, 10, 10 * 60 * 1000)) {
      throw new UnauthorizedError('嘗試次數過多，請 10 分鐘後再試');
    }

    // Narrow to a tenant if the login form provided a hint; otherwise
    // allow single-tenant matches.
    const candidates = await prisma.employee.findMany({
      where: {
        employeeId,
        isActive: true,
        ...(tenantCompany ? { tenant: { companyName: { contains: tenantCompany, mode: 'insensitive' }, isActive: true } } : { tenant: { isActive: true } }),
      },
      include: { tenant: true },
    });
    if (candidates.length === 0) throw new UnauthorizedError('帳號或密碼錯誤');
    // Ambiguous match across tenants → require tenant hint.
    // Deliberately generic to avoid confirming "this employeeId exists in N tenants".
    if (candidates.length > 1) throw new UnauthorizedError('請填寫「公司名稱」欄位以完成登入');

    const emp = candidates[0];
    if (!emp.passwordHash) throw new UnauthorizedError('尚未設定密碼，請聯絡管理員');
    const ok = await bcrypt.compare(password, emp.passwordHash);
    if (!ok) {
      // Audit failed login attempt (known employee, wrong password)
      void writeAudit({
        tenantId: emp.tenantId,
        userId: emp.id,
        action: 'WEB_LOGIN_FAILED',
        entity: 'Employee',
        entityId: emp.id,
        detail: { employeeId, reason: 'bad_password' },
      });
      throw new UnauthorizedError('帳號或密碼錯誤');
    }

    const token = jwt.sign(
      { employeeId: emp.id, tenantId: emp.tenantId, role: emp.role },
      config.jwt.secret,
      { expiresIn: `${SESSION_TTL_HOURS}h` },
    );
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TTL_HOURS * 3600 * 1000,
      path: '/',
    });
    void writeAudit({
      tenantId: emp.tenantId,
      userId: emp.id,
      action: 'WEB_LOGIN',
      entity: 'Employee',
      entityId: emp.id,
      detail: { role: emp.role },
    });
    res.json({
      ok: true,
      employee: {
        id: emp.id, employeeId: emp.employeeId, name: emp.name, role: emp.role,
      },
      tenant: { id: emp.tenant.id, companyName: emp.tenant.companyName },
    });
  } catch (err) {
    next(err);
  }
});

webAuthRouter.post('/logout', (req: Request, res: Response) => {
  // Best-effort audit: decode existing cookie to find who logged out.
  try {
    const token = (req as any).cookies?.[SESSION_COOKIE];
    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret) as { employeeId: string; tenantId: string };
      void writeAudit({
        tenantId: decoded.tenantId,
        userId: decoded.employeeId,
        action: 'WEB_LOGOUT',
        entity: 'Employee',
        entityId: decoded.employeeId,
      });
    }
  } catch {
    /* ignore — invalid/expired cookies just silently log out */
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

webAuthRouter.get('/session', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.[SESSION_COOKIE];
  if (!token) { res.status(401).json({ ok: false }); return; }
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as { employeeId: string; tenantId: string };
    const emp = await prisma.employee.findFirst({
      where: { id: decoded.employeeId, tenantId: decoded.tenantId, isActive: true },
      include: { tenant: true },
    });
    if (!emp) { res.status(401).json({ ok: false }); return; }
    res.json({
      ok: true,
      employee: { id: emp.id, employeeId: emp.employeeId, name: emp.name, role: emp.role },
      tenant: { id: emp.tenant.id, companyName: emp.tenant.companyName },
    });
  } catch {
    res.status(401).json({ ok: false });
  }
});

export { SESSION_COOKIE };

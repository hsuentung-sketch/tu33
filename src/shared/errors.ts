/**
 * Application-level error with HTTP status code + optional machine-readable code.
 *
 * ⚠️ 參數順序：`(statusCode, message, code?)`
 *
 * `code` 是 OPTIONAL 第 3 參數（用於 client-side switch），message 才是給人看的描述。
 * 這個順序與直覺「先 code 再 message」相反，是 2026-06-01 bug 的根因（多處 service
 * 寫成 `new AppError(403, 'FORBIDDEN', '無權...')` → client 看到「FORBIDDEN」訊息而非「無權...」）。
 *
 * ✓ 正確：
 *     throw new AppError(403, '無權存取此租戶的資料', 'FORBIDDEN');
 *
 * ✗ 錯誤（message 跟 code 對調）：
 *     throw new AppError(403, 'FORBIDDEN', '無權存取此租戶的資料');
 *
 * 推薦用子類別（ForbiddenError / NotFoundError 等）避免位置易混。
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    /** Human-readable description shown to end user. */
    message: string,
    /** Machine-readable code for client-side branching (optional). */
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(404, id ? `${entity} (${id}) not found` : `${entity} not found`, 'NOT_FOUND');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super(403, message, 'FORBIDDEN');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
  }
}

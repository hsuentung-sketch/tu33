export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
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

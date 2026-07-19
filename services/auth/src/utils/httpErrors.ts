export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message: string) {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}

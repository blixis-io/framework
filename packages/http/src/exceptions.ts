/** Thrown from a guard or handler to short-circuit the response with a specific status. */
export class HttpException extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(detail);
    this.name = "HttpException";
  }
}

export class BadRequestException extends HttpException {
  constructor(detail = "Bad Request", extra?: Record<string, unknown>) {
    super(400, detail, extra);
    this.name = "BadRequestException";
  }
}

export class UnauthorizedException extends HttpException {
  constructor(detail = "Unauthorized") {
    super(401, detail);
    this.name = "UnauthorizedException";
  }
}

export class ForbiddenException extends HttpException {
  constructor(detail = "Forbidden") {
    super(403, detail);
    this.name = "ForbiddenException";
  }
}

export class NotFoundException extends HttpException {
  constructor(detail = "Not Found") {
    super(404, detail);
    this.name = "NotFoundException";
  }
}

export class ConflictException extends HttpException {
  constructor(detail = "Conflict") {
    super(409, detail);
    this.name = "ConflictException";
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(detail = "Payload Too Large") {
    super(413, detail);
    this.name = "PayloadTooLargeException";
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(detail = "Unsupported Media Type") {
    super(415, detail);
    this.name = "UnsupportedMediaTypeException";
  }
}

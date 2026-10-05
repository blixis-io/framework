import { describe, expect, it } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from "./exceptions.js";

describe("HttpException", () => {
  it("carries a status, detail, and optional extra fields", () => {
    const error = new HttpException(422, "Unprocessable", { field: "email" });

    expect(error.status).toBe(422);
    expect(error.detail).toBe("Unprocessable");
    expect(error.extra).toEqual({ field: "email" });
    expect(error.message).toBe("Unprocessable");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("named HTTP exceptions", () => {
  it.each([
    [BadRequestException, 400, "Bad Request"],
    [UnauthorizedException, 401, "Unauthorized"],
    [ForbiddenException, 403, "Forbidden"],
    [NotFoundException, 404, "Not Found"],
    [ConflictException, 409, "Conflict"],
    [PayloadTooLargeException, 413, "Payload Too Large"],
    [UnsupportedMediaTypeException, 415, "Unsupported Media Type"],
    [GatewayTimeoutException, 504, "Gateway Timeout"],
  ] as const)("%s defaults to status %i and detail %j", (Ctor, status, detail) => {
    const error = new Ctor();

    expect(error).toBeInstanceOf(HttpException);
    expect(error.status).toBe(status);
    expect(error.detail).toBe(detail);
  });

  it("allows overriding the default detail message", () => {
    const error = new NotFoundException("Post 42 not found");

    expect(error.detail).toBe("Post 42 not found");
  });
});

describe("HttpException headers", () => {
  it("carries response headers when given", () => {
    const error = new HttpException(429, "Slow down", undefined, { "retry-after": "30" });

    expect(error.headers).toEqual({ "retry-after": "30" });
  });

  it("has none by default", () => {
    expect(new HttpException(400, "x").headers).toBeUndefined();
  });
});

describe("UnauthorizedException challenge", () => {
  it("sends the challenge as a WWW-Authenticate header", () => {
    const error = new UnauthorizedException("Invalid or expired token", 'Bearer error="invalid_token"');

    expect(error.status).toBe(401);
    expect(error.headers).toEqual({ "www-authenticate": 'Bearer error="invalid_token"' });
  });

  it("sends no header when no challenge is given: the framework can't know which scheme the app uses", () => {
    expect(new UnauthorizedException().headers).toBeUndefined();
    expect(new UnauthorizedException("nope").headers).toBeUndefined();
  });
});

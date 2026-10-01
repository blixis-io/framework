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

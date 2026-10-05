import { describe, expect, it } from "vitest";
import { statusTitle } from "./status-titles.js";

describe("statusTitle", () => {
  it.each([
    [400, "Bad Request"],
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [404, "Not Found"],
    [405, "Method Not Allowed"],
    [409, "Conflict"],
    [413, "Payload Too Large"],
    [415, "Unsupported Media Type"],
    [422, "Unprocessable Entity"],
    [429, "Too Many Requests"],
    [500, "Internal Server Error"],
    [503, "Service Unavailable"],
    [504, "Gateway Timeout"],
  ])("%i is %s", (status, title) => {
    expect(statusTitle(status)).toBe(title);
  });

  it("falls back to a generic title for a status with no registered reason phrase, such as nginx's 499", () => {
    expect(statusTitle(499)).toBe("Error");
    expect(statusTitle(799)).toBe("Error");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, field, startApp, type TestApp } from "./test-support.js";

let test: TestApp;
let document: unknown;

beforeAll(async () => {
  test = await startApp();
  document = (await call(test.app, "GET", "/openapi.json")).json;
});

afterAll(async () => {
  await test.close();
});

/** Every `operationId` in the document, found without assuming more of its shape than a test needs. */
function operationIds(doc: unknown): string[] {
  const paths = field(doc, "paths");
  const ids: string[] = [];
  if (typeof paths !== "object" || paths === null) {
    return ids;
  }
  for (const item of Object.values(paths)) {
    for (const operation of Object.values(item)) {
      const id = field(operation, "operationId");
      if (typeof id === "string") {
        ids.push(id);
      }
    }
  }
  return ids;
}

describe("the OpenAPI document", () => {
  it("is public, and declares bearer authentication for the whole API", async () => {
    expect((await call(test.app, "GET", "/openapi.json")).status).toBe(200);
    expect(field(document, "components", "securitySchemes", "bearerAuth")).toMatchObject({ type: "http", scheme: "bearer" });
    expect(field(document, "security")).toEqual([{ bearerAuth: [] }]);
  });

  it("marks exactly the routes that are @Public() as needing no token", () => {
    for (const path of ["/auth/sign-up", "/auth/sign-in", "/auth/refresh", "/auth/sign-out"]) {
      expect(field(document, "paths", path, "post", "security")).toEqual([]);
    }
    expect(field(document, "paths", "/me", "get", "security")).toBeUndefined(); // inherits the document's
    expect(field(document, "paths", "/spaces/{spaceId}/projects", "get", "security")).toBeUndefined();
  });

  it("documents the errors as problem+json, and a body that is required as required", () => {
    expect(field(document, "paths", "/me", "get", "responses", "default", "content", "application/problem+json")).toBeDefined();
    expect(field(document, "paths", "/me", "get", "responses", "default", "content", "application/json")).toBeUndefined();
    expect(field(document, "paths", "/auth/sign-in", "post", "requestBody", "required")).toBe(true);
  });

  it("has an operation id for every route, and none twice", () => {
    const ids = operationIds(document);

    expect(ids.length).toBe(13);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

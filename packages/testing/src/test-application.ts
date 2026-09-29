import type { HttpApplication } from "@blixis/http";
import type { Token } from "@blixis/di";

export interface TestRequestInit extends Omit<RequestInit, "body"> {
  body?: RequestInit["body"];
  /** JSON-stringified into the body, with `content-type: application/json` set automatically. */
  json?: unknown;
}

const BASE_URL = "http://localhost";

/** Thin sugar over `HttpApplication` for tests: a `request()` helper that builds absolute URLs and JSON bodies. */
export class TestApplication {
  constructor(private readonly app: HttpApplication) {}

  async request(path: string, init: TestRequestInit = {}): Promise<Response> {
    const { json, headers, body, ...rest } = init;
    const finalHeaders = new Headers(headers);
    let finalBody = body;

    if (json !== undefined) {
      finalHeaders.set("content-type", "application/json");
      finalBody = JSON.stringify(json);
    }

    return this.app.handle(
      new Request(new URL(path, BASE_URL), { ...rest, headers: finalHeaders, ...(finalBody !== undefined ? { body: finalBody } : {}) }),
    );
  }

  get<T>(token: Token<T>): T {
    return this.app.get(token);
  }

  async close(signal?: string): Promise<void> {
    await this.app.close(signal);
  }
}

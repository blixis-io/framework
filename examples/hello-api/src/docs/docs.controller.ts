import { Controller, Get } from "@blixis-io/http";
import { generateOpenApiDocument } from "@blixis-io/openapi";
import { AppRef } from "./app-ref.js";

@Controller()
export class DocsController {
  constructor(private readonly appRef: AppRef) {}

  @Get("openapi.json")
  spec() {
    if (!this.appRef.current) {
      throw new Error("AppRef.current not set — main.ts must set it right after createHttpApplication() resolves");
    }
    return generateOpenApiDocument(this.appRef.current, {
      title: "hello-api",
      version: "1.0.0",
      description: "The framework's own reference example — a Postgres-backed posts CRUD API.",
    });
  }
}

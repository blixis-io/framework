import type { HttpApplication } from "@blixis-io/http";
import { Injectable } from "@blixis-io/di";

/**
 * Holds a reference to the app itself, set once in main.ts right after
 * `createHttpApplication()` resolves. Exists only because `DocsController`
 * needs `app.controllers` to build the OpenAPI document, and the app can't
 * be injected into its own module graph the normal way — it doesn't exist
 * yet while that graph is still being constructed. `current` is only ever
 * read at request time (`DocsController.spec()`), by which point `main.ts`
 * has always already set it — a real request can't arrive before
 * `app.listen()` runs, and that's the line right after this gets set.
 */
@Injectable()
export class AppRef {
  current: HttpApplication | undefined;
}

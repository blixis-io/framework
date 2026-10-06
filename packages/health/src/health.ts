import { Module, type DynamicModule } from "@blixis-io/core";
import { InjectionToken } from "@blixis-io/di";
import type { Middleware } from "@blixis-io/http";

/** A readiness check: resolves if the dependency works, throws or rejects if it does not. */
export type HealthCheck = () => void | Promise<void>;

export interface HealthOptions {
  /** Path of the liveness endpoint. Default `/livez`. */
  livePath?: string;
  /** Path of the readiness endpoint. Default `/readyz`. */
  readyPath?: string;
  /** Milliseconds a single check may take before it counts as failed. Default 2000. */
  checkTimeoutMs?: number;
  /**
   * Called for every failing check on every probe, with the check's name and what it threw. By default a check that
   * starts failing is written with `console.error` once, when it flips from passing, not on every probe. The response
   * body never contains the error: it names the check, nothing else.
   */
  onCheckFailed?: (name: string, error: unknown) => void;
}

export interface CheckResult {
  status: "ok" | "fail";
  durationMs: number;
}

export interface ReadinessReport {
  /** `"draining"` while the application is shutting down, `"fail"` if any check failed, else `"ok"`. */
  status: "ok" | "fail" | "draining";
  checks: Record<string, CheckResult>;
}

/** What `watch()` needs of the application: whether it is draining. `HttpApplication` satisfies it. */
export interface Drainable {
  readonly draining: boolean;
}

export interface Health {
  /** Answers `GET` and `HEAD` on the two paths and passes every other request on. Put it before logging and rate limits. */
  readonly middleware: Middleware;
  /**
   * Registers a readiness check under `name` (a second check with the same name replaces the first). Returns a function
   * that removes it. The provider that owns a dependency registers its check, so the endpoint cannot drift from reality.
   */
  check(name: string, check: HealthCheck): () => void;
  /** Makes readiness report "draining" while `app.draining` is true. Call it once, after creating the application. */
  watch(app: Drainable): void;
  /** What `/readyz` answers, as data. */
  ready(): Promise<ReadinessReport>;
}

const NO_STORE = { "cache-control": "no-store" };

function json(status: number, body: unknown, head: boolean): Response {
  return new Response(head ? null : JSON.stringify(body), { status, headers: { ...NO_STORE, "content-type": "application/json" } });
}

/** Rejects after `ms`, so a check that never settles cannot hold the probe open. The check itself is not cancelled. */
function withTimeout(run: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`the check did not finish within ${ms} ms`));
    }, ms);
  });
  return Promise.race([run, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export function createHealth(options: HealthOptions = {}): Health {
  const livePath = options.livePath ?? "/livez";
  const readyPath = options.readyPath ?? "/readyz";
  const checkTimeoutMs = options.checkTimeoutMs ?? 2000;
  if (livePath === readyPath) {
    throw new RangeError(`health: livePath and readyPath are both "${livePath}"; liveness and readiness are different questions.`);
  }
  if (!Number.isInteger(checkTimeoutMs) || checkTimeoutMs < 1) {
    throw new RangeError(`health: checkTimeoutMs must be a whole number of milliseconds, 1 or more (got ${checkTimeoutMs}).`);
  }

  const checks = new Map<string, HealthCheck>();
  const failing = new Set<string>();
  let watched: Drainable | undefined;

  function reportFailure(name: string, error: unknown): void {
    const flipped = !failing.has(name);
    failing.add(name);
    if (options.onCheckFailed) {
      try {
        options.onCheckFailed(name, error);
      } catch (hookError) {
        console.error("[@blixis-io/health] onCheckFailed threw:", hookError);
      }
    } else if (flipped) {
      console.error(`[@blixis-io/health] readiness check "${name}" is failing:`, error);
    }
  }

  async function ready(): Promise<ReadinessReport> {
    const entries = [...checks.entries()];
    const results = await Promise.all(
      entries.map(async ([name, check]): Promise<[string, CheckResult]> => {
        const started = performance.now();
        try {
          await withTimeout(Promise.resolve().then(check), checkTimeoutMs);
          failing.delete(name);
          return [name, { status: "ok", durationMs: Math.round(performance.now() - started) }];
        } catch (error) {
          reportFailure(name, error);
          return [name, { status: "fail", durationMs: Math.round(performance.now() - started) }];
        }
      }),
    );
    const report = Object.fromEntries(results);
    const anyFailed = results.some(([, result]) => result.status === "fail");
    return { status: watched?.draining ? "draining" : anyFailed ? "fail" : "ok", checks: report };
  }

  const middleware: Middleware = async (request, next) => {
    const probe = request.method === "GET" || request.method === "HEAD";
    const { pathname } = new URL(request.url);
    if (!probe || (pathname !== livePath && pathname !== readyPath)) {
      return next();
    }
    const head = request.method === "HEAD";
    if (pathname === livePath) {
      return json(200, { status: "ok" }, head);
    }
    const report = await ready();
    return json(report.status === "ok" ? 200 : 503, report, head);
  };

  return {
    middleware,
    check(name, check) {
      checks.set(name, check);
      return () => {
        if (checks.get(name) === check) {
          checks.delete(name);
          failing.delete(name);
        }
      };
    },
    watch(app) {
      watched = app;
    },
    ready,
  };
}

/**
 * Builds the pieces for one app, in the same factory shape as `defineConfigModule` and friends: `HEALTH` is the token
 * providers inject to register their checks, `HealthModule.forRoot()` provides it, and `health.middleware` goes in the
 * application's `middleware`.
 */
export function defineHealthModule(options: HealthOptions = {}): {
  health: Health;
  HEALTH: InjectionToken<Health>;
  HealthModule: { forRoot(forRootOptions?: { global?: boolean }): DynamicModule };
} {
  const health = createHealth(options);
  const HEALTH = new InjectionToken<Health>("blixis.health");

  @Module()
  class HealthModule {
    static forRoot(forRootOptions: { global?: boolean } = {}): DynamicModule {
      return {
        module: HealthModule,
        providers: [{ provide: HEALTH, useValue: health }],
        exports: [HEALTH],
        global: forRootOptions.global ?? true,
      };
    }
  }

  return { health, HEALTH, HealthModule };
}

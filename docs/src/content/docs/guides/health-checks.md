---
title: Health checks
description: Liveness and readiness endpoints with @blixis-io/health, readiness checks registered by the providers that own the dependencies, and not-ready while shutting down.
sidebar:
  order: 8.7
---

> **Not on npm yet.** The package is in the repository and tested, but it is marked private until its npm placeholder and trusted publisher exist (see the note on [Securing the API](/framework/guides/securing-the-api/)); the install command below will work once it is published.

Two questions, two endpoints, because a platform acts on the answers differently:

| Endpoint | Question | A failure means | Checks |
| --- | --- | --- | --- |
| `/livez` | Is the process up and answering? | Restart it. | None. It always says `200` if it can answer at all. |
| `/readyz` | Should traffic be sent to it? | Take it out of rotation, **don't** restart. | Every registered check, and whether the application is draining. |

A readiness check that fails because the database is down must not make liveness fail too: restarting every instance does not bring the database back, it only adds a restart storm. That is why they are separate, and why `/livez` runs no checks.

```bash
npm install @blixis-io/health
```

```ts title="src/health.ts"
import { defineHealthModule } from "@blixis-io/health";

export const { health, HEALTH, HealthModule } = defineHealthModule();
```

```ts title="src/main.ts"
const app = await createHttpApplication(AppModule, {
  middleware: [health.middleware, requestId(), accessLog({ log }) /* ... */],
});
health.watch(app); // readiness reports "draining" while the application shuts down
```

`health.middleware` answers `GET` and `HEAD` on the two paths and passes everything else on. Put it **first**: probes then skip your request log and your rate limiter, which would otherwise count a load balancer's every-few-seconds poll.

## Registering a check

The provider that owns a dependency registers the check for it, so the endpoint cannot drift from what the app really depends on:

```ts
@Injectable()
export class Database implements OnModuleInit {
  constructor(@Inject(HEALTH) private readonly health: Health, private readonly pool: Pool) {}

  onModuleInit() {
    this.health.check("database", async () => {
      await this.pool.query("select 1");
    });
  }
}
```

```ts
@Module({ imports: [HealthModule.forRoot()], providers: [Database] })
class AppModule {}
```

A check resolves if the dependency works and throws or rejects if it does not. `check()` returns a function that removes it, and registering the same name again replaces the check.

- Checks run **at the same time** on every probe, so the probe takes as long as the slowest. Each has `checkTimeoutMs` (default 2 s): a check that does not finish counts as failed, so a hung dependency cannot hang the probe. The check itself is not cancelled; give it its own timeout (`pg`'s `query_timeout`, an `AbortSignal`).
- Keep them cheap. A probe every few seconds from several balancers is real load: `select 1`, not a table scan.
- Check **dependencies the instance needs to serve**, not everything you could check. A flaky optional service in readiness takes healthy instances out of rotation.

## What the endpoints answer

```json
{ "status": "ok", "checks": { "database": { "status": "ok", "durationMs": 3 } } }
```

`/readyz` is `200` when everything passes and `503` otherwise, with `status` `"fail"` or, while shutting down, `"draining"`. The body names each check and says whether it passed; **it never contains the error**, because the endpoint is usually reachable by anything that can reach the port and an error message holds hostnames and usernames. The error goes to your logs: a check that starts failing is written with `console.error` once, when it flips from passing, not on every probe; pass `onCheckFailed(name, error)` to take every failure yourself. Responses carry `Cache-Control: no-store`.

## Draining

`health.watch(app)` ties readiness to `app.draining`, which is `true` from `app.startDraining()` or `app.close()`. Combine it with the shutdown sequence from [Running in Production](/framework/guides/running-in-production/#telling-the-load-balancer-first): on SIGTERM call `app.startDraining()`, so `/readyz` answers `503 draining` and the load balancer stops sending new traffic; wait a little longer than its check interval; then `app.close()`. `/livez` stays `200` throughout, since the process is not broken, only leaving.

## What it does not do

No result caching across probes, no per-check dependencies or ordering, no startup probe distinct from readiness (a platform that wants one can use `/readyz` with a generous failure threshold), and no checks of its own: the checks are yours, because only you know what the app depends on.

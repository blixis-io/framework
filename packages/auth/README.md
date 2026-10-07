# `@blixis-io/auth`

JWT verification and role checks, plus optional password sign-in and refresh-token rotation. Built on `@blixis-io/http`'s guard primitive; app-layer, not a framework dependency.

```bash
npm install @blixis-io/auth @blixis-io/http @blixis-io/core @blixis-io/di zod
```

```ts
// auth.ts
import { defineAuthModule } from "@blixis-io/auth";
import { z } from "zod";

const ClaimsSchema = z.object({ sub: z.string(), roles: z.array(z.string()) });

export const { AuthModule, JwtAuthGuard, createRolesGuard, getCurrentUser } = defineAuthModule(ClaimsSchema);
```

```ts
// JWT_SECRET: at least 32 random bytes for HS256, e.g. `openssl rand -base64 48`
@Module({ imports: [AuthModule.forRoot({ secret: process.env.JWT_SECRET! })] })
class PostsModule {}
```

API keys for machine clients: `AuthModule.forRoot({ secret, apiKeys: { store } })` accepts `x-api-key: blx_<id>_<secret>` checked against your store, resolving to the same claims as a token. Keys are stored as a SHA-256, compared in constant time, can expire, be revoked and be limited to networks (`allowedCidrs`), and every failure is the same `401`; a store error is a `503`, never an allow. See the [reference](https://blixis-io.github.io/framework/reference/blixis-auth/#api-keys).

```ts
@UseGuards(JwtAuthGuard)
@Get("me")
me() { /* ... */ }
```

By default this is verification only. Pass `issuing` to `forRoot()` to also get password sign-in, refresh-token rotation with reuse detection, and sign-out — storage-agnostic, you implement two small interfaces as ordinary DI classes.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — full docs: [Authentication](https://blixis-io.github.io/framework/concepts/authentication/) · [API reference](https://blixis-io.github.io/framework/reference/blixis-auth/).

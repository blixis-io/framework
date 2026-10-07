---
"@blixis-io/auth": minor
---

Add API keys. `AuthModule.forRoot({ apiKeys: { store } })` also accepts an `x-api-key: blx_<id>_<secret>` header, checked against your `ApiKeyStore`, and a key resolves to the same claims as a token so `@Roles`, `getCurrentUser` and tenancy work unchanged. Only a SHA-256 of the secret is stored and it is compared in constant time; keys can expire, be revoked and be limited to networks (`allowedCidrs`, using `@blixis-io/security`). Every failure is the same `401`, a store error is a `503` and never an allow, and a malformed key is refused before the store is asked. New exports: `generateApiKey`, `parseApiKey`, `hashApiKeySecret`, `API_KEY_HEADER`, the `ApiKey*` types, and `getCurrentApiKey` from `defineAuthModule`. `@blixis-io/auth` now depends on `@blixis-io/security`.

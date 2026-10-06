---
"@blixis-io/auth": minor
---

Refresh-token rotation is safer when something fails or two requests overlap. All additions are optional; a store that implements none of them keeps working.

- A failure part-way no longer strands the client. `refresh()` now loads the claims and signs the new access token before writing anything, and stores the successor *before* it marks the old token rotated, so a failure leaves the old token usable. Before, `markRotated` ran first, and a failure after it (claims lookup, signing, storing the successor) left the client with a rotated token and no replacement.
- New optional `RefreshTokenStore.rotate(oldTokenHash, next)`: marks the old token rotated and stores the successor in one atomic step. When present, `refresh()` uses it instead of `create` plus `markRotated`.
- New optional families: `create` now receives a `familyId` (one per sign-in, kept across rotations), and an optional `revokeFamily(familyId)` lets reuse of a stolen token end that login only. Without `revokeFamily`, or for a record without a family, reuse still revokes every refresh token of the subject, as before. `RefreshTokenRecord.familyId` and the exported `NewRefreshToken` type are new.
- New `issuing.refreshReuseGraceSeconds` (default `0`, off): a token rotated within that window is refused with the usual `401` but nothing is revoked, so a client that refreshes twice at once, or retries a refresh whose response was lost, is not signed out. A stolen token replayed inside the window is also only refused. A negative or non-finite value throws `AuthConfigError` at boot.
- Behaviour to know: two simultaneous refreshes of one token with the default settings still end the login, and now do so deterministically (the loser's successor is revoked); before, whether the winner's token survived depended on timing.

The package ships no Postgres store; a tested reference is in the docs (`postgres-refresh-store.example.ts` in the repository).

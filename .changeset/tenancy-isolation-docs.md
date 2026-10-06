---
"@blixis-io/tenancy": patch
---

Documentation and tests only: the Tenancy page now states plainly that `tenantScope()` and the guard do not isolate anything by themselves, lays out the pattern for reads, updates, deletes, inserts, joins, rows loaded by id and jobs, shows the composite-foreign-key schema that stops a child pointing at another tenant's parent, and adds a Postgres row-level-security recipe. Both are backed by new real-Postgres test suites (`isolation.test.ts`, `rls.test.ts`) that attack each operation with another tenant's ids. No code change.

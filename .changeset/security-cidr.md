---
"@blixis-io/security": minor
---

Add `createIpMatcher`, `ipInCidrs` and `parseCidr`: CIDR matching for IPv4, IPv6 and IPv4-mapped addresses. A malformed network, or one with bits set after the prefix (`192.168.1.5/24`), throws a `SecurityConfigError` when the matcher is built; an address that is not a valid IP is never inside. It fits `getClientIp`'s `isTrustedProxy` directly, and is the building block for IP allowlists.

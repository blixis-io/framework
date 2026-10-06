---
"@blixis-io/http": patch
---

A middleware that throws now reaches the middleware outside it as a response, the way a failure in the application already did. Before, an error thrown by an inner middleware (a rate limiter throwing a `429`, an auth check throwing a `401`) travelled up as a rejection through the outer ones and was turned into a response only at the very top, so a middleware placed first, such as CORS or an access log, never saw that response and could not add its headers to it or record its status. Now `next()` never rejects: an `HttpException` becomes its problem+json response and any other error a logged generic `500`, and each outer middleware receives that `Response`. Behaviour change: a middleware that wrapped `next()` in `try`/`catch` to see an inner middleware's error now gets a response instead.

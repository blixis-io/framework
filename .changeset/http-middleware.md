---
"@blixis-io/http": minor
---

New `middleware` option on `createHttpApplication` and `createFetchHandler`: an array of `(request, next) => Response` functions, outermost first, that wrap every request: routed, mounted, and the ones the router refuses (`404`, `405`, malformed path), plus guard denials, validation errors, controller errors and timeouts. A middleware can answer without calling `next()`, hand on a changed `Request`, or throw (an `HttpException` becomes its problem+json, anything else a logged generic `500`). The chain runs inside a `RequestContext` scope that the guards and controller share, so a value a middleware sets is what they read. It sits outside `requestTimeout`, and sees the response as created, not the end of a streamed body. Exports `Middleware`, `NextFunction` and `MiddlewareOptions`. Nothing changes when the option is not set.

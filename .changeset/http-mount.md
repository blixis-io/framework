---
"@blixis-io/http": minor
---

New `HttpApplication.mount(method, path, handler)`: serves an exact path with a plain Web-standard handler ahead of the router, for framework-level endpoints that need the finished app. Mounted routes bypass guards and interceptors; mounting the same method and path twice throws.

---
"@blixis-io/http": patch
---

Router: a route only matches the method it was registered with, so a request falls through to the next candidate instead of being refused by a sibling that has other methods only. With `POST /posts/new` and `GET /posts/:id`, `GET /posts/new` used to answer `405` (`Allow: POST`) and now reaches `GET /posts/:id`; the same holds for a wildcard sibling. A real `405` now lists the methods of every route that matches the path. Behaviour change: a request that used to get a `405` can now reach a handler. Guards still run only for the route that is finally matched.

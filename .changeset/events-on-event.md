---
"@blixis-io/events": minor
---

New `@OnEvent("type")` method decorator, returned by `defineEventsModule<Events>()` and typed to your event map: the compiler rejects a method whose parameter doesn't match the event's payload and an event name that isn't in the map. After the application boots, every singleton provider (and controller) in the app, including handlers inherited from a base class, is scanned and its `@OnEvent` methods are subscribed, with `this` bound to the provider so injected dependencies work. Handlers are unsubscribed when the app closes. Requires `@blixis-io/core` with `OnApplicationBootstrap`.

# @blixis-io/events

## 0.2.1

### Patch Changes

- Updated dependencies [[`3b2d859`](https://github.com/blixis-io/framework/commit/3b2d85957cba17f6cfc6273f327c042b25d7ca36)]:
  - @blixis-io/di@0.1.2
  - @blixis-io/core@0.3.1

## 0.2.0

### Minor Changes

- [#48](https://github.com/blixis-io/framework/pull/48) [`db83be1`](https://github.com/blixis-io/framework/commit/db83be1e141adbffa7bc1a370211b5dfb8e329f1) Thanks [@EmVeeNL](https://github.com/EmVeeNL)! - New `@OnEvent("type")` method decorator, returned by `defineEventsModule<Events>()` and typed to your event map: the compiler rejects a method whose parameter doesn't match the event's payload and an event name that isn't in the map. After the application boots, every singleton provider (and controller) in the app, including handlers inherited from a base class, is scanned and its `@OnEvent` methods are subscribed, with `this` bound to the provider so injected dependencies work. Handlers are unsubscribed when the app closes. Requires `@blixis-io/core` with `OnApplicationBootstrap`.

### Patch Changes

- Updated dependencies [[`4c34195`](https://github.com/blixis-io/framework/commit/4c34195a621dabc5d2f31e7a4eeed54a2dbc6d45)]:
  - @blixis-io/core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`fe1f67a`](https://github.com/blixis-io/framework/commit/fe1f67af5657af8d0d2a1ba8ca0aef400617d597)]:
  - @blixis-io/di@0.1.1
  - @blixis-io/core@0.2.1

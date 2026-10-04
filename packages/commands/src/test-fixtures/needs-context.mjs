// An app whose provider injects RequestContext, like a guard or service in an HTTP app.
// `@blixis-io/http` is the one place RequestContext comes from, so booting this without it must fail.
import { Module } from "@blixis-io/core";
import { Injectable } from "@blixis-io/di";
import { RequestContext } from "@blixis-io/http";

export class NeedsContext {
  constructor(context) {
    this.context = context;
  }
}
// What `emitDecoratorMetadata` would emit for `constructor(context: RequestContext)`; plain JS has no compiler to do it.
Reflect.defineMetadata("design:paramtypes", [RequestContext], NeedsContext);
Injectable()(NeedsContext);

export class AppModule {}
Module({ providers: [NeedsContext] })(AppModule);

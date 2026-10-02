// A compiled-JS app module, as `blix run` would import it from dist/. Decorators are plain functions,
// so they are applied by hand here instead of with @ syntax.
import { Module } from "@blixis-io/core";
import { Command } from "../decorators.js";

export class HelloCommand {
  run() {
    return 0;
  }
}
Command({ name: "hello", description: "Says hello" })(HelloCommand);

export class AppModule {}
Module({ providers: [HelloCommand] })(AppModule);

export const NotAModule = 42;

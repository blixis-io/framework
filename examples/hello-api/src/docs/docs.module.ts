import { Module } from "@blixis/core";
import { AppRef } from "./app-ref.js";
import { DocsController } from "./docs.controller.js";

@Module({
  providers: [AppRef],
  controllers: [DocsController],
})
export class DocsModule {}

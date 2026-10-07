import { Module, type DynamicModule } from "@blixis-io/core";
import { OUTBOX_OPTIONS, OutboxRelay, type OutboxOptions } from "./outbox-relay.js";

@Module({})
export class OutboxModule {
  static forRoot(options: OutboxOptions): DynamicModule {
    return {
      module: OutboxModule,
      providers: [{ provide: OUTBOX_OPTIONS, useValue: options }, OutboxRelay],
      exports: [OutboxRelay],
    };
  }
}

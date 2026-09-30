import { createApplication, Module } from "@blixis-io/core";
import { Inject, Injectable } from "@blixis-io/di";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { LOGGER, LoggerModule } from "./module.js";
import type { Logger, LogRecord, Transport } from "./types.js";

function recordingTransport() {
  const records: LogRecord[] = [];
  const transport: Transport = {
    log: (record) => {
      records.push(record);
    },
  };
  return { transport, records };
}

describe("LOGGER token", () => {
  it("lets a provider inject a pre-built Logger directly", async () => {
    const { transport, records } = recordingTransport();
    const logger = createLogger({ transports: [transport] });

    @Injectable()
    class Service {
      constructor(@Inject(LOGGER) public log: Logger) {}
    }

    @Module({ providers: [Service, { provide: LOGGER, useValue: logger }] })
    class AppModule {}

    const app = await createApplication(AppModule);
    app.get(Service).log.info("hi");

    expect(records.map((r) => r.message)).toEqual(["hi"]);
  });
});

describe("LoggerModule.forRoot", () => {
  it("wires up LOGGER from options, injectable anywhere in the app", async () => {
    const { transport, records } = recordingTransport();

    @Injectable()
    class Service {
      constructor(@Inject(LOGGER) public logger: Logger) {}
    }

    @Module({
      imports: [LoggerModule.forRoot({ transports: [transport] })],
      providers: [Service],
    })
    class AppModule {}

    const app = await createApplication(AppModule);
    app.get(Service).logger.warn("configured via forRoot");

    expect(records.map((r) => r.message)).toEqual(["configured via forRoot"]);
  });
});

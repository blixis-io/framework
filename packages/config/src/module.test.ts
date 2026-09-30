import { createApplication, Module } from "@blixis-io/core";
import { Inject, Injectable } from "@blixis-io/di";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineConfigModule } from "./module.js";
import { ConfigValidationError } from "./errors.js";

const AppConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string(),
});

describe("defineConfigModule", () => {
  it("forRoot() parses and coerces the given source against the schema", () => {
    const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);

    const dynamic = ConfigModule.forRoot({ PORT: "4000", DATABASE_URL: "postgres://localhost" });

    expect(dynamic.providers).toEqual([{ provide: CONFIG, useValue: { PORT: 4000, DATABASE_URL: "postgres://localhost" } }]);
  });

  it("applies schema defaults for missing keys", () => {
    const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);

    const dynamic = ConfigModule.forRoot({ DATABASE_URL: "postgres://localhost" });

    expect(dynamic.providers).toEqual([
      { provide: CONFIG, useValue: { PORT: 3000, DATABASE_URL: "postgres://localhost" } },
    ]);
  });

  it("throws ConfigValidationError immediately when the source is invalid", () => {
    const { ConfigModule } = defineConfigModule(AppConfigSchema);

    expect(() => ConfigModule.forRoot({})).toThrow(ConfigValidationError);
  });

  it("defaults the source to process.env when none is given", () => {
    const { ConfigModule } = defineConfigModule(z.object({ HOME: z.string() }));

    // Node always has HOME set; this only proves process.env was actually read.
    expect(() => ConfigModule.forRoot()).not.toThrow();
  });

  it("each call to defineConfigModule produces its own distinct token, even for the same schema", () => {
    const a = defineConfigModule(AppConfigSchema);
    const b = defineConfigModule(AppConfigSchema);

    expect(a.CONFIG).not.toBe(b.CONFIG);
  });

  it("is injectable anywhere in the app via @Inject(CONFIG)", async () => {
    const { CONFIG, ConfigModule } = defineConfigModule(AppConfigSchema);

    @Injectable()
    class Service {
      constructor(@Inject(CONFIG) public config: z.infer<typeof AppConfigSchema>) {}
    }

    @Module({
      imports: [ConfigModule.forRoot({ PORT: "5000", DATABASE_URL: "postgres://localhost" })],
      providers: [Service],
    })
    class AppModule {}

    const app = await createApplication(AppModule);

    expect(app.get(Service).config).toEqual({ PORT: 5000, DATABASE_URL: "postgres://localhost" });
  });
});

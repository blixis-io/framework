import { describe, expect, it } from "vitest";
import { isClassProvider, isExistingProvider, isFactoryProvider, isValueProvider, providerToken } from "./providers.js";

class Service {}

describe("provider shape guards", () => {
  it("recognizes a value provider", () => {
    const provider = { provide: Service, useValue: new Service() };

    expect(isValueProvider(provider)).toBe(true);
    expect(isClassProvider(provider)).toBe(false);
    expect(isFactoryProvider(provider)).toBe(false);
    expect(isExistingProvider(provider)).toBe(false);
  });

  it("recognizes a class provider", () => {
    const provider = { provide: Service, useClass: Service };

    expect(isClassProvider(provider)).toBe(true);
  });

  it("recognizes a factory provider", () => {
    const provider = { provide: Service, useFactory: () => new Service() };

    expect(isFactoryProvider(provider)).toBe(true);
  });

  it("recognizes an existing (alias) provider", () => {
    const provider = { provide: Service, useExisting: Service };

    expect(isExistingProvider(provider)).toBe(true);
  });
});

describe("providerToken", () => {
  it("returns the class itself for a bare class provider", () => {
    expect(providerToken(Service)).toBe(Service);
  });

  it("returns the `provide` token for an object-shaped provider", () => {
    expect(providerToken({ provide: Service, useValue: new Service() })).toBe(Service);
  });
});

import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { getInjectableOptions, getInjectOverrides, getOptionalParams, Inject, Injectable, Optional } from "./decorators.js";
import { forwardRef } from "./forward-ref.js";
import { InjectionToken } from "./tokens.js";

describe("@Injectable", () => {
  it("defaults to singleton scope", () => {
    @Injectable()
    class Service {}

    expect(getInjectableOptions(Service)).toEqual({ scope: "singleton" });
  });

  it("accepts an explicit transient scope", () => {
    @Injectable({ scope: "transient" })
    class Service {}

    expect(getInjectableOptions(Service)).toEqual({ scope: "transient" });
  });

  it("a class with no decorator at all has no injectable options recorded", () => {
    class Undecorated {}

    expect(getInjectableOptions(Undecorated)).toBeUndefined();
  });
});

describe("@Inject", () => {
  it("records a per-parameter token override, keyed by parameter index", () => {
    class Dep {}
    const TOKEN = new InjectionToken<Dep>("token");

    @Injectable()
    class Service {
      constructor(@Inject(TOKEN) _dep: Dep) {}
    }

    expect(getInjectOverrides(Service)?.get(0)).toBe(TOKEN);
  });

  it("accepts a forwardRef and stores it unresolved", () => {
    class Dep {}

    @Injectable()
    class Service {
      constructor(@Inject(forwardRef(() => Dep)) _dep: Dep) {}
    }

    const override = getInjectOverrides(Service)?.get(0);
    expect(typeof override).toBe("function");
  });
});

describe("@Optional", () => {
  it("records the parameter index as optional", () => {
    class Dep {}

    @Injectable()
    class Service {
      constructor(@Optional() _dep?: Dep) {}
    }

    expect(getOptionalParams(Service)?.has(0)).toBe(true);
  });

  it("leaves other parameters unaffected", () => {
    class A {}
    class B {}

    @Injectable()
    class Service {
      constructor(
        _a: A,
        @Optional() _b?: B,
      ) {}
    }

    const optional = getOptionalParams(Service);
    expect(optional?.has(0)).toBeFalsy();
    expect(optional?.has(1)).toBe(true);
  });
});

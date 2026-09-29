import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { getDependencyTokens } from "./dependencies.js";
import { Inject, Injectable, Optional } from "./decorators.js";
import { NotInjectableError, UnresolvableParameterError } from "./errors.js";
import { forwardRef } from "./forward-ref.js";
import { InjectionToken } from "./tokens.js";

describe("getDependencyTokens", () => {
  it("returns an empty list for a class with no constructor parameters", () => {
    @Injectable()
    class Service {}

    expect(getDependencyTokens(Service)).toEqual([]);
  });

  it("returns each parameter's reflected type as a token, in order", () => {
    class A {}
    class B {}

    @Injectable()
    class Service {
      constructor(
        public a: A,
        public b: B,
      ) {}
    }

    expect(getDependencyTokens(Service)).toEqual([
      { index: 0, token: A, optional: false },
      { index: 1, token: B, optional: false },
    ]);
  });

  it("uses the @Inject override instead of the reflected type", () => {
    const TOKEN = new InjectionToken<string>("token");

    @Injectable()
    class Service {
      constructor(@Inject(TOKEN) public value: string) {}
    }

    expect(getDependencyTokens(Service)).toEqual([{ index: 0, token: TOKEN, optional: false }]);
  });

  it("unwraps a forwardRef override to the real token", () => {
    @Injectable()
    class Service {
      constructor(@Inject(forwardRef(() => Dep)) public dep: unknown) {}
    }
    @Injectable()
    class Dep {}

    expect(getDependencyTokens(Service)).toEqual([{ index: 0, token: Dep, optional: false }]);
  });

  it("marks a parameter decorated with @Optional as optional", () => {
    class Dep {}

    @Injectable()
    class Service {
      constructor(@Optional() public dep?: Dep) {}
    }

    expect(getDependencyTokens(Service)).toEqual([{ index: 0, token: Dep, optional: true }]);
  });

  it("throws NotInjectableError for a class with params but no @Injectable", () => {
    class Dep {}
    class Service {
      constructor(public dep: Dep) {}
    }

    expect(() => getDependencyTokens(Service)).toThrow(NotInjectableError);
  });

  it("throws UnresolvableParameterError when the reflected type is Object", () => {
    interface Dep {
      name: string;
    }
    @Injectable()
    class Service {
      constructor(public dep: Dep) {}
    }

    expect(() => getDependencyTokens(Service)).toThrow(UnresolvableParameterError);
  });
});

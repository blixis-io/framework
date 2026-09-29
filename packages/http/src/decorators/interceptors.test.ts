import { describe, expect, it } from "vitest";
import type { Interceptor } from "./interceptors.js";
import { getClassInterceptors, getMethodInterceptors, UseInterceptors } from "./interceptors.js";

class TimingInterceptor implements Interceptor {
  intercept(_context: unknown, next: () => Promise<Response>): Promise<Response> {
    return next();
  }
}

class CacheInterceptor implements Interceptor {
  intercept(_context: unknown, next: () => Promise<Response>): Promise<Response> {
    return next();
  }
}

describe("@UseInterceptors", () => {
  it("records interceptors applied at the class level", () => {
    @UseInterceptors(TimingInterceptor)
    class Controller {}

    expect(getClassInterceptors(Controller)).toEqual([TimingInterceptor]);
  });

  it("records interceptors applied at the method level, independently of class-level interceptors", () => {
    class Controller {
      @UseInterceptors(CacheInterceptor)
      cachedRoute(): void {}

      plainRoute(): void {}
    }

    expect(getMethodInterceptors(Controller.prototype, "cachedRoute")).toEqual([CacheInterceptor]);
    expect(getMethodInterceptors(Controller.prototype, "plainRoute")).toEqual([]);
  });

  it("accepts multiple interceptor classes in one call", () => {
    @UseInterceptors(TimingInterceptor, CacheInterceptor)
    class Controller {}

    expect(getClassInterceptors(Controller)).toEqual([TimingInterceptor, CacheInterceptor]);
  });

  it("a class with no @UseInterceptors has an empty class interceptor list", () => {
    class Plain {}

    expect(getClassInterceptors(Plain)).toEqual([]);
  });
});

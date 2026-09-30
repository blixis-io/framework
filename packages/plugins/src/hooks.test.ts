import { describe, expect, it } from "vitest";
import { After, Around, Before } from "./hooks.js";

/**
 * A genuine `PromiseLike` that's deliberately not `instanceof Promise` —
 * the stand-in for a cross-realm Promise (a worker, a vm context, a
 * bundled polyfill), which is what `isThenable()` exists to still handle
 * correctly.
 */
function toThenable<T>(value: T): PromiseLike<T> {
  return {
    // oxlint-disable-next-line unicorn/no-thenable -- the whole point of this helper
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      if (onfulfilled) {
        return Promise.resolve(onfulfilled(value));
      }
      // No onfulfilled means TResult1 defaulted to T, so `value` already
      // *is* TResult1 — TS can't see that default flow through a
      // conditional call site, hence the assertion.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return Promise.resolve(value as unknown as TResult1);
    },
  };
}

describe("Before", () => {
  it("calls the original with unchanged args when the hook returns nothing", () => {
    class Calc {
      @Before(() => undefined)
      add(a: number, b: number): number {
        return a + b;
      }
    }

    expect(new Calc().add(2, 3)).toBe(5);
  });

  it("replaces the args when the hook returns an array", () => {
    class Calc {
      @Before((a: number, b: number): [number, number] => [a * 10, b * 10])
      add(a: number, b: number): number {
        return a + b;
      }
    }

    expect(new Calc().add(2, 3)).toBe(50);
  });

  it("awaits an async hook before calling the original", async () => {
    const log: string[] = [];

    class Calc {
      @Before(async (a: number, b: number): Promise<[number, number]> => {
        log.push("hook start");
        await Promise.resolve();
        log.push("hook end");
        return [a, b];
      })
      add(a: number, b: number): number {
        log.push("original");
        return a + b;
      }
    }

    // `add`'s declared return type is still `number` — legacy decorators
    // can't change a member's static type, only its runtime behavior — so
    // `await` needs a nudge here even though this call genuinely resolves
    // a Promise at runtime.
    const result = await Promise.resolve(new Calc().add(2, 3));
    expect(result).toBe(5);
    expect(log).toEqual(["hook start", "hook end", "original"]);
  });

  it("keeps the original args when an async hook resolves to undefined", async () => {
    class Calc {
      @Before(async () => {
        await Promise.resolve();
        return undefined;
      })
      add(a: number, b: number): number {
        return a + b;
      }
    }

    await expect(new Calc().add(2, 3)).resolves.toBe(5);
  });

  it("awaits a genuine thenable that isn't `instanceof Promise`", async () => {
    class Calc {
      @Before((a: number, b: number) => toThenable<[number, number]>([a * 10, b * 10]))
      add(a: number, b: number): number {
        return a + b;
      }
    }

    await expect(new Calc().add(2, 3)).resolves.toBe(50);
  });

  it("preserves `this` binding in the decorated method", () => {
    class Calc {
      #offset = 100;

      @Before(() => undefined)
      add(a: number, b: number): number {
        return a + b + this.#offset;
      }
    }

    expect(new Calc().add(2, 3)).toBe(105);
  });

  it("propagates a throwing hook, never calling the original", () => {
    let called = false;

    class Calc {
      @Before(() => {
        throw new Error("before failed");
      })
      add(): number {
        called = true;
        return 0;
      }
    }

    expect(() => new Calc().add()).toThrow("before failed");
    expect(called).toBe(false);
  });
});

describe("After", () => {
  it("transforms the result", () => {
    class Calc {
      @After((result: number) => result * 2)
      add(a: number, b: number): number {
        return a + b;
      }
    }

    expect(new Calc().add(2, 3)).toBe(10);
  });

  it("receives the original args alongside the result", () => {
    class Calc {
      @After((result: number, a: number, b: number) => result + a + b)
      add(a: number, b: number): number {
        return a + b;
      }
    }

    expect(new Calc().add(2, 3)).toBe(10); // 5 + 2 + 3
  });

  it("awaits an async original before calling the hook, and supports an async hook", async () => {
    class AsyncCalc {
      @After(async (result: number) => {
        await Promise.resolve();
        return result * 2;
      })
      async add(a: number, b: number): Promise<number> {
        return Promise.resolve(a + b);
      }
    }

    await expect(new AsyncCalc().add(2, 3)).resolves.toBe(10);
  });

  it("awaits an original method returning a genuine thenable that isn't `instanceof Promise`", async () => {
    class Calc {
      @After((result: number) => result * 2)
      add(a: number, b: number) {
        return toThenable(a + b);
      }
    }

    await expect(new Calc().add(2, 3)).resolves.toBe(10);
  });

  it("preserves `this` binding in the decorated method", () => {
    class Calc {
      #offset = 100;

      @After((result: number) => result)
      add(a: number, b: number): number {
        return a + b + this.#offset;
      }
    }

    expect(new Calc().add(2, 3)).toBe(105);
  });

  it("propagates a throwing hook", () => {
    class Calc {
      @After(() => {
        throw new Error("after failed");
      })
      add(a: number, b: number): number {
        return a + b;
      }
    }

    expect(() => new Calc().add(2, 3)).toThrow("after failed");
  });

  it("propagates a throwing original method without calling the hook", () => {
    let called = false;

    class Calc {
      @After((result: number) => {
        called = true;
        return result;
      })
      add(): number {
        throw new Error("original failed");
      }
    }

    expect(() => new Calc().add()).toThrow("original failed");
    expect(called).toBe(false);
  });
});

describe("Around", () => {
  it("can short-circuit without calling next", () => {
    let called = false;

    class Calc {
      @Around(() => -1)
      add(a: number, b: number): number {
        called = true;
        return a + b;
      }
    }

    expect(new Calc().add(2, 3)).toBe(-1);
    expect(called).toBe(false);
  });

  it("can call next with different arguments", () => {
    class Calc {
      @Around((next: (a: number, b: number) => number, a: number, b: number) => next(a * 10, b * 10))
      add(a: number, b: number): number {
        return a + b;
      }
    }

    expect(new Calc().add(2, 3)).toBe(50);
  });

  it("keeps a sync method sync when the hook is sync", () => {
    class Calc {
      @Around((next: (a: number, b: number) => number, a: number, b: number) => next(a, b))
      add(a: number, b: number): number {
        return a + b;
      }
    }

    const result = new Calc().add(2, 3);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toBe(5);
  });

  it("wraps an async method", async () => {
    class Calc {
      @Around(async (next: (a: number, b: number) => Promise<number>, a: number, b: number) => {
        const result = await next(a, b);
        return result * 2;
      })
      async add(a: number, b: number): Promise<number> {
        return Promise.resolve(a + b);
      }
    }

    await expect(new Calc().add(2, 3)).resolves.toBe(10);
  });

  it("propagates an error thrown by the original through next()", () => {
    class Calc {
      @Around((next: () => number) => {
        try {
          return next();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`wrapped: ${message}`, { cause: error });
        }
      })
      add(): number {
        throw new Error("original failed");
      }
    }

    expect(() => new Calc().add()).toThrow("wrapped: original failed");
  });

  it("preserves `this` binding in the decorated method", () => {
    class Calc {
      #offset = 100;

      @Around((next: (a: number, b: number) => number, a: number, b: number) => next(a, b))
      add(a: number, b: number): number {
        return a + b + this.#offset;
      }
    }

    expect(new Calc().add(2, 3)).toBe(105);
  });
});

describe("stacking @Before, @After, and @Around on one method", () => {
  it("runs in the documented order — topmost decorator outermost", () => {
    const log: string[] = [];

    class Calc {
      @Before(() => {
        log.push("before");
        return undefined;
      })
      @After((result: number) => {
        log.push("after");
        return result;
      })
      @Around((next: () => number) => {
        log.push("around:start");
        const result = next();
        log.push("around:end");
        return result;
      })
      add(a: number, b: number): number {
        log.push("original");
        return a + b;
      }
    }

    const result = new Calc().add(2, 3);

    expect(result).toBe(5);
    // Bottom-most decorator (@Around) wraps the original first, so it's
    // innermost; @Before, written topmost, wraps everything below it and
    // so runs first overall.
    expect(log).toEqual(["before", "around:start", "original", "around:end", "after"]);
  });
});

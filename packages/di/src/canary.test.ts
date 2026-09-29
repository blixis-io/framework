import "reflect-metadata";
import { describe, expect, it } from "vitest";

function Injectable(): ClassDecorator {
  return () => {};
}

// Proves the toolchain (Vitest/Oxc here, tsc separately) actually emits
// design:paramtypes for a decorated class before any framework code is
// built on top of that assumption.
describe("toolchain canary: decorator metadata emission", () => {
  it("emits design:paramtypes for a constructor via a class decorator", () => {
    class Dep {}

    @Injectable()
    class Consumer {
      constructor(public dep: Dep) {}
    }

    const paramTypes: unknown = Reflect.getMetadata("design:paramtypes", Consumer);

    expect(paramTypes).toEqual([Dep]);
  });
});

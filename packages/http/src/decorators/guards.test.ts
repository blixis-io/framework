import { describe, expect, it } from "vitest";
import type { CanActivate } from "./guards.js";
import { getClassGuards, getMethodGuards, UseGuards } from "./guards.js";

class AuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

class RoleGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe("@UseGuards", () => {
  it("records guards applied at the class level", () => {
    @UseGuards(AuthGuard)
    class Controller {}

    expect(getClassGuards(Controller)).toEqual([AuthGuard]);
  });

  it("records guards applied at the method level, independently of class-level guards", () => {
    class Controller {
      @UseGuards(RoleGuard)
      protectedRoute(): void {}

      openRoute(): void {}
    }

    expect(getMethodGuards(Controller.prototype, "protectedRoute")).toEqual([RoleGuard]);
    expect(getMethodGuards(Controller.prototype, "openRoute")).toEqual([]);
  });

  it("accepts multiple guard classes in one call", () => {
    @UseGuards(AuthGuard, RoleGuard)
    class Controller {}

    expect(getClassGuards(Controller)).toEqual([AuthGuard, RoleGuard]);
  });

  it("a class with no @UseGuards has an empty class guard list", () => {
    class Plain {}

    expect(getClassGuards(Plain)).toEqual([]);
  });
});

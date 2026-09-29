import { describe, expect, it } from "vitest";
import { getModuleMetadata, isDynamicModule, Module, moduleClassOf } from "./module.js";

describe("@Module", () => {
  it("stores the module metadata as given", () => {
    class Service {}
    class Ctrl {}

    @Module({ providers: [Service], controllers: [Ctrl] })
    class AppModule {}

    expect(getModuleMetadata(AppModule)).toEqual({ providers: [Service], controllers: [Ctrl] });
  });

  it("defaults to empty metadata when called with no arguments", () => {
    @Module()
    class EmptyModule {}

    expect(getModuleMetadata(EmptyModule)).toEqual({});
  });

  it("an undecorated class has no module metadata", () => {
    class Plain {}

    expect(getModuleMetadata(Plain)).toBeUndefined();
  });
});

describe("isDynamicModule / moduleClassOf", () => {
  it("distinguishes a plain module class from a dynamic module object", () => {
    @Module()
    class PlainModule {}

    const dynamic = { module: PlainModule, providers: [] };

    expect(isDynamicModule(PlainModule)).toBe(false);
    expect(isDynamicModule(dynamic)).toBe(true);
  });

  it("extracts the underlying module class from either form", () => {
    @Module()
    class PlainModule {}

    expect(moduleClassOf(PlainModule)).toBe(PlainModule);
    expect(moduleClassOf({ module: PlainModule })).toBe(PlainModule);
  });
});

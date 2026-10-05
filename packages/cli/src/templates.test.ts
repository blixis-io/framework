import { describe, expect, it } from "vitest";
import { GENERATOR_TYPES, renderTemplate, resolveGeneratorType } from "./templates.js";

describe("resolveGeneratorType", () => {
  it.each(GENERATOR_TYPES)("resolves the full name %s to itself", (type) => {
    expect(resolveGeneratorType(type)).toBe(type);
  });

  it.each([
    ["c", "controller"],
    ["s", "service"],
    ["m", "module"],
    ["g", "guard"],
    ["i", "interceptor"],
  ])("resolves the alias %s to %s", (alias, type) => {
    expect(resolveGeneratorType(alias)).toBe(type);
  });

  it("returns undefined for an unknown type", () => {
    expect(resolveGeneratorType("bogus")).toBeUndefined();
  });
});

describe("renderTemplate", () => {
  it("controller: a @Controller class with one @Get route", () => {
    const output = renderTemplate("controller", "posts");
    expect(output).toContain('import { Controller, Get } from "@blixis-io/http";');
    expect(output).toContain('@Controller("posts")');
    expect(output).toContain("export class PostsController {");
  });

  it("service: a bare @Injectable class", () => {
    const output = renderTemplate("service", "posts");
    expect(output).toContain('import { Injectable } from "@blixis-io/di";');
    expect(output).toContain("export class PostsService {}");
  });

  it("module: a bare @Module class", () => {
    const output = renderTemplate("module", "posts");
    expect(output).toContain('import { Module } from "@blixis-io/core";');
    expect(output).toContain("export class PostsModule {}");
  });

  it("guard: a CanActivate implementation", () => {
    const output = renderTemplate("guard", "posts");
    expect(output).toContain('import type { CanActivate, ExecutionContext } from "@blixis-io/http";');
    expect(output).toContain("export class PostsGuard implements CanActivate {");
  });

  it("interceptor: an Interceptor implementation", () => {
    const output = renderTemplate("interceptor", "posts");
    expect(output).toContain('import type { ExecutionContext, Interceptor } from "@blixis-io/http";');
    expect(output).toContain("export class PostsInterceptor implements Interceptor {");
  });

  it("converts casing in both the class name and any kebab-case usage (controller path)", () => {
    const output = renderTemplate("controller", "post-tags");
    expect(output).toContain('@Controller("post-tags")');
    expect(output).toContain("export class PostTagsController {");
  });
});

describe("resolveGeneratorType: names that are keys of Object.prototype", () => {
  it.each(["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"])("%s is not a generator type", (name) => {
    expect(resolveGeneratorType(name)).toBeUndefined();
  });
});

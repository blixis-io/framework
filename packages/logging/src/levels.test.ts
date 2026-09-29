import { describe, expect, it } from "vitest";
import { isLevelEnabled, LOG_LEVELS, levelSeverity } from "./levels.js";

describe("LOG_LEVELS", () => {
  it("is ordered from least to most severe", () => {
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]);
  });
});

describe("levelSeverity", () => {
  it("gives higher numbers to more severe levels", () => {
    expect(levelSeverity("trace")).toBeLessThan(levelSeverity("debug"));
    expect(levelSeverity("debug")).toBeLessThan(levelSeverity("info"));
    expect(levelSeverity("info")).toBeLessThan(levelSeverity("warn"));
    expect(levelSeverity("warn")).toBeLessThan(levelSeverity("error"));
    expect(levelSeverity("error")).toBeLessThan(levelSeverity("fatal"));
  });
});

describe("isLevelEnabled", () => {
  it("is true when the level is at or above the threshold", () => {
    expect(isLevelEnabled("warn", "info")).toBe(true);
    expect(isLevelEnabled("info", "info")).toBe(true);
  });

  it("is false when the level is below the threshold", () => {
    expect(isLevelEnabled("debug", "info")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore } from "./memory-store.js";

describe("MemoryRateLimitStore", () => {
  it("counts hits within a window and reports when it ends", async () => {
    let now = 1_000;
    const store = new MemoryRateLimitStore({ now: () => now });

    expect(await store.hit("k", 10_000)).toEqual({ count: 1, resetAt: 11_000 });
    now = 4_000;
    expect(await store.hit("k", 10_000)).toEqual({ count: 2, resetAt: 11_000 });
  });

  it("starts a new window when the old one has ended", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore({ now: () => now });
    await store.hit("k", 1_000);
    await store.hit("k", 1_000);

    now = 1_000;

    expect(await store.hit("k", 1_000)).toEqual({ count: 1, resetAt: 2_000 });
  });

  it("counts keys separately", async () => {
    const store = new MemoryRateLimitStore();

    await store.hit("a", 60_000);
    await store.hit("a", 60_000);

    expect((await store.hit("b", 60_000)).count).toBe(1);
  });

  it("returns a snapshot, not its own record", async () => {
    const store = new MemoryRateLimitStore();
    const first = await store.hit("k", 60_000);
    first.count = 99;

    expect((await store.hit("k", 60_000)).count).toBe(2);
  });

  it("never holds more than maxKeys, dropping ended windows first and then the oldest", async () => {
    let now = 0;
    const store = new MemoryRateLimitStore({ maxKeys: 3, now: () => now });
    await store.hit("old", 100);
    await store.hit("b", 10_000);
    await store.hit("c", 10_000);

    now = 200; // "old" has ended
    await store.hit("d", 10_000);
    expect((await store.hit("b", 10_000)).count).toBe(2); // survived
    expect((await store.hit("old", 100)).count).toBe(1); // was dropped, starts again

    now = 300;
    await store.hit("e", 10_000); // full of live windows: the oldest ("b") goes
    expect((await store.hit("b", 10_000)).count).toBe(1);
  });

  it("copes with a flood of distinct keys without growing", async () => {
    const store = new MemoryRateLimitStore({ maxKeys: 50 });

    for (let index = 0; index < 5_000; index += 1) {
      await store.hit(`flood-${index}`, 60_000);
    }

    expect((await store.hit("flood-4999", 60_000)).count).toBe(2); // recent ones are kept
    expect((await store.hit("flood-0", 60_000)).count).toBe(1); // the first is long gone
  });
});

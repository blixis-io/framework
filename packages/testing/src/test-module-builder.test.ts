import { Module } from "@blixis/core";
import { Injectable } from "@blixis/di";
import { Controller, Get } from "@blixis/http";
import { describe, expect, it } from "vitest";
import { Test } from "./test-module-builder.js";

@Injectable()
class PostRepository {
  findAll(): string[] {
    return ["real-1", "real-2"];
  }
}

@Injectable()
class PostService {
  constructor(private readonly repo: PostRepository) {}

  list(): string[] {
    return this.repo.findAll();
  }
}

@Controller("posts")
class PostController {
  constructor(private readonly service: PostService) {}

  @Get()
  list() {
    return { items: this.service.list() };
  }
}

@Module({ providers: [PostRepository, PostService], controllers: [PostController] })
class PostsModule {}

describe("Test.createModule", () => {
  it("builds a real application from module metadata and serves requests via request()", async () => {
    const app = await Test.createModule({ imports: [PostsModule] }).compile();

    const res = await app.request("/posts");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ["real-1", "real-2"] });

    await app.close();
  });

  it("override() replaces a provider before resolution", async () => {
    const fakeRepo = { findAll: () => ["fake-1"] };

    const app = await Test.createModule({ imports: [PostsModule] })
      .override(PostRepository, { useValue: fakeRepo })
      .compile();

    const res = await app.request("/posts");

    expect(await res.json()).toEqual({ items: ["fake-1"] });
    expect(app.get(PostRepository)).toBe(fakeRepo);

    await app.close();
  });

  it("close() runs OnApplicationShutdown hooks", async () => {
    let closed = false;

    @Injectable()
    class Tracked {
      onApplicationShutdown(): void {
        closed = true;
      }
    }

    const app = await Test.createModule({ providers: [Tracked] }).compile();
    await app.close();

    expect(closed).toBe(true);
  });
});

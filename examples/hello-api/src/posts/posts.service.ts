import { Injectable } from "@blixis/di";
import { NotFoundException } from "@blixis/http";
import type { CreatePostInput, Post, UpdatePostInput } from "./post.schema.js";

@Injectable()
export class PostsService {
  readonly #posts = new Map<string, Post>();
  #nextId = 1;

  list(): Post[] {
    return [...this.#posts.values()];
  }

  get(id: string): Post {
    const post = this.#posts.get(id);
    if (!post) {
      throw new NotFoundException(`Post ${id} not found`);
    }
    return post;
  }

  create(input: CreatePostInput): Post {
    const id = String(this.#nextId++);
    const post: Post = { id, title: input.title, body: input.body, createdAt: new Date().toISOString() };
    this.#posts.set(id, post);
    return post;
  }

  update(id: string, input: UpdatePostInput): Post {
    const existing = this.get(id);
    const updated: Post = {
      ...existing,
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
    };
    this.#posts.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    this.get(id);
    this.#posts.delete(id);
  }
}

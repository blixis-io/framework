import { Inject, Injectable } from "@blixis/di";
import { NotFoundException, RequestContext } from "@blixis/http";
import { LOGGER, type Logger } from "@blixis/logging";
import type { CreatePostInput, Post, UpdatePostInput } from "./post.schema.js";

@Injectable()
export class PostsService {
  readonly #posts = new Map<string, Post>();
  #nextId = 1;

  constructor(
    @Inject(LOGGER) private readonly log: Logger,
    private readonly ctx: RequestContext,
  ) {}

  list(): Post[] {
    return [...this.#posts.values()];
  }

  get(id: string): Post {
    const post = this.#posts.get(id);
    if (!post) {
      this.log.warn("post not found", { postId: id });
      throw new NotFoundException(`Post ${id} not found`);
    }
    return post;
  }

  create(input: CreatePostInput): Post {
    const id = String(this.#nextId++);
    const post: Post = { id, title: input.title, body: input.body, createdAt: new Date().toISOString() };
    this.#posts.set(id, post);
    this.log.info("post created", { postId: id, title: post.title });
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
    // Only set on the guarded DELETE path — falls back to "unknown" for any
    // caller that reaches remove() outside a request (e.g. a future non-HTTP
    // entry point), rather than assuming the guard always ran.
    const apiClient = this.ctx.get<string>("apiClient") ?? "unknown";
    this.log.info("post deleted", { postId: id, apiClient });
  }
}

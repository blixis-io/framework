import type { OnModuleInit } from "@blixis/core";
import { Inject, Injectable } from "@blixis/di";
import { NotFoundException, RequestContext } from "@blixis/http";
import { LOGGER, type Logger } from "@blixis/logging";
import { eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/index.js";
import { posts } from "../db/schema.js";
import type { CreatePostInput, Post, UpdatePostInput } from "./post.schema.js";

@Injectable()
export class PostsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(LOGGER) private readonly log: Logger,
    private readonly ctx: RequestContext,
  ) {}

  /**
   * Stands in for a real migration until `drizzle-kit` is wired up — fine
   * for this example, not something a real app should do at boot.
   */
  async onModuleInit(): Promise<void> {
    await this.db.execute(sql`
      create table if not exists posts (
        id serial primary key,
        title text not null,
        body text not null default '',
        created_at timestamptz not null default now()
      )
    `);
  }

  async list(): Promise<Post[]> {
    const rows = await this.db.select().from(posts);
    return rows.map(toPost);
  }

  async get(id: string): Promise<Post> {
    const numericId = Number(id);
    const [row] = Number.isInteger(numericId) ? await this.db.select().from(posts).where(eq(posts.id, numericId)) : [];
    if (!row) {
      this.log.warn("post not found", { postId: id });
      throw new NotFoundException(`Post ${id} not found`);
    }
    return toPost(row);
  }

  async create(input: CreatePostInput): Promise<Post> {
    const [row] = await this.db.insert(posts).values({ title: input.title, body: input.body }).returning();
    // A successful single-row insert always returns that row.
    /* v8 ignore next -- @preserve */
    if (!row) {
      throw new Error("insert returned no row");
    }
    this.log.info("post created", { postId: String(row.id), title: row.title });
    return toPost(row);
  }

  async update(id: string, input: UpdatePostInput): Promise<Post> {
    const existing = await this.get(id);
    const [row] = await this.db
      .update(posts)
      .set({ title: input.title ?? existing.title, body: input.body ?? existing.body })
      .where(eq(posts.id, Number(id)))
      .returning();
    // `existing` already proved the row exists, so the update always returns it.
    /* v8 ignore next -- @preserve */
    if (!row) {
      throw new Error("update returned no row");
    }
    return toPost(row);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db.delete(posts).where(eq(posts.id, Number(id)));
    // Only set on the guarded DELETE path — falls back to "unknown" for any
    // caller that reaches remove() outside a request (e.g. a future non-HTTP
    // entry point), rather than assuming the guard always ran.
    const apiClient = this.ctx.get<string>("apiClient") ?? "unknown";
    this.log.info("post deleted", { postId: id, apiClient });
  }
}

function toPost(row: typeof posts.$inferSelect): Post {
  return { id: String(row.id), title: row.title, body: row.body, createdAt: row.createdAt.toISOString() };
}

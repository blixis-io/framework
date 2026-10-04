import { Command, Option } from "@blixis-io/commands";
import { PostsService } from "./posts.service.js";

/**
 * `blix run posts:seed --count 5`: creates sample posts through the real service, so the same
 * code (and the same `post.created` event) runs as for a request. `@Command` makes the class
 * injectable by itself.
 */
@Command({ name: "posts:seed", description: "Create sample posts" })
export class SeedPostsCommand {
  constructor(private readonly posts: PostsService) {}

  async run(@Option("count", { type: "number", default: 3, short: "n", description: "how many posts to create" }) count: number): Promise<number> {
    // One at a time on purpose: numbered titles and ids come out in order.
    for (let index = 1; index <= count; index++) {
      const post = await this.posts.create({ title: `Sample post ${index}`, body: "" });
      console.log(`created post ${post.id}: ${post.title}`);
    }
    return 0;
  }
}

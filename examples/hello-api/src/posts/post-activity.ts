import { Inject, Injectable } from "@blixis-io/di";
import { LOGGER, type Logger } from "@blixis-io/logging";
import { OnEvent, type AppEvents } from "../events.js";

/**
 * A listener declared with `@OnEvent`: no bus injected, no constructor wiring. The framework subscribes
 * these methods when the app boots, so register the class as a provider and it starts receiving events.
 */
@Injectable()
export class PostActivity {
  /** Recent activity, newest last. Kept in memory only; a real app might write an audit table instead. */
  readonly recent: string[] = [];

  constructor(@Inject(LOGGER) private readonly log: Logger) {}

  @OnEvent("post.created")
  created(event: AppEvents["post.created"]): void {
    this.record(`created ${event.postId}: ${event.title}`);
  }

  @OnEvent("post.deleted")
  deleted(event: AppEvents["post.deleted"]): void {
    this.record(`deleted ${event.postId}`);
  }

  private record(line: string): void {
    this.recent.push(line);
    this.log.info("post activity", { line });
  }
}

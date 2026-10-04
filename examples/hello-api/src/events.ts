import { defineEventsModule } from "@blixis-io/events";

/** A `type`, not an `interface`: an interface doesn't satisfy the generic's index-signature constraint. */
export type AppEvents = {
  "post.created": { postId: string; title: string };
  "post.deleted": { postId: string };
};

export const { EventsModule, EVENT_BUS, OnEvent } = defineEventsModule<AppEvents>();

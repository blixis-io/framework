import { createApplication, Module } from "@blixis-io/core";
import { Inject, Injectable, InjectionToken, type Provider } from "@blixis-io/di";
import { describe, expect, it, vi } from "vitest";
import { defineEventsModule } from "./module.js";

type Events = {
  "user.created": { id: string };
  "order.paid": { orderId: string; cents: number };
};

const { EventsModule, EVENT_BUS, OnEvent } = defineEventsModule<Events>();

async function boot(providers: Provider[]) {
  @Module({ imports: [EventsModule.forRoot({ global: true })], providers })
  class AppModule {}
  const app = await createApplication(AppModule);
  return { app, bus: app.get(EVENT_BUS) };
}

describe("@OnEvent", () => {
  it("subscribes the decorated method and calls it with the payload", async () => {
    const seen: string[] = [];

    @Injectable()
    class Welcome {
      @OnEvent("user.created")
      greet(payload: Events["user.created"]): void {
        seen.push(payload.id);
      }
    }

    const { bus } = await boot([Welcome]);
    await bus.emit("user.created", { id: "u1" });

    expect(seen).toEqual(["u1"]);
  });

  it("calls handlers with `this` bound to the provider, so injected dependencies work", async () => {
    const LOG = new InjectionToken<string[]>("log");
    const log: string[] = [];

    @Injectable()
    class Audit {
      constructor(@Inject(LOG) private readonly entries: string[]) {}

      @OnEvent("order.paid")
      record(payload: Events["order.paid"]): void {
        this.entries.push(`${payload.orderId}:${payload.cents}`);
      }
    }

    const { bus } = await boot([Audit, { provide: LOG, useValue: log }]);
    await bus.emit("order.paid", { orderId: "o1", cents: 500 });

    expect(log).toEqual(["o1:500"]);
  });

  it("supports several events on one class and several classes on one event", async () => {
    const calls: string[] = [];

    @Injectable()
    class A {
      @OnEvent("user.created")
      one(): void {
        calls.push("A.created");
      }

      @OnEvent("order.paid")
      two(): void {
        calls.push("A.paid");
      }
    }

    @Injectable()
    class B {
      @OnEvent("user.created")
      three(): void {
        calls.push("B.created");
      }
    }

    const { bus } = await boot([A, B]);
    await bus.emit("user.created", { id: "u" });
    await bus.emit("order.paid", { orderId: "o", cents: 1 });

    expect(calls.toSorted()).toEqual(["A.created", "A.paid", "B.created"]);
  });

  it("never calls a handler for a different event", async () => {
    const handler = vi.fn<(payload: Events["order.paid"]) => void>();

    @Injectable()
    class OnlyPaid {
      @OnEvent("order.paid")
      handle(payload: Events["order.paid"]): void {
        handler(payload);
      }
    }

    const { bus } = await boot([OnlyPaid]);
    await bus.emit("user.created", { id: "u" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("finds handlers declared on a base class", async () => {
    const seen: string[] = [];

    class Base {
      @OnEvent("user.created")
      base(payload: Events["user.created"]): void {
        seen.push(`base:${payload.id}`);
      }
    }

    @Injectable()
    class Child extends Base {
      @OnEvent("user.created")
      child(payload: Events["user.created"]): void {
        seen.push(`child:${payload.id}`);
      }
    }

    const { bus } = await boot([Child]);
    await bus.emit("user.created", { id: "u" });

    expect(seen.toSorted()).toEqual(["base:u", "child:u"]);
  });

  it("a subclass does not leak its handlers onto its parent", async () => {
    const seen: string[] = [];

    @Injectable()
    class Parent {
      @OnEvent("user.created")
      parent(): void {
        seen.push("parent");
      }
    }

    @Injectable()
    class Sibling extends Parent {
      @OnEvent("order.paid")
      extra(): void {
        seen.push("extra");
      }
    }

    const { bus } = await boot([Parent]);
    await bus.emit("order.paid", { orderId: "o", cents: 1 });

    expect(seen).toEqual([]);
    expect(Sibling).toBeDefined();
  });

  it("discovers handlers in providers of other modules", async () => {
    const seen: string[] = [];

    @Injectable()
    class Remote {
      @OnEvent("user.created")
      handle(payload: Events["user.created"]): void {
        seen.push(payload.id);
      }
    }

    @Module({ providers: [Remote] })
    class FeatureModule {}

    @Module({ imports: [EventsModule.forRoot({ global: true }), FeatureModule] })
    class AppModule {}
    const app = await createApplication(AppModule);

    await app.get(EVENT_BUS).emit("user.created", { id: "far" });

    expect(seen).toEqual(["far"]);
  });

  it("awaits an async handler, and one failing handler doesn't stop the others", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];

    @Injectable()
    class Slow {
      @OnEvent("user.created")
      async slow(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push("slow");
      }
    }

    @Injectable()
    class Broken {
      @OnEvent("user.created")
      broken(): void {
        throw new Error("handler blew up");
      }
    }

    const { bus } = await boot([Slow, Broken]);
    await bus.emit("user.created", { id: "u" });

    expect(seen).toEqual(["slow"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("attaches after boot: an event emitted during onModuleInit is not seen", async () => {
    const seen: string[] = [];

    @Injectable()
    class Listener {
      @OnEvent("user.created")
      handle(): void {
        seen.push("heard");
      }
    }

    @Injectable()
    class Early {
      constructor(@Inject(EVENT_BUS) private readonly bus: { emit(type: "user.created", payload: { id: string }): Promise<void> }) {}
      async onModuleInit(): Promise<void> {
        await this.bus.emit("user.created", { id: "too early" });
      }
    }

    await boot([Listener, Early]);

    expect(seen).toEqual([]);
  });

  it("unsubscribes everything when the application closes", async () => {
    const handler = vi.fn<() => void>();

    @Injectable()
    class Listener {
      @OnEvent("user.created")
      handle(): void {
        handler();
      }
    }

    const { app, bus } = await boot([Listener]);
    await bus.emit("user.created", { id: "a" });
    await app.close();
    await bus.emit("user.created", { id: "b" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails boot, naming the member, when @OnEvent is on something that isn't a method", async () => {
    @Injectable()
    class Wrong {
      notAMethod = 42;
    }
    OnEvent("user.created")(Wrong.prototype, "notAMethod", {});

    await expect(boot([Wrong])).rejects.toThrow('Wrong.notAMethod is decorated with @OnEvent("user.created") but is not a method.');
  });

  it("keeps two event maps separate", async () => {
    const other = defineEventsModule<{ ping: { n: number } }>();
    const seen: string[] = [];

    @Injectable()
    class Pinger {
      @other.OnEvent("ping")
      handle(): void {
        seen.push("ping");
      }
    }

    @Module({ imports: [other.EventsModule.forRoot(), EventsModule.forRoot()], providers: [Pinger] })
    class AppModule {}
    const app = await createApplication(AppModule);

    await app.get(other.EVENT_BUS).emit("ping", { n: 1 });

    expect(seen).toEqual(["ping"]);
  });

  it("is checked by the compiler: the method must accept the event's payload", () => {
    class Typed {
      // @ts-expect-error order.paid carries { orderId, cents }, not { id }
      @OnEvent("order.paid")
      wrong(_payload: { id: string }): void {}

      // @ts-expect-error "user.cread" is not an event in the map
      @OnEvent("user.cread")
      typo(): void {}

      @OnEvent("user.created")
      fine(_payload: { id: string }): void {}

      @OnEvent("user.created")
      noParams(): void {}
    }

    expect(Typed).toBeDefined();
  });
});

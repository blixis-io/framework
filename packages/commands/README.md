# `@blixis-io/commands`

Command-line tasks written as injectable classes, run with `blix run`. They get the same dependency injection as the rest of your app.

```bash
blix add run
```

```ts
import { Argument, Command, Option } from "@blixis-io/commands";

@Command({ name: "greet", description: "Greet someone" })
export class GreetCommand {
  constructor(private readonly hello: HelloService) {}

  run(
    @Argument("name", { required: true }) name: string,
    @Option("times", { type: "number", default: 1, short: "t" }) times: number,
  ): void {
    for (let i = 0; i < times; i++) console.log(this.hello.greet(name));
  }
}
```

```bash
blix run                       # list commands
blix run greet world -t 2
blix run greet --help
```

`@blixis-io/core`, `@blixis-io/di` and `@blixis-io/cli` are peer dependencies.

Part of [Blixis Framework](https://github.com/blixis-io/framework) — [Writing Commands](https://blixis-io.github.io/framework/guides/writing-commands/) · [Reference](https://blixis-io.github.io/framework/reference/blixis-commands/).

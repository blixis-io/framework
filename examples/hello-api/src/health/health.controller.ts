import { Controller, Get } from "@blixis/http";

// Generated with `blix generate controller health`, then hand-edited —
// the generator's job is a valid starting point, not the finished route.
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}

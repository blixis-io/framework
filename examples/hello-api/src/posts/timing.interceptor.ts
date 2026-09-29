import { Inject, Injectable } from "@blixis/di";
import type { ExecutionContext, Interceptor } from "@blixis/http";
import { LOGGER, type Logger } from "@blixis/logging";

@Injectable()
export class TimingInterceptor implements Interceptor {
  constructor(@Inject(LOGGER) private readonly log: Logger) {}

  async intercept(context: ExecutionContext, next: () => Promise<Response>): Promise<Response> {
    const start = performance.now();
    const response = await next();
    const ms = Math.round(performance.now() - start);
    const { method, url } = context.request;
    this.log.info("request handled", { method, path: new URL(url).pathname, status: response.status, ms });
    return response;
  }
}

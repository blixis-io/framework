import type { CaptureResult, Runner, Step } from "./types.js";

export interface FakeRunner extends Runner {
  ran: Step[];
  captured: string[];
}

/** Records steps instead of running them. `captures` maps `"cmd arg arg"` to a result; anything else exits 127 (command not found). */
export function fakeRunner(options: { captures?: Record<string, CaptureResult>; failStep?: string } = {}): FakeRunner {
  const ran: Step[] = [];
  const captured: string[] = [];
  return {
    ran,
    captured,
    run(step) {
      ran.push(step);
      return Promise.resolve(options.failStep === step.name ? 2 : 0);
    },
    capture(command, args) {
      const key = [command, ...args].join(" ");
      captured.push(key);
      return Promise.resolve(options.captures?.[key] ?? { code: 127, stdout: "" });
    },
  };
}

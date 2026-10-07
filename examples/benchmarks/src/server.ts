import type { DatabaseScenario } from "./database-scenarios.js";
import { SCENARIOS, startScenario, type Scenario } from "./scenarios.js";

// Named here, not imported from database-scenarios.ts: loading pg and drizzle only for the workloads that use them keeps
// the cold-start column of every other workload honest.
const DATABASE_SCENARIOS: readonly string[] = ["database-read", "database-write"];

/** `node dist/server.js <scenario>`: starts one workload, prints `READY <port> <json request>` when it is listening, and `CPU <microseconds>` on SIGUSR2. */
const isScenario = (value: string | undefined): value is Scenario => SCENARIOS.some((scenario) => scenario === value);
const isDatabaseScenario = (value: string | undefined): value is DatabaseScenario => DATABASE_SCENARIOS.includes(value ?? "");
const scenario = process.argv[2];
if (!isScenario(scenario) && !isDatabaseScenario(scenario)) {
  console.error(`usage: server.js <${[...SCENARIOS, ...DATABASE_SCENARIOS].join("|")}>`);
  process.exit(2);
}

const running = isDatabaseScenario(scenario) ? await (await import("./database-scenarios.js")).startDatabaseScenario(scenario) : await startScenario(scenario);
console.log(`READY ${running.port} ${JSON.stringify(running.request)}`);

// The benchmark asks for the process's CPU time (SIGUSR2) before and after a run: CPU per request is the cost of the
// server itself, which throughput is not, because a single-threaded load generator can be the slower side.
process.on("SIGUSR2", () => {
  const usage = process.cpuUsage();
  console.log(`CPU ${usage.user + usage.system}`);
});

process.on("SIGTERM", () => {
  void running.close().then(() => process.exit(0));
});

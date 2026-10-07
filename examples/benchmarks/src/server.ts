import { SCENARIOS, startScenario, type Scenario } from "./scenarios.js";

/** `node dist/server.js <scenario>`: starts one workload, prints `READY <port> <json request>` when it is listening, and `CPU <microseconds>` on SIGUSR2. */
const isScenario = (value: string | undefined): value is Scenario => SCENARIOS.some((scenario) => scenario === value);
const scenario = process.argv[2];
if (!isScenario(scenario)) {
  console.error(`usage: server.js <${SCENARIOS.join("|")}>`);
  process.exit(2);
}

const running = await startScenario(scenario);
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

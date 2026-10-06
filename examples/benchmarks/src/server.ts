import { SCENARIOS, startScenario, type Scenario } from "./scenarios.js";

/** `node dist/server.js <scenario>`: starts one workload, prints `READY <port> <json request>` when it is listening. */
const isScenario = (value: string | undefined): value is Scenario => SCENARIOS.some((scenario) => scenario === value);
const scenario = process.argv[2];
if (!isScenario(scenario)) {
  console.error(`usage: server.js <${SCENARIOS.join("|")}>`);
  process.exit(2);
}

const running = await startScenario(scenario);
console.log(`READY ${running.port} ${JSON.stringify(running.request)}`);

process.on("SIGTERM", () => {
  void running.close().then(() => process.exit(0));
});

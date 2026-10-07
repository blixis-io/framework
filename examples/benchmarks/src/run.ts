import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import autocannon from "autocannon";
import { DESCRIPTIONS, SCENARIOS, type Scenario } from "./scenarios.js";

/**
 * `pnpm --filter benchmarks bench`: drives each workload over real sockets and reports throughput, latency
 * percentiles, memory and cold start, with the environment, so a number is never separated from where it came from.
 *
 * Flags: `--duration <seconds>` (default 10), `--connections <n>` (default 64), `--only <scenario,...>`, `--cold <runs>` (default 5).
 *
 * Read the numbers with care. The load generator runs on the same machine as the server and competes with it for CPU,
 * so absolute figures are lower than a separate machine would show; compare scenarios with each other, and runs with
 * runs on the same machine, not machines with machines. "server CPU µs/request" is the server process's own CPU time
 * (`process.cpuUsage()` before and after the run) divided by the requests it answered: unlike throughput it does not
 * depend on how fast the load generator is, so it is the number to compare when changing the framework. There is no database and no network latency: this measures
 * the framework's own cost per request, which a database call will dwarf.
 */

const server = fileURLToPath(new URL("./server.js", import.meta.url));

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const duration = Number(flag("duration") ?? 10);
const connections = Number(flag("connections") ?? 64);
const coldRuns = Number(flag("cold") ?? 5);
const only = flag("only")?.split(",");
const scenarios = SCENARIOS.filter((scenario) => only === undefined || only.includes(scenario));

interface Started {
  child: ChildProcess;
  /** The server process's CPU time so far, in microseconds (it answers a SIGUSR2 with `CPU <n>`). */
  cpuMicroseconds: () => Promise<number>;
  port: number;
  request: { method: "GET" | "POST"; path: string; headers?: Record<string, string>; body?: string };
  startedAt: number;
  listeningAfterMs: number;
}

function start(scenario: Scenario): Promise<Started> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn("node", [server, scenario], { stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    let cpuWaiter: (() => void) | undefined;
    const cpuMicroseconds = async (): Promise<number> => {
      child.kill("SIGUSR2");
      for (;;) {
        const match = /CPU (\d+)\n/.exec(output);
        if (match?.[1]) {
          output = output.slice(match.index + match[0].length);
          return Number(match[1]);
        }
        await new Promise<void>((done) => {
          cpuWaiter = done;
        });
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      cpuWaiter?.();
      const match = /READY (\d+) (.+)\n/.exec(output);
      if (match?.[1] && match[2]) {
        output = output.slice(match.index + match[0].length);
        resolve({ child, cpuMicroseconds, port: Number(match[1]), request: JSON.parse(match[2]), startedAt, listeningAfterMs: performance.now() - startedAt });
      }
    });
    child.once("exit", (code) => reject(new Error(`${scenario} exited with ${code} before it was ready`)));
  });
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

/** Resident memory of a process, in MB, from `ps` (works on macOS and Linux). */
function rssMb(pid: number | undefined): number {
  const result = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
  return Math.round(Number(result.stdout.trim()) / 1024);
}

const median = (values: number[]): number => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function firstResponse(started: Started): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${started.port}${started.request.path}`, {
    method: started.request.method,
    ...(started.request.headers ? { headers: started.request.headers } : {}),
    ...(started.request.body === undefined ? {} : { body: started.request.body }),
  });
  if (!response.ok) {
    throw new Error(`the first request answered ${response.status}: the workload is not doing what it claims`);
  }
  return performance.now() - started.startedAt;
}

async function coldStart(scenario: Scenario): Promise<{ listening: number; firstResponse: number }> {
  const listening: number[] = [];
  const first: number[] = [];
  for (let run = 0; run < coldRuns; run += 1) {
    const started = await start(scenario);
    listening.push(started.listeningAfterMs);
    first.push(await firstResponse(started));
    await stop(started.child);
  }
  return { listening: median(listening), firstResponse: median(first) };
}

interface Row {
  scenario: Scenario;
  requestsPerSecond: number;
  /** CPU time the server process spent per request, in microseconds: the server's own cost, whatever the load generator could push. */
  cpuMicrosecondsPerRequest: number;
  p50: number;
  p97_5: number;
  p99: number;
  max: number;
  failures: number;
  rssMb: number;
  coldListeningMs: number;
  coldFirstResponseMs: number;
}

async function measure(scenario: Scenario): Promise<Row> {
  const cold = await coldStart(scenario);
  const started = await start(scenario);
  await firstResponse(started);
  const options = {
    url: `http://127.0.0.1:${started.port}${started.request.path}`,
    connections,
    method: started.request.method,
    ...(started.request.headers ? { headers: started.request.headers } : {}),
    ...(started.request.body === undefined ? {} : { body: started.request.body }),
  };
  await autocannon({ ...options, duration: 3 }); // warm up the JIT and the connections; not reported
  const cpuBefore = await started.cpuMicroseconds();
  const result = await autocannon({ ...options, duration });
  const cpuAfter = await started.cpuMicroseconds();
  const memory = rssMb(started.child.pid);
  await stop(started.child);
  return {
    scenario,
    requestsPerSecond: Math.round(result.requests.average),
    cpuMicrosecondsPerRequest: (cpuAfter - cpuBefore) / result.requests.total,
    p50: result.latency.p50,
    p97_5: result.latency.p97_5,
    p99: result.latency.p99,
    max: result.latency.max,
    failures: result.errors + result.timeouts + result.non2xx,
    rssMb: memory,
    coldListeningMs: Math.round(cold.listening),
    coldFirstResponseMs: Math.round(cold.firstResponse),
  };
}

const rows: Row[] = [];
for (const scenario of scenarios) {
  console.error(`measuring ${scenario} ...`);
  rows.push(await measure(scenario));
}

const model = cpus()[0]?.model ?? "unknown CPU";
console.log(`## Environment

- ${model}, ${cpus().length} logical cores, ${Math.round(totalmem() / 1024 ** 3)} GB RAM
- ${platform()} ${release()}, Node ${process.version}
- load generator: autocannon on the same machine, ${connections} connections, ${duration} s measured after a 3 s warm-up
- ${new Date().toISOString().slice(0, 10)}

## Results

| scenario | req/s | server CPU µs/request | p50 ms | p97.5 ms | p99 ms | max ms | failures | RSS MB | cold: listening ms | cold: first response ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.map((row) => `| ${row.scenario} | ${row.requestsPerSecond.toLocaleString("en-US")} | ${row.cpuMicrosecondsPerRequest.toFixed(1)} | ${row.p50} | ${row.p97_5} | ${row.p99} | ${row.max} | ${row.failures} | ${row.rssMb} | ${row.coldListeningMs} | ${row.coldFirstResponseMs} |`).join("\n")}

${rows.map((row) => `- **${row.scenario}**: ${DESCRIPTIONS[row.scenario]}`).join("\n")}
`);

if (rows.some((row) => row.failures > 0)) {
  console.error("some requests failed: the numbers above are not trustworthy");
  process.exitCode = 1;
}

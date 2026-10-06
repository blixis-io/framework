// Proves a stranger's first hour works with what this repository would publish: packs every package, scaffolds an app
// with the real `create-blixis`, installs the packed tarballs into it with a real package manager, builds it,
// starts it, calls it, runs `blix doctor`, and stops it. No workspace links and no source aliases are involved, so
// a missing file, a wrong `exports` entry, a peer range nothing satisfies or lost decorator metadata fails here and
// not on a user's machine.
//
//   node scripts/fresh-install.mjs [--pm pnpm|npm] [--keep]
//
// Needs the repository built (`pnpm run build`). Dependency-free, and written to run on Linux, macOS and Windows.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const pm = args.includes("--pm") ? args[args.indexOf("--pm") + 1] : "npm";
if (pm !== "pnpm" && pm !== "npm") {
  fail(`--pm must be pnpm or npm (got ${pm})`);
}
const windows = process.platform === "win32";

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function step(message) {
  console.log(`\n=== ${message}`);
}

/** Runs a command to completion, streaming its output, and returns its stdout. */
function run(command, commandArgs, options = {}) {
  console.log(`$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    // `.cmd` shims on Windows (npm, pnpm, npx) can't be spawned without a shell.
    shell: windows,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    fail(`\`${command} ${commandArgs.join(" ")}\` exited with ${result.status ?? result.signal}`);
  }
  return result.stdout;
}

const version = (command) => spawnSync(command, ["--version"], { encoding: "utf8", shell: windows }).stdout.trim();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The long path: on Windows `tmpdir()` can be an 8.3 short name (`RUNNER~1`), and pnpm then sees one directory under two names.
const work = mkdtempSync(join(realpathSync.native(tmpdir()), "blixis-fresh-"));
console.log(`working in ${work}`);

try {
  const packages = readdirSync(join(root, "packages"))
    .map((dir) => ({ dir: join(root, "packages", dir), manifest: join(root, "packages", dir, "package.json") }))
    .filter(({ manifest }) => existsSync(manifest))
    .map(({ dir, manifest }) => ({ dir, ...JSON.parse(readFileSync(manifest, "utf8")) }))
    .filter((pkg) => !pkg.private);
  for (const pkg of packages) {
    if (!existsSync(join(pkg.dir, "dist"))) {
      fail(`${pkg.name} has no dist/. Run \`pnpm run build\` first.`);
    }
  }

  step(`pack ${packages.length} packages`);
  const tarballs = join(work, "tarballs");
  mkdirSync(tarballs);
  for (const pkg of packages) {
    // pnpm pack, not npm pack: it rewrites `workspace:` ranges to real versions, as publishing does.
    run("pnpm", ["pack", "--pack-destination", tarballs], { cwd: pkg.dir });
  }
  const tarball = (name) => {
    const file = `${name.replace(/^@/, "").replace("/", "-")}-${packages.find((pkg) => pkg.name === name).version}.tgz`;
    const path = join(tarballs, file);
    if (!existsSync(path)) {
      fail(`expected ${path} after packing ${name}`);
    }
    return path;
  };

  step("scaffold an app with the real create-blixis");
  const agent = `${pm}/${version(pm)} node/${process.version}`;
  run("node", [join(root, "packages", "create-blixis", "dist", "index.js"), "app", "--no-install"], {
    cwd: work,
    env: { npm_config_user_agent: agent },
  });
  const app = join(work, "app");

  step(`install the packed packages with ${pm}`);
  const runtime = ["core", "di", "http"].map((name) => tarball(`@blixis-io/${name}`));
  const tools = ["cli"].map((name) => tarball(`@blixis-io/${name}`));
  if (pm === "pnpm") {
    run("pnpm", ["add", ...runtime, "zod"], { cwd: app });
    run("pnpm", ["add", "-D", ...tools, "typescript", "@types/node", "concurrently"], { cwd: app });
  } else {
    run("npm", ["install", ...runtime, "zod"], { cwd: app });
    run("npm", ["install", "-D", ...tools, "typescript", "@types/node", "concurrently"], { cwd: app });
  }

  step("build (tsc against the packed type declarations)");
  run(pm, pm === "npm" ? ["run", "build"] : ["build"], { cwd: app });

  step("blix doctor");
  run(pm === "npm" ? "npx" : "pnpm", pm === "npm" ? ["blix", "doctor"] : ["exec", "blix", "doctor"], { cwd: app });

  step("start, call, stop");
  const port = await freePort();
  const child = spawn("node", ["dist/main.js"], { cwd: app, env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

  try {
    for (let waited = 0; !output.includes("Listening on"); waited += 100) {
      if (waited > 20_000) {
        fail(`the app did not start within 20 s. Output:\n${output}`);
      }
      await sleep(100);
    }

    const hello = await fetch(`http://127.0.0.1:${port}/hello/world`);
    const body = await hello.text();
    if (hello.status !== 200 || body !== '{"message":"Hello, world!"}') {
      fail(`GET /hello/world answered ${hello.status} ${body}`);
    }
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    if (missing.status !== 404 || !missing.headers.get("content-type")?.startsWith("application/problem+json")) {
      fail(`GET /nope answered ${missing.status} ${missing.headers.get("content-type")}`);
    }
    console.log("GET /hello/world -> 200, GET /nope -> 404 problem+json");

    if (windows) {
      // Windows has no SIGTERM to deliver: kill() ends the process outright, so the graceful path can't be checked here.
      child.kill();
      console.log("stopped (graceful shutdown is not checked on Windows)");
    } else {
      child.kill("SIGTERM");
      const result = await Promise.race([exited, sleep(10_000).then(() => "timeout")]);
      if (result === "timeout") {
        fail("the app did not exit within 10 s of SIGTERM");
      }
      if (result.code !== 0) {
        fail(`the app exited with ${result.code ?? result.signal} after SIGTERM, not 0. Output:\n${output}`);
      }
      console.log("SIGTERM -> exit 0");
    }
  } finally {
    child.kill("SIGKILL");
  }

  console.log(`\nOK: ${pm}, ${process.platform}, node ${process.version}`);
} finally {
  if (keep || process.exitCode) {
    console.log(`\nkept ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}

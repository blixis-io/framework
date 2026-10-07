// Proves that `examples/saas-api` ships as a container: builds the image from a copy of the example that sits outside
// this repository (packages installed from tarballs packed here, as in `upgrade-path`), then runs it against a real
// Postgres in a private Docker network. It applies the migrations with the image itself, twice, boots the app, signs a
// user up and calls an authenticated route through the published port, checks the container does not run as root, and
// stops it with SIGTERM and expects the graceful exit.
//
//   node scripts/docker-image.mjs [--keep]
//
// Needs the repository built (`pnpm run build`) and a running Docker daemon.
import { randomBytes } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, materialize, packPackages, quiet, run, step } from "./lib/standalone.mjs";

const keep = process.argv.includes("--keep");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = randomBytes(4).toString("hex");
const network = `blixis-check-${suffix}`;
const database = `blixis-check-db-${suffix}`;
const container = `blixis-check-app-${suffix}`;
const image = `blixis-saas-api-check:${suffix}`;
const environment = ["-e", "DATABASE_URL=postgres://blixis:blixis@" + database + ":5432/blixis", "-e", `JWT_SECRET=${randomBytes(48).toString("base64")}`];

if (quiet("docker", ["info"]).status !== 0) {
  fail("the Docker daemon is not reachable (`docker info` failed)");
}

const work = mkdtempSync(join(realpathSync.native(tmpdir()), "blixis-docker-"));
console.log(`working in ${work}`);

try {
  step("pack every public package and copy the example out of the repository");
  const packed = packPackages(work);
  const app = join(work, "app");
  materialize({ source: new URL("../examples/saas-api", import.meta.url).pathname, app, packed });
  run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"], { cwd: app });

  step("docker build");
  run("docker", ["build", "--tag", image, app]);

  step("start Postgres in a private network");
  run("docker", ["network", "create", network]);
  run("docker", ["run", "--detach", "--name", database, "--network", network, "-e", "POSTGRES_USER=blixis", "-e", "POSTGRES_PASSWORD=blixis", "-e", "POSTGRES_DB=blixis", "postgres:18-alpine"]);
  for (let waited = 0; ; waited += 500) {
    if (quiet("docker", ["exec", database, "pg_isready", "-U", "blixis", "-h", "127.0.0.1"]).status === 0) {
      break;
    }
    if (waited > 60_000) {
      fail("Postgres did not become ready within 60 s");
    }
    await sleep(500);
  }

  step("migrate with the image itself, twice");
  const migrate = () => run("docker", ["run", "--rm", "--network", network, ...environment, image, "npx", "blix", "run", "db:migrate"]).stdout;
  if (!migrate().includes("applied: 0001_init.sql")) {
    fail("the first run did not apply 0001_init.sql");
  }
  if (!migrate().includes("database is up to date")) {
    fail("the second run was not a no-op");
  }

  step("start the app, call it, stop it");
  run("docker", ["run", "--detach", "--name", container, "--network", network, "--publish", "127.0.0.1::3000", ...environment, image]);
  const mapping = quiet("docker", ["port", container, "3000/tcp"]).stdout.trim().split("\n")[0];
  const base = `http://${mapping}`;
  console.log(`published at ${base}`);

  for (let waited = 0; ; waited += 250) {
    const ready = await fetch(`${base}/readyz`).then(
      (response) => response.status,
      () => 0,
    );
    if (ready === 200) {
      break;
    }
    if (waited > 30_000) {
      fail(`/readyz did not answer 200 within 30 s (last: ${ready}). Logs:\n${quiet("docker", ["logs", container]).stdout}`);
    }
    await sleep(250);
  }
  const live = await fetch(`${base}/livez`);
  if (live.status !== 200) {
    fail(`/livez answered ${live.status}`);
  }

  const signUp = await fetch(`${base}/auth/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `check-${suffix}@example.com`, password: "correct horse battery", organizationName: "Check" }),
  });
  const tokens = await signUp.json();
  if (signUp.status >= 300 || typeof tokens.accessToken !== "string") {
    fail(`POST /auth/sign-up answered ${signUp.status} ${JSON.stringify(tokens)}`);
  }
  const me = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
  if (me.status !== 200) {
    fail(`GET /me with the new access token answered ${me.status}`);
  }
  const anonymous = await fetch(`${base}/me`);
  if (anonymous.status !== 401) {
    fail(`GET /me without a token answered ${anonymous.status}, not 401`);
  }
  const openapi = await fetch(`${base}/openapi.json`);
  if (openapi.status !== 200) {
    fail(`GET /openapi.json answered ${openapi.status}`);
  }
  console.log("livez 200, readyz 200, sign-up ok, /me 200 with a token and 401 without, openapi 200");

  const user = quiet("docker", ["exec", container, "id", "-u"]).stdout.trim();
  if (user === "0" || user === "") {
    fail(`the container runs as uid "${user}", expected a non-root user`);
  }
  console.log(`runs as uid ${user}`);

  const started = Date.now();
  run("docker", ["stop", "--timeout", "20", container]);
  const exit = quiet("docker", ["inspect", "--format", "{{.State.ExitCode}}", container]).stdout.trim();
  const logs = quiet("docker", ["logs", container]);
  if (exit !== "0") {
    fail(`the container exited with ${exit} after SIGTERM, not 0. Logs:\n${logs.stdout}${logs.stderr}`);
  }
  if (!(logs.stdout + logs.stderr).includes("SIGTERM: draining")) {
    fail(`the logs do not show the app draining on SIGTERM:\n${logs.stdout}${logs.stderr}`);
  }
  console.log(`SIGTERM -> draining -> exit 0 after ${((Date.now() - started) / 1000).toFixed(1)} s`);

  console.log("\nOK: the saas-api image builds, migrates, serves, runs as non-root and stops gracefully");
} finally {
  if (keep) {
    console.log(`\nkept ${work}, image ${image}, network ${network}`);
  } else {
    for (const name of [container, database]) {
      quiet("docker", ["rm", "--force", name]);
    }
    quiet("docker", ["network", "rm", network]);
    quiet("docker", ["image", "rm", "--force", image]);
    rmSync(work, { recursive: true, force: true });
  }
}

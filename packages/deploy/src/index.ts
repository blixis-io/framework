import type { BlixCommand } from "@blixis-io/cli";
import { runDeploy, USAGE } from "./commands.js";
import { processRunner } from "./runner.js";

export { bitbucketPipelines, ciProviderFor, CI_PROVIDER_IDS, githubActions, gitlabCi, type CiProvider, type CiRenderOptions } from "./ci.js";
export {
  defineDeployConfig,
  DeployConfigError,
  parseDeployConfig,
  selectTarget,
  type DeployConfig,
  type DeployConfigInput,
  type DockerTarget,
  type NetlifyTarget,
  type Target,
  type VercelTarget,
} from "./config.js";
export { renderDockerfile, DockerfileError } from "./dockerfile.js";
export { formatStep, processRunner } from "./runner.js";
export {
  adapterFor,
  dockerAdapter,
  initPlanFor,
  isTargetType,
  netlifyAdapter,
  TARGET_TYPES,
  vercelAdapter,
  type BoundAdapter,
  type CiRequirements,
  type InitContext,
  type InitFile,
  type InitOptions,
  type InitPlan,
  type Phase,
  type PlanContext,
  type TargetAdapter,
  type TargetPlan,
  type TargetType,
} from "./targets.js";
export { imageFromRemote, registryHostOf } from "./docker.js";
export type { CaptureResult, Env, Runner, Step } from "./types.js";
export { runDeploy, type DeployDeps } from "./commands.js";

/** What `blix deploy` loads. */
export const blixCommand: BlixCommand = {
  name: "deploy",
  description: "build and deploy",
  run(context) {
    if (context.args.length === 0 && !context.config) {
      return { exitCode: 0, stdout: USAGE, stderr: "" };
    }
    return runDeploy(context, {
      runner: processRunner,
      env: process.env,
      log: (line) => {
        process.stdout.write(line);
      },
    });
  },
};

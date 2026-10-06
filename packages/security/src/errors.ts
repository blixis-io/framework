/** A middleware was configured with something that cannot work securely. Thrown when it is created, so it fails at boot. */
export class SecurityConfigError extends Error {
  override readonly name = "SecurityConfigError";
}

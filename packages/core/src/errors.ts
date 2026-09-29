export class CoreError extends Error {
  override readonly name: string = "CoreError";
}

export class NotAModuleError extends CoreError {
  override readonly name = "NotAModuleError";

  constructor(target: { name: string }) {
    super(`${target.name} is not a module — did you forget @Module()?`);
  }
}

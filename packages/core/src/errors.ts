export class CoreError extends Error {
  override readonly name: string = "CoreError";
}

export class NotAModuleError extends CoreError {
  override readonly name = "NotAModuleError";

  constructor(target: { name: string }) {
    super(`${target.name} is not a module — did you forget @Module()?`);
  }
}

export class ProviderNotVisibleError extends CoreError {
  override readonly name = "ProviderNotVisibleError";

  constructor(consumerName: string, tokenLabel: string, owningModuleName: string) {
    super(
      `${consumerName} depends on ${tokenLabel}, but that belongs to ${owningModuleName}, which doesn't export it. ` +
        `Add it to ${owningModuleName}'s exports, or import ${owningModuleName} into ${consumerName}'s own module.`,
    );
  }
}

export class DuplicateDynamicModuleError extends CoreError {
  override readonly name = "DuplicateDynamicModuleError";

  constructor(target: { name: string }) {
    super(
      `${target.name} is registered more than once with different dynamic configurations, and a module can only be instantiated once per application. ` +
        `Import a single registration (reuse the same ${target.name}.forRoot(...) result), or split the configurations into separate module classes.`,
    );
  }
}

/** Splits `posts`, `post-tags`, `PostTags`, and `post_tags` all into `["post", "tags"]`. */
function toWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function toKebabCase(input: string): string {
  return toWords(input).join("-");
}

export function toPascalCase(input: string): string {
  return toWords(input)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** A name that can't be turned into a file name and a TypeScript class name. The message says what to change. */
export class InvalidNameError extends Error {
  override readonly name = "InvalidNameError";
}

/**
 * The kebab-case file name and PascalCase class name for a generator `input`, or an `InvalidNameError`. Rejected
 * rather than guessed at: a leading digit would give `export class 123Controller` (not valid TypeScript), nothing
 * but punctuation leaves no name at all, and non-ASCII letters would otherwise be dropped without a word
 * (`café` would become `caf`, `Ünïcode` would become `n-code`).
 */
export function parseName(input: string): { kebab: string; pascal: string } {
  if (Array.from(input).some((char) => (char.codePointAt(0) ?? 0) > 0x7f)) {
    throw new InvalidNameError(`"${input}" contains non-ASCII characters, which can't be used in a file or class name. Use ASCII letters and digits (for example "cafe" for "café").`);
  }
  const kebab = toKebabCase(input);
  if (kebab === "") {
    throw new InvalidNameError(`"${input}" has no letters or digits to name a file or class after.`);
  }
  const pascal = toPascalCase(input);
  if (/^[0-9]/.test(pascal)) {
    throw new InvalidNameError(`"${input}" would give the class name "${pascal}...", which starts with a digit and isn't valid TypeScript: the name must start with a letter.`);
  }
  return { kebab, pascal };
}

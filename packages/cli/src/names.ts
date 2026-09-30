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

// Checks every internal link in the docs (`/framework/...`), and its #anchor, against the pages and headings that
// exist. Dependency-free on purpose: it runs in CI before anything is built.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../docs/src/content/docs/", import.meta.url));
const BASE = "/framework/";

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.mdx?$/.test(name) ? [path] : [];
  });
}

/** The anchor Starlight (github-slugger) gives a heading: inline markdown removed, lower-cased, punctuation dropped, spaces to hyphens. */
function slug(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const pages = new Map(); // "concepts/modules" -> Set of anchors
const sources = new Map(); // file -> text
for (const file of files(ROOT)) {
  const text = readFileSync(file, "utf8");
  sources.set(file, text);
  const key = relative(ROOT, file).replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    const heading = !inFence && /^#{1,6}\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      const base = slug(heading[1]);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
  }
  pages.set(key, anchors);
}

const broken = [];
let checked = 0;
for (const [file, text] of sources) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/\]\((\/framework\/[^)\s]*)\)/g)) {
      checked += 1;
      const [path = "", anchor] = match[1].slice(BASE.length).split("#");
      const key = path.replace(/\/$/, "");
      const anchors = pages.get(key);
      if (!anchors) {
        broken.push(`${relative(ROOT, file)}:${index + 1}: no page "${key}" for ${match[1]}`);
      } else if (anchor && !anchors.has(anchor)) {
        broken.push(`${relative(ROOT, file)}:${index + 1}: page "${key}" has no heading "#${anchor}"`);
      }
    }
  });
}

if (broken.length > 0) {
  console.error(`${broken.length} broken docs link${broken.length === 1 ? "" : "s"} (of ${checked} checked):\n${broken.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log(`docs links ok: ${checked} internal links checked across ${pages.size} pages`);

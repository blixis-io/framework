import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { stripJsonc } from "./doctor.js";

/**
 * `blix doctor` reads `tsconfig.json`, which is JSONC: comments and trailing commas allowed. `stripJsonc` makes it
 * `JSON.parse`-able. It is a hand-written scanner, so these properties throw generated JSON at it with comments and
 * trailing commas put everywhere a real file would have them, and check the value comes out unchanged.
 */

/** Comment bodies, including ones that look like the things the scanner must not be fooled by. */
const lineComments = fc.constantFrom('// plain', '// "an unbalanced quote', "// it's /* not a block", "// trailing comma , ]", "//");
const blockComments = fc.constantFrom("/* plain */", '/* "quoted" // not a line comment */', "/* , ] } */", "/**/", "/* multi\nline */");

interface Decoration {
  before: string;
  after: string;
}

const decoration = fc.record({
  before: fc.oneof(fc.constant(""), blockComments.map((comment) => `${comment} `)),
  after: fc.oneof(fc.constant(""), lineComments.map((comment) => ` ${comment}`), blockComments.map((comment) => ` ${comment}`)),
});

/** Pretty-prints `value`, then decorates each line with comments and adds trailing commas where a JSONC file may have them. */
function decorate(value: unknown, decorations: readonly Decoration[], trailingCommas: boolean): string {
  const lines = JSON.stringify(value, null, 2).split("\n");
  return lines
    .map((line, index) => {
      const next = lines[index + 1]?.trim();
      const closesNext = next !== undefined && (next.startsWith("}") || next.startsWith("]"));
      const opensHere = line.endsWith("{") || line.endsWith("[");
      const comma = trailingCommas && closesNext && !opensHere && !line.endsWith(",") ? "," : "";
      const decorated = decorations[index % Math.max(decorations.length, 1)] ?? { before: "", after: "" };
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      const body = line.slice(indent.length);
      // A line comment swallows the rest of the line, so a comma has to come before it.
      return `${indent}${decorated.before}${body}${comma}${decorated.after}`;
    })
    .join("\n");
}

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("stripJsonc", () => {
  it("leaves the value of any JSON document unchanged when comments are put at the start and end of every line", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(decoration, { minLength: 1, maxLength: 8 }), (value, decorations) => {
        expect(JSON.parse(stripJsonc(decorate(value, decorations, false)))).toEqual(roundTrip(value));
      }),
      { numRuns: 2000 },
    );
  });

  it("also removes trailing commas before a closing bracket", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(decoration, { minLength: 1, maxLength: 8 }), (value, decorations) => {
        expect(JSON.parse(stripJsonc(decorate(value, decorations, true)))).toEqual(roundTrip(value));
      }),
      { numRuns: 2000 },
    );
  });

  it("does not touch what is inside a string, however much it looks like a comment or a trailing comma", () => {
    const lookalike = fc.array(fc.constantFrom("//", "/*", "*/", ",", "]", "}", '\\"', "\\\\", " ", "x", "\n", "http://a//b"), { maxLength: 12 }).map((parts) => parts.join(""));
    fc.assert(
      fc.property(lookalike, (text) => {
        const document = `{\n  "value": ${JSON.stringify(text)},\n  "list": [${JSON.stringify(text)},],\n}`;

        expect(JSON.parse(stripJsonc(document))).toEqual({ value: text, list: [text] });
      }),
      { numRuns: 2000 },
    );
  });

  it("is the identity on JSON that has no comments or trailing commas", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = JSON.stringify(value, null, 2);

        expect(stripJsonc(text)).toBe(text);
      }),
      { numRuns: 1500 },
    );
  });

  it("never throws, and always returns a string, whatever it is given", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary-ascii", maxLength: 80 }), (text) => {
        expect(typeof stripJsonc(text)).toBe("string");
      }),
      { numRuns: 3000 },
    );
  });

  it("is stable: stripping an already stripped document changes nothing", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.array(decoration, { minLength: 1, maxLength: 8 }), (value, decorations) => {
        const once = stripJsonc(decorate(value, decorations, true));

        expect(stripJsonc(once)).toBe(once);
      }),
      { numRuns: 1000 },
    );
  });
});

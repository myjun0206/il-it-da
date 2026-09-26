// Node ESM "resolve" hook (module customization hook, see node:module `register`) that maps
// the "@/*" TypeScript path alias (tsconfig.json `paths: { "@/*": ["./*"] }`) to real file URLs
// under the repo root. This exists only so tests can `node --test` a production module that
// still imports a same-repo sibling via "@/..." (only Next.js's webpack/tsc understand that
// alias; plain `node --test` does not). It never changes what gets loaded - same file, same
// contents - it only teaches Node how to find it. No production code or behavior is touched.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const rest = specifier.slice(2);
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = path.join(repoRoot, `${rest}${suffix}`);
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }

  return nextResolve(specifier, context);
}

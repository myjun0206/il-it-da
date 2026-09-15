import path from "node:path";
import { pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  if (specifier === "server-only") {
    return {
      format: "module",
      shortCircuit: true,
      url: "data:text/javascript,export default {}",
    };
  }
  if (specifier.startsWith("@/")) {
    const relativePath = specifier.slice(2);
    const resolvedPath = path.resolve(process.cwd(), relativePath);
    return nextResolve(pathToFileURL(resolvedPath + ".ts").href, context);
  }
  return nextResolve(specifier, context);
}

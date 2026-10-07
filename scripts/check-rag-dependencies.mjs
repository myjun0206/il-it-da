import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const requiredModules = [
  "typescript",
  "xlsx",
  "csv-parse/sync",
  "@supabase/ssr",
  "@supabase/supabase-js",
  "next",
];
const missing = requiredModules.filter((moduleName) => {
  try {
    require.resolve(moduleName);
    return false;
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") return true;
    throw error;
  }
});

if (missing.length > 0) {
  console.error(`[RAG dependencies] Missing modules: ${missing.join(", ")}. Run npm install at the project root, then rerun npm run test:rag. Unit tests do not require live Supabase or OpenAI credentials.`);
  process.exitCode = 1;
}
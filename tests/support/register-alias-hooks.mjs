// Registers alias-hooks.mjs as a Node module customization hook so test files can be run
// with `node --import ./tests/support/register-alias-hooks.mjs --test <files>`.
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requirePackage = createRequire(import.meta.url);

export function loadComponentModule<ModuleExports>(relativePath: string, overrides: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): ModuleExports {
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(filename: string) {
    const cached = cache.get(filename);
    if (cached) return cached.exports;
    const compiledModule = { exports: {} as Record<string, unknown> };
    cache.set(filename, compiledModule);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    }).outputText;
    const localRequire = (specifier: string): unknown => {
      if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return requirePackage(specifier);
      const resolved = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
      for (const suffix of ["", ".tsx", ".ts", "/index.ts"]) {
        try {
          return load(`${resolved}${suffix}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          cache.delete(`${resolved}${suffix}`);
        }
      }
      throw new Error(`Unresolved test module: ${specifier}`);
    };
    runInNewContext(compiled, {
      module: compiledModule, exports: compiledModule.exports, require: localRequire, console, URL, AbortController,
      fetch: () => { throw new Error("Unexpected network request in component test"); },
      ...globals,
    }, { filename });
    return compiledModule.exports;
  }
  return load(path.join(root, relativePath)) as ModuleExports;
}

export function createHookHarness(initialStates: unknown[]) {
  const states = [...initialStates];
  let cursor = 0;
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (update: unknown) => {
        states[index] = typeof update === "function" ? update(states[index]) : update;
      }];
    },
    useEffect() {},
    useLayoutEffect() {},
    useMemo(factory: () => unknown) { return factory(); },
    useSyncExternalStore<Snapshot>(_subscribe: (callback: () => void) => () => void, getSnapshot: () => Snapshot) {
      return getSnapshot();
    },
  };
  return {
    react,
    render(component: () => React.ReactNode) {
      cursor = 0;
      return component();
    },
  };
}

export function componentElements(tree: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  const elements: React.ReactElement<Record<string, unknown>>[] = [];
  function visit(node: React.ReactNode) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!React.isValidElement<Record<string, unknown>>(node)) return;
    elements.push(node);
    visit(node.props.children as React.ReactNode);
  }
  visit(tree);
  return elements;
}
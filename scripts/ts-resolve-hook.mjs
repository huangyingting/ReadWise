// ESM resolve hook so the scraper CLI can reuse the app's TypeScript modules.
// Maps the `@/*` path alias to ./src/* and resolves extensionless relative
// imports to their `.ts`/`.tsx`/`index.ts` files (Node's type-stripping loader
// otherwise requires explicit extensions). Only used by `npm run scrape`.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(projectRoot, "src");

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"];

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function tryFileVariants(absPath) {
  if (isFile(absPath)) {
    return pathToFileURL(absPath).href;
  }
  for (const ext of EXTENSIONS) {
    const candidate = absPath + ext;
    if (isFile(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  for (const ext of EXTENSIONS) {
    const candidate = path.join(absPath, "index" + ext);
    if (isFile(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = tryFileVariants(path.join(srcRoot, specifier.slice(2)));
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  if (specifier.startsWith(".") || specifier.startsWith("file:")) {
    const parent = context.parentURL ?? pathToFileURL(projectRoot + "/").href;
    const target = fileURLToPath(new URL(specifier, parent));
    const resolved = tryFileVariants(target);
    if (resolved) {
      return { url: resolved, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

// Registers the TypeScript-friendly resolve hook for TS CLI scripts.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);

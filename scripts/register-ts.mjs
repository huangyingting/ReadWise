// Registers the TypeScript-friendly resolve hook for the scraper CLI.
import { register } from "node:module";

register("./ts-resolve-hook.mjs", import.meta.url);

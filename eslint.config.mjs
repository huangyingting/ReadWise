import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// ── Custom local plugin: import-boundary enforcement (REF-076) ────────────────
// Enforces client/server module boundaries. See eslint-rules/ for rule source
// and docs/refactoring.md § REF-076 for the boundary taxonomy.
const importBoundaryPlugin = {
  rules: {
    "no-server-imports-in-client": require(
      resolve(__dirname, "eslint-rules/no-server-imports-in-client.js")
    ),
  },
};

const eslintConfig = [
  { ignores: [".squad/", "node_modules/", ".next/"] },
  ...compat.extends("next/core-web-vitals"),

  // ── Client/server import boundary rule (REF-076) ──────────────────────────
  // Applied to all TypeScript/TSX source files.
  //
  // Legitimate exemptions:
  //   • Next.js server components (page.tsx, layout.tsx, route.ts, loading.tsx,
  //     error.tsx, not-found.tsx, template.tsx) — server by default; no "use
  //     client" directive is present, so the rule does not fire on them.
  //   • Files with an intentional, reviewed cross-boundary import may suppress
  //     a single line:
  //       // eslint-disable-next-line readwise/no-server-imports-in-client -- reason
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { readwise: importBoundaryPlugin },
    rules: {
      "readwise/no-server-imports-in-client": "error",
    },
  },
];

export default eslintConfig;

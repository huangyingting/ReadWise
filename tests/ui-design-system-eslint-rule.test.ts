import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Linter } from "eslint";

const require = createRequire(import.meta.url);
const ruleModule = require("../eslint-rules/ui-design-system.js");

type RuleOptions = {
  allowInteractiveElements?: boolean;
  allowHiddenInputs?: boolean;
  allowRangeInputs?: boolean;
  allowChoiceInputs?: boolean;
  allowCustomFocus?: boolean;
  allowInlineFontSize?: boolean;
  allowLocalStateComponents?: boolean;
};

function lint(source: string, options?: RuleOptions): Linter.LintMessage[] {
  const configuredRule: Linter.RuleEntry = options ? ["error", options] : "error";
  const linter = new Linter({ configType: "flat" });

  return linter.verify(source, {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      readwise: { rules: { "ui-design-system": ruleModule } },
    },
    rules: {
      "readwise/ui-design-system": configuredRule,
    },
  });
}

function messageIds(messages: Linter.LintMessage[]): string[] {
  return messages.map((message) => message.messageId ?? "");
}

test("ui-design-system rule reports migrated-UI drift across JSX forms", () => {
  const messages = lint(`
    const suffix = "dynamic";
    function Spinner() {
      return <button
        className={"text-sm focus:ring-2 animate-spin bg-[#fff]"}
        style={{ fontSize: "12px", color: "rgba(0, 0, 0, 1)", opacity: 1, ...extra }}
      >Loading</button>;
    }
    function EmptyState() { return <input />; }
    function ErrorState() { return <select />; }
    function LoadingState() { return <textarea />; }
    function OrdinaryState() {
      return <>
        <div className={\`text-lg hsl(0, 0%, 0%)\`} style={{ "fontSize": \`1rem\`, background: \`#abcdef\` }} />
        <div className={\`text-sm \${suffix}\`} />
        <div className={42} />
        <div className />
        <div>{"#abc"}</div>
        <div>{\`rgb(1, 2, 3)\`}</div>
        <div>{\`safe-\${suffix}\`}</div>
      </>;
    }
    export default function () { return null; }
  `);
  const ids = messageIds(messages);

  for (const expected of [
    "bareInteractive",
    "rawColor",
    "rawFontSize",
    "inlineFontSize",
    "customFocus",
    "localSpinner",
    "localStateComponent",
  ]) {
    assert.ok(ids.includes(expected), `expected ${expected}: ${JSON.stringify(messages)}`);
  }
  assert.equal(ids.filter((id) => id === "bareInteractive").length, 4);
  assert.equal(ids.filter((id) => id === "localStateComponent").length, 4);
});

test("ui-design-system rule permits documented inputs and explicit low-level options", () => {
  const defaultMessages = lint(`
    const inputs = <>
      <input type="hidden" />
      <input type={"range"} />
      <input type={\`radio\`} />
      <input type="checkbox" />
    </>;
  `);
  assert.deepEqual(defaultMessages, []);

  const strictInputIds = messageIds(
    lint(
      `<><input type="hidden" /><input type="range" /><input type="radio" /></>`,
      {
        allowHiddenInputs: false,
        allowRangeInputs: false,
        allowChoiceInputs: false,
      },
    ),
  );
  assert.equal(strictInputIds.filter((id) => id === "bareInteractive").length, 3);

  const optedOutIds = messageIds(
    lint(
      `
        function Spinner() {
          return <button className="focus:ring-2" style={{ fontSize: "12px" }}>ok</button>;
        }
      `,
      {
        allowInteractiveElements: true,
        allowCustomFocus: true,
        allowInlineFontSize: true,
        allowLocalStateComponents: true,
      },
    ),
  );
  assert.deepEqual(optedOutIds, []);
});

test("ui-design-system rule skips the web manifest and supports legacy filename contexts", () => {
  const create = ruleModule.create as (context: {
    filename?: unknown;
    getFilename?: () => string;
    options: RuleOptions[];
    report: () => void;
  }) => Record<string, unknown>;

  assert.deepEqual(
    create({
      filename: "/workspace/src/app/manifest.ts",
      options: [],
      report() {},
    }),
    {},
  );

  const listeners = create({
    filename: null,
    getFilename: () => "/workspace/src/components/Legacy.jsx",
    options: [],
    report() {},
  });
  assert.equal(typeof listeners.JSXOpeningElement, "function");

  const anonymousListeners = create({
    options: [],
    report() {},
  });
  assert.equal(typeof anonymousListeners.Literal, "function");
});

/**
 * ESLint rule: ui-design-system
 *
 * Incremental design-system drift guard for migrated UI surfaces.
 *
 * The rule intentionally starts narrow: apply it to `src/components/ui/**` and
 * already-migrated feature files, then broaden the `files` globs as migration
 * waves complete. It catches raw colour/font-size values, feature-owned form
 * controls/buttons, custom focus rings, and local spinner/empty/error patterns
 * that should instead go through `src/components/ui/*` primitives.
 */

"use strict";

const RAW_COLOR_RE = /(^|[^a-zA-Z])(?:#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\s*\()/;
const RAW_FONT_CLASS_RE = /(?:^|\s)text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[0-9.]+(?:px|rem|em)\])(?:\s|$)/;
const CUSTOM_FOCUS_RE = /(?:^|\s)(?:focus|focus-visible):(?:ring|outline|\[box-shadow)/;
const LOCAL_SPINNER_RE = /(?:^|\s)animate-spin(?:\s|$)/;
const LOCAL_STATE_NAME_RE = /(?:^|[A-Z])(Spinner|EmptyState|ErrorState|LoadingState)$/;
const INTERACTIVE_ELEMENTS = new Set(["button", "input", "select", "textarea"]);

function getStaticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked || "").join("");
  }
  return null;
}

function getJSXAttribute(openingElement, name) {
  return openingElement.attributes.find(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name,
  );
}

function getJSXAttributeString(openingElement, name) {
  const attribute = getJSXAttribute(openingElement, name);
  if (!attribute || !attribute.value) return null;
  if (attribute.value.type === "Literal") {
    return typeof attribute.value.value === "string" ? attribute.value.value : null;
  }
  if (attribute.value.type === "JSXExpressionContainer") {
    return getStaticString(attribute.value.expression);
  }
  return null;
}

function isJSXElementName(node, name) {
  return node.type === "JSXIdentifier" && node.name === name;
}

function isHiddenInput(openingElement) {
  if (!isJSXElementName(openingElement.name, "input")) return false;
  return getJSXAttributeString(openingElement, "type") === "hidden";
}

function isRangeInput(openingElement) {
  if (!isJSXElementName(openingElement.name, "input")) return false;
  return getJSXAttributeString(openingElement, "type") === "range";
}

function isChoiceInput(openingElement) {
  if (!isJSXElementName(openingElement.name, "input")) return false;
  const type = getJSXAttributeString(openingElement, "type");
  return type === "radio" || type === "checkbox";
}

function isReactStyleObject(node) {
  return (
    node &&
    node.type === "JSXExpressionContainer" &&
    node.expression &&
    node.expression.type === "ObjectExpression"
  );
}

function isFontSizeProperty(property) {
  if (!property || property.type !== "Property") return false;
  const key = property.key;
  return (
    (key.type === "Identifier" && key.name === "fontSize") ||
    (key.type === "Literal" && key.value === "fontSize")
  );
}

function shouldCheckString(value) {
  return typeof value === "string" && value.length > 0;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Guard migrated UI surfaces against design-system drift: raw colours, raw font sizes, custom focus rings, and local controls.",
      category: "Design System",
      recommended: false,
    },
    messages: {
      rawColor:
        "Raw colour values are not allowed in migrated UI. Use tokens from src/app/tokens.css, e.g. var(--text) or var(--surface).",
      rawFontSize:
        "Raw Tailwind font-size classes are not allowed in migrated UI. Use token classes such as text-[length:var(--text-sm)].",
      inlineFontSize:
        "Inline fontSize is not allowed in migrated feature UI. Use text tokens/classes instead.",
      bareInteractive:
        "Use a src/components/ui primitive instead of a bare <{{name}}> in migrated UI.",
      customFocus:
        "Use the shared focusRing utility or a UI primitive focus contract instead of custom focus ring classes.",
      localSpinner:
        "Use the shared Spinner/Skeleton/Panel* primitives instead of a feature-local spinner/loading state.",
      localStateComponent:
        "Use the shared EmptyState/Panel* primitives instead of a feature-local {{name}} component.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInteractiveElements: { type: "boolean", default: false },
          allowHiddenInputs: { type: "boolean", default: true },
          allowRangeInputs: { type: "boolean", default: true },
          allowChoiceInputs: { type: "boolean", default: true },
          allowCustomFocus: { type: "boolean", default: false },
          allowInlineFontSize: { type: "boolean", default: false },
          allowLocalStateComponents: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const filename =
      (typeof context.filename === "string" ? context.filename : null) ||
      (typeof context.getFilename === "function" ? context.getFilename() : "");
    if (filename.replace(/\\/g, "/").endsWith("/src/app/manifest.ts")) {
      return {};
    }

    const options = context.options[0] || {};
    const allowInteractiveElements = options.allowInteractiveElements === true;
    const allowHiddenInputs = options.allowHiddenInputs !== false;
    const allowRangeInputs = options.allowRangeInputs !== false;
    const allowChoiceInputs = options.allowChoiceInputs !== false;
    const allowCustomFocus = options.allowCustomFocus === true;
    const allowInlineFontSize = options.allowInlineFontSize === true;
    const allowLocalStateComponents = options.allowLocalStateComponents === true;

    function checkClassName(value, node) {
      if (!shouldCheckString(value)) return;
      if (RAW_COLOR_RE.test(value)) {
        context.report({ node, messageId: "rawColor" });
      }
      if (RAW_FONT_CLASS_RE.test(value)) {
        context.report({ node, messageId: "rawFontSize" });
      }
      if (!allowCustomFocus && CUSTOM_FOCUS_RE.test(value)) {
        context.report({ node, messageId: "customFocus" });
      }
      if (LOCAL_SPINNER_RE.test(value)) {
        context.report({ node, messageId: "localSpinner" });
      }
    }

    return {
      JSXOpeningElement(node) {
        if (
          !allowInteractiveElements &&
          node.name.type === "JSXIdentifier" &&
          INTERACTIVE_ELEMENTS.has(node.name.name) &&
          !(allowHiddenInputs && isHiddenInput(node)) &&
          !(allowRangeInputs && isRangeInput(node)) &&
          !(allowChoiceInputs && isChoiceInput(node))
        ) {
          context.report({
            node: node.name,
            messageId: "bareInteractive",
            data: { name: node.name.name },
          });
        }

        const className = getJSXAttributeString(node, "className");
        if (className !== null) {
          const attribute = getJSXAttribute(node, "className");
          checkClassName(className, attribute || node);
        }

        const style = getJSXAttribute(node, "style");
        if (style && isReactStyleObject(style.value)) {
          for (const property of style.value.expression.properties) {
            if (!allowInlineFontSize && isFontSizeProperty(property)) {
              context.report({ node: property, messageId: "inlineFontSize" });
            }

            if (property.type === "Property") {
              const value = getStaticString(property.value);
              if (value && RAW_COLOR_RE.test(value)) {
                context.report({ node: property.value, messageId: "rawColor" });
              }
            }
          }
        }
      },

      Literal(node) {
        if (typeof node.value === "string" && RAW_COLOR_RE.test(node.value)) {
          context.report({ node, messageId: "rawColor" });
        }
      },

      TemplateLiteral(node) {
        if (node.expressions.length > 0) return;
        const value = node.quasis.map((quasi) => quasi.value.cooked || "").join("");
        if (RAW_COLOR_RE.test(value)) {
          context.report({ node, messageId: "rawColor" });
        }
      },

      FunctionDeclaration(node) {
        if (allowLocalStateComponents || !node.id || !node.id.name) return;
        if (LOCAL_STATE_NAME_RE.test(node.id.name)) {
          context.report({
            node: node.id,
            messageId: "localStateComponent",
            data: { name: node.id.name },
          });
        }
      },
    };
  },
};

module.exports = rule;
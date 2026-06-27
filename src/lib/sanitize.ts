/**
 * HTML sanitizer — strips unsafe tags and attributes before rendering.
 *
 * @server-only — sanitize-html has Node.js dependencies; never import from
 * a "use client" file. See ADR-0010.
 */
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "sup",
  "sub",
  "code",
  "pre",
  "a",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

// Structural wrappers we keep only long enough to inspect/strip ad blocks in
// the first pass; they are removed (text preserved) by the strict second pass.
const STRUCTURAL_TAGS = [
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "span",
];

// Class/id fragments that mark non-article boilerplate (ads, share widgets, etc.).
const BOILERPLATE_PATTERN =
  /\b(ad|ads|adsense|advert|advertisement|sponsor|sponsored|promo|promotion|newsletter|subscribe|signup|social|share|sharing|related|recommend|comment|cookie|consent|popup|modal|overlay|paywall|banner)\b/i;

function isBoilerplate(attribs: Record<string, string> | undefined): boolean {
  if (!attribs) return false;
  const haystack = `${attribs.class ?? ""} ${attribs.id ?? ""} ${attribs["data-ad"] ?? ""}`;
  return BOILERPLATE_PATTERN.test(haystack);
}

const DROP_BLOCKS_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS, ...STRUCTURAL_TAGS],
  allowedAttributes: {
    "*": ["class", "id"],
    a: ["href", "title"],
    img: ["src", "alt", "title"],
  },
  // Remove these tags AND their contents (scripts, styles, embedded ads).
  nonTextTags: ["style", "script", "textarea", "noscript", "iframe"],
  // Drop ad/boilerplate containers together with their inner content.
  exclusiveFilter: (frame) => isBoilerplate(frame.attribs),
};

const STRICT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    // `rel` and `target` must be listed here so the `transformTags.a`
    // transform (which unconditionally sets rel=noopener noreferrer nofollow
    // and target=_blank) is not immediately stripped by the attribute filter.
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  nonTextTags: ["style", "script", "textarea", "noscript", "iframe"],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
  },
};

/**
 * Sanitize stored article HTML into a clean, distraction-free body:
 * first drops ad/boilerplate blocks (with their content), then strips any
 * remaining non-allowlisted tags and unsafe attributes/schemes.
 */
export function sanitizeArticleHtml(html: string): string {
  const withoutBoilerplate = sanitizeHtml(html, DROP_BLOCKS_OPTIONS);
  return sanitizeHtml(withoutBoilerplate, STRICT_OPTIONS);
}

import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  addUnique,
  candidateCap,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
} from "./shared";

const PDR_PAGE_DATA = [
  {
    kind: "essay",
    url: "https://publicdomainreview.org/page-data/essays/page-data.json",
  },
  {
    kind: "collection",
    url: "https://publicdomainreview.org/page-data/collections/page-data.json",
  },
] as const;

const PDR_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/animal|vegetable|creature|birds?|beasts?/, "animals"],
  [/travel|exploration|voyage|map|atlas|world/, "travel"],
  [/science|medicine|astronom|natural.?history|botany|geology/, "science"],
  [/art|illustration|music|literature|poetry|theatre|film|culture/, "culture"],
  [/philosoph|magic|myth|religion|idea|utopia|dream|mind/, "ideas"],
  [/history|ancient|medieval|victorian|century|archive|war/, "history"],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nestedRecord(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const next = value[key];
  return isRecord(next) ? next : null;
}

function pdrEdges(payload: unknown): unknown[] {
  if (!isRecord(payload)) return [];
  const result = nestedRecord(payload, "result");
  const data = result ? nestedRecord(result, "data") : null;
  if (!data) return [];
  const allAirtable = nestedRecord(data, "allAirtable");
  const collections = nestedRecord(data, "collections");
  const edges = (allAirtable ?? collections)?.edges;
  return Array.isArray(edges) ? edges : [];
}

function pdrSlug(edge: unknown): string | null {
  if (!isRecord(edge)) return null;
  const node = nestedRecord(edge, "node");
  const data = node ? nestedRecord(node, "data") : null;
  const slug = data?.Slug;
  return typeof slug === "string" && /^[a-z0-9][a-z0-9-]+$/i.test(slug) ? slug : null;
}

async function publicDomainReviewUrlExtractor(ctx: UrlExtractorContext): Promise<string[]> {
  const cap = candidateCap(ctx.limit);
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const source of PDR_PAGE_DATA) {
    if (urls.length >= cap) break;
    let payload: unknown;
    try {
      payload = JSON.parse(await ctx.fetch(source.url));
    } catch {
      continue;
    }
    for (const edge of pdrEdges(payload)) {
      const slug = pdrSlug(edge);
      if (!slug) continue;
      if (addUnique(seen, urls, `https://publicdomainreview.org/${source.kind}/${slug}/`, cap)) break;
    }
  }

  return urls;
}

export const publicDomainReview: Provider = {
  key: "publicdomainreview",
  name: "Public Domain Review",
  hostnames: ["publicdomainreview.org"],
  seeds: ["https://publicdomainreview.org/essays/", "https://publicdomainreview.org/collections/"],
  articleUrlPattern:
    /^https:\/\/publicdomainreview\.org\/(?:essay|collection)\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, ["/blog/", "/shop/", "/support/", "/newsletter/", "/contribute/"]),
  defaultCategory: "history",
  categories: ["history", "culture", "ideas", "animals", "travel", "science"],
  readingCategories: ["history", "culture", "ideas", "animals", "travel", "science"],
  cleanup: {
    ...COMMON_READING_SOURCE_CLEANUP,
    dropClassKeywords: [...COMMON_READING_SOURCE_CLEANUP.dropClassKeywords, "donate", "shop", "support"],
  },
  categoryFor: (url, section) => categoryFromRules(url, section, PDR_CATEGORY_RULES, "history"),
  urlExtractor: publicDomainReviewUrlExtractor,
};

export default publicDomainReview;

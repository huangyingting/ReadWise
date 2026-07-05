import type { Provider, UrlExtractorContext } from "@/lib/scraper/types";
import {
  collectSitemapUrls,
  COMMON_READING_SOURCE_CLEANUP,
  categoryFromRules,
  excludes,
  isPath,
} from "./shared";

const WORKS_IN_PROGRESS_SITEMAP = "https://worksinprogress.co/post-sitemap.xml";

const WIP_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/technology|tech|software|\bai\b|comput|robot|internet|innovation/, "tech"],
  [/business|econom|finance|industry|factory|market|trade|labor|housing/, "business"],
  [/environment|climate|energy|carbon|nuclear|solar|wind|pollution/, "environment"],
  [/science|research|medicine|disease|zika|vaccine|biology|physics|sleeping.?beauties/, "science"],
  [/health|disease|medicine|pandemic|epidemic|public.?health/, "health"],
  [/history|forgotten|crisis|state|empire|industrial|revolution/, "history"],
  [/culture|education|cities|roads|housing|planning/, "culture"],
  [/ideas?|progress|policy|governance|institutions?|state.?capacity/, "ideas"],
];

async function worksInProgressUrlExtractor(ctx: UrlExtractorContext): Promise<string[]> {
  return collectSitemapUrls([WORKS_IN_PROGRESS_SITEMAP], ctx, (url) =>
    isPath(url, "worksinprogress.co", /^\/issue\/[a-z0-9][a-z0-9-]+\/?$/i),
  );
}

export const worksInProgress: Provider = {
  key: "worksinprogress",
  name: "Works in Progress",
  hostnames: ["worksinprogress.co", "www.worksinprogress.co"],
  seeds: ["https://worksinprogress.co/issues"],
  articleUrlPattern: /^https:\/\/(?:www\.)?worksinprogress\.co\/issue\/[a-z0-9][a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) => excludes(url, ["/authors/", "/topics/", "/wp-content/", "/issues/"]),
  defaultCategory: "ideas",
  categories: ["ideas", "business", "tech", "environment", "science", "health", "history", "culture"],
  readingCategories: ["ideas", "business", "tech", "environment", "science", "health", "history", "culture"],
  cleanup: COMMON_READING_SOURCE_CLEANUP,
  categoryFor: (url, section) => categoryFromRules(url, section, WIP_CATEGORY_RULES, "ideas"),
  urlExtractor: worksInProgressUrlExtractor,
};

export default worksInProgress;

import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes, rssUrlExtractor } from "./shared";

export const BBC_FEATURES_RSS_FEEDS = [
  "https://www.bbc.com/future/feed.rss",
  "https://www.bbc.com/travel/feed.rss",
  "https://www.bbc.com/culture/feed.rss",
  "https://www.bbc.com/worklife/feed.rss",
] as const;

const BBC_FEATURES_CATEGORIES = [
  "science",
  "health",
  "tech",
  "environment",
  "travel",
  "culture",
  "business",
  "history",
  "ideas",
  "entertainment",
] as const;

const BBC_FEATURES_CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\/travel\/|travel|destination|tourism|hotel|city|food|restaurant|chef|tapas|perfume|paris|village|world cup|wimbledon/, "travel"],
  [/\/culture\/|culture|film|tv|television|movie|music|book|\barts?\b|artist|literature|hollywood|odyssey|wimbledon|prairie|kahlo/, "culture"],
  [/history|ancient|viking|revolution|declaration|heritage|edo|colony|\bwar\b|d-day|medieval/, "history"],
  [/\/worklife\/|worklife|business|work|office|career|econom|tax|wealth|tourism industry|cannabis business|restaurant/, "business"],
  [/technology|tech|phone|screen|google|search|\bai\b|artificial.?intelligence|digital|social media|internet|meta/, "tech"],
  [/health|disease|infection|psychology|mind|vegetables|ageing|longevity|body|wellness|violence/, "health"],
  [/climate|drought|sinkhole|cyclone|koala|chlamydia|bees|breadfruit|environment|nature|island|shark|heat/, "environment"],
  [/language|english|words|ethic|society|psychology|fear|curious|sources/, "ideas"],
  [/science|future|research|brain|biology|evolution|space|physics|chemistry/, "science"],
  [/entertainment|parody|show|fans/, "entertainment"],
];

export function isBbcFeaturesArticleUrl(url: string): boolean {
  const lower = url.toLowerCase();
  const matches = /^https:\/\/(?:www\.)?bbc\.com\/(?:future|travel|culture|worklife)\/article\/\d{8}-[a-z0-9-]+(?:[/?#].*)?$/i.test(
    lower,
  );
  return matches && excludes(lower, ["/news/", "/video", "/videos", "/live/"]);
}

const bbcFeatures: Provider = {
  key: "bbcfeatures",
  name: "BBC Features",
  hostnames: ["bbc.com", "www.bbc.com"],
  seeds: [
    "https://www.bbc.com/future",
    "https://www.bbc.com/travel",
    "https://www.bbc.com/culture",
    "https://www.bbc.com/worklife",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?bbc\.com\/(?:future|travel|culture|worklife)\/article\/\d{8}-[a-z0-9-]+(?:[/?#].*)?$/i,
  articleUrlFilter: isBbcFeaturesArticleUrl,
  defaultCategory: "ideas",
  categories: [...BBC_FEATURES_CATEGORIES],
  readingCategories: [...BBC_FEATURES_CATEGORIES],
  categoryFor: (url, section) =>
    categoryFromRules(url, section, BBC_FEATURES_CATEGORY_RULES, "ideas"),
  cleanup: {
    dropClassKeywords: [
      "advert",
      "advertisement",
      "newsletter",
      "promo",
      "related",
      "share",
      "sign-in",
      "social",
      "bbc-footer",
      "drawer",
      "main-footer",
      "navigationpanel",
      "search-input",
      "searchinput",
    ],
    dropTextKeywords: [
      '{"image":{"pid":""}}',
      "if you liked this story",
      "if you would like to comment",
      "to comment on this story or anything else you have seen on bbc",
      "join one million future fans",
      "weekly bbc.com features",
      "bbc.com features newsletter",
      "if you only read 6 things this week",
      "the essential list",
      "delivered to your inbox every friday",
      "bbc culture film and tv club",
      "facebook page or message us on",
      "join more than three million bbc travel fans",
      "bbc.com's world's table",
      "smashes the kitchen ceiling",
      "is a bbc travel series",
      "culinary roots is a series from bbc travel",
      "rare and local foods woven into a place",
      "this article is for information only",
      "when venturing into \"bear country\"",
      "a previous version of this article",
      "this has now been corrected",
      "site search",
      "sign up to the bbc",
      "subscribe to our newsletter",
      "follow bbc",
      "related topics",
    ],
    dropTextExactKeywords: ["--", "---"],
    dropLinkHrefBlockKeywords: [
      "pages.emails.bbc.com/subscribe",
      "/travel/columns/",
      "/travel/columns/culinary-roots",
      "/travel/worlds-table",
      "facebook.com/groups/440074069852291",
      "facebook.com/pages/bbc-culture",
      "twitter.com/bbc_culture",
      "facebook.com/bbctravel",
      "twitter.com/bbc_travel",
      "instagram.com/bbctravel",
    ],
  },
  urlExtractor: rssUrlExtractor(BBC_FEATURES_RSS_FEEDS),
};

export default bbcFeatures;

import type { Provider, UrlExtractorResult } from "@/lib/scraper/types";
import { categoryFromRules, excludes, extractorResultUrl, sitemapUrlExtractor } from "./shared";

const SCIENTIFIC_AMERICAN_SITEMAP_INDEX =
  "https://www.scientificamerican.com/platform/syndication/sitemaps/";
const SCIENTIFIC_AMERICAN_BASE_URL = "https://www.scientificamerican.com";
const SCIENTIFIC_AMERICAN_ARTICLE_URL_RE =
  /^https:\/\/(?:www\.)?scientificamerican\.com\/article\/[a-z0-9._%+-]+\/?(?:[?#].*)?$/i;
const SCIENTIFIC_AMERICAN_EXCLUDED_URL_FRAGMENTS = [
  "/custom-media-article/",
  "/sponsored/",
  "/partner/",
] as const;
const SCIENTIFIC_AMERICAN_SEED_SLUGS = [
  "latest",
  "science",
  "health",
  "mind-and-brain",
  "technology",
  "environment",
  "space-and-physics",
  "biology",
  "chemistry",
  "math",
  "social-sciences",
  "opinion",
  "books",
  "podcasts",
  "videos",
  "travel",
  "advances",
  "aerospace",
  "aging",
  "agriculture",
  "alcohol",
  "allergies",
  "alternative-medicine",
  "alzheimer-s-disease",
  "anatomy",
  "animals",
  "anthropocene",
  "anthropology",
  "anxiety",
  "archaeology",
  "architecture",
  "artificial-intelligence",
  "arts",
  "astronomy",
  "astrophysics",
  "autism",
  "automobiles",
  "bacteria",
  "basic-chemistry",
  "batteries",
  "bees",
  "behavior",
  "biochemistry",
  "biodiversity",
  "biometrics",
  "biotech",
  "bird-flu",
  "black-holes",
  "blockchain",
  "book-recommendations",
  "book-reviews",
  "buildings",
  "cancer",
  "careers",
  "cats",
  "cells",
  "children",
  "climate-change",
  "cloning",
  "coal",
  "coffee",
  "cognition",
  "computing",
  "consciousness",
  "conservation",
  "coral-reefs",
  "coronavirus",
  "cosmology",
  "covid",
  "creationism",
  "creativity",
  "criminal-justice",
  "crispr",
  "culture",
  "dark-energy",
  "dark-matter",
  "data",
  "defense",
  "deforestation",
  "depression",
  "dermatology",
  "diabetes",
  "diet",
  "dinosaurs",
  "discrimination",
  "diversity",
  "dna",
  "dogs",
  "drug-resistance",
  "drug-use",
  "ecology",
  "economics",
  "education",
  "egyptology",
  "electronics",
  "endangered-species",
  "energy",
  "engineering",
  "epidemiology",
  "ethics",
  "evolution",
  "exercise",
  "exoplanets",
  "extinction",
  "extraterrestrial-life",
  "feminism",
  "fitness",
  "food",
  "fossil-fuels",
  "gaming",
  "gene-therapy",
  "genetic-engineering",
  "genetics",
  "geology",
  "geothermal",
  "glp-1-drugs",
  "gmo",
  "gravity",
  "grief",
  "hantavirus",
  "health-care",
  "hearing",
  "heart-disease",
  "history",
  "hiv",
  "hydropower",
  "inequality",
  "influenza",
  "intelligence",
  "internet",
  "kidney-disease",
  "language",
  "large-hadron-collider",
  "machine-learning",
  "malaria",
  "marijuana",
  "mars",
  "materials-science",
  "mathematics",
  "measles",
  "medicine",
  "memory",
  "mental-health",
  "mental-illness",
  "meter-poems",
  "microbiology",
  "microbiome",
  "milky-way",
  "mindfulness",
  "multiverse",
  "music",
  "nanotechnology",
  "natural-disasters",
  "natural-gas",
  "neurology",
  "neuroscience",
  "nuclear-energy",
  "nuclear-weapons",
  "nutrition",
  "obesity",
  "oceans",
  "optics",
  "pain",
  "paleontology",
  "parenting",
  "particle-physics",
  "pediatrics",
  "pharmaceuticals",
  "physiology",
  "planetary-science",
  "plants",
  "plastic",
  "policy",
  "politics",
  "polling",
  "pollution",
  "power-grid",
  "privacy",
  "psychedelics",
  "psychology",
  "ptsd",
  "public-health",
  "quantum-computing",
  "quantum-physics",
  "racism",
  "relativity",
  "renewable-energy",
  "reproduction",
  "robotics",
  "schizophrenia",
  "science-in-images",
  "sex-and-gender",
  "sexism",
  "sexuality",
  "sleep",
  "smoking",
  "social-justice",
  "social-media",
  "sociology",
  "solar",
  "solar-system",
  "space-exploration",
  "spacecraft",
  "sports",
  "statistics",
  "stem-cells",
  "stress",
  "string-theory",
  "sustainability",
  "taste",
  "terrorism",
  "the-coronavirus-outbreak",
  "the-environment",
  "the-sciences",
  "tidal-power",
  "topology",
  "toxicology",
  "toxics",
  "transportation",
  "ukraine",
  "universe",
  "vaccines",
  "video",
  "viruses",
  "vision",
  "warfare",
  "water",
  "weather",
  "weight",
  "wind",
  "young-american-scientists-features",
  "young-american-scientists-icons",
  "young-american-scientists-profiles",
] as const;
const SCIENTIFIC_AMERICAN_SEEDS = SCIENTIFIC_AMERICAN_SEED_SLUGS.map(
  (slug) => `${SCIENTIFIC_AMERICAN_BASE_URL}/${slug}/`,
);
const SCIENTIFIC_AMERICAN_DISCOVERY_SEEDS = [
  SCIENTIFIC_AMERICAN_BASE_URL + "/",
  ...SCIENTIFIC_AMERICAN_SEEDS,
];
const sitemapExtractor = sitemapUrlExtractor(SCIENTIFIC_AMERICAN_SITEMAP_INDEX, {
  sitemapUrlFilter: (url) => /\/platform\/syndication\/sitemaps\/articles\/(?:\?p=\d+)?$/i.test(url),
});

function isScientificAmericanArticleUrl(url: string): boolean {
  return (
    SCIENTIFIC_AMERICAN_ARTICLE_URL_RE.test(url) &&
    excludes(url, SCIENTIFIC_AMERICAN_EXCLUDED_URL_FRAGMENTS)
  );
}

function candidateCap(limit: number): number {
  return Number.isFinite(limit) ? Math.max(limit * 2, limit) : Number.POSITIVE_INFINITY;
}

function normalizeDiscoveredUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    url.search = "";
    return url.href;
  } catch {
    return null;
  }
}

function parseHtmlArticleLinks(html: string, baseUrl: string): string[] {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => normalizeDiscoveredUrl(match[1] ?? "", baseUrl))
    .filter((url): url is string => url != null && isScientificAmericanArticleUrl(url));
}

function addArticleCandidates(
  urls: string[],
  seen: Set<string>,
  candidates: readonly UrlExtractorResult[],
  cap: number,
): void {
  for (const candidate of candidates) {
    if (urls.length >= cap) break;
    const url = extractorResultUrl(candidate);
    if (!isScientificAmericanArticleUrl(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
}

async function scientificAmericanUrlExtractor({
  limit,
  fetch,
}: Parameters<NonNullable<Provider["urlExtractor"]>>[0]): Promise<string[]> {
  const cap = candidateCap(limit);
  const seen = new Set<string>();
  const urls: string[] = [];

  addArticleCandidates(urls, seen, await sitemapExtractor({ limit, fetch }), cap);

  for (const seed of SCIENTIFIC_AMERICAN_DISCOVERY_SEEDS) {
    if (urls.length >= cap) break;
    try {
      addArticleCandidates(urls, seen, parseHtmlArticleLinks(await fetch(seed), seed), cap);
    } catch {
      continue;
    }
  }

  return urls;
}

const scientificamerican: Provider = {
  key: "scientificamerican",
  name: "Scientific American",
  hostnames: ["scientificamerican.com", "www.scientificamerican.com"],
  seeds: SCIENTIFIC_AMERICAN_DISCOVERY_SEEDS,
  articleUrlPattern: SCIENTIFIC_AMERICAN_ARTICLE_URL_RE,
  articleUrlFilter: isScientificAmericanArticleUrl,
  defaultCategory: "science",
  categories: [
    "science",
    "health",
    "tech",
    "environment",
    "animals",
    "history",
    "ideas",
    "culture",
    "politics",
    "business",
    "travel",
    "entertainment",
    "sports",
  ],
  readingCategories: [
    "science",
    "health",
    "tech",
    "environment",
    "animals",
    "history",
    "ideas",
    "culture",
    "business",
    "travel",
    "entertainment",
  ],
  cleanup: {
    dropClassKeywords: [
      "newsletter",
      "recirc",
      "related",
      "promo",
      "subscription",
      "paywall",
      "advertisement",
      "social",
      "share",
    ],
    dropTextKeywords: [
      "Support science journalism",
      "supporting science journalism",
      "supporting our award-winning journalism",
      "By purchasing a subscription you are helping to ensure the future",
      "Subscribe to Scientific American",
      "Scientific American maintains a strict policy of editorial independence",
    ],
    dropLinkHrefBlockKeywords: ["/getsciam/"],
  },
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [
          /health|medicine|disease|heart|brain|mind|psychology|neuro|sleep|virus|vaccine|drug|cancer|diabetes|diet|nutrition|fitness|exercise|reproduction|mental|covid|coronavirus|aging|alzheimer|autism|epidemiology|pediatric|pain|obesity|malaria|hiv|influenza|measles|kidney|allerg|dermatology|psychedelic|schizophrenia|stress|ptsd|anxiety|depression|smoking|alcohol|marijuana|glp-?1|grief|hearing|vision|taste|toxicol|toxic/,
          "health",
        ],
        [
          /climate|environment|sustainab|conservation|weather|geology|water|agriculture|ocean|pollution|fossil.?fuels|renewable|natural.?disasters|anthropocene|biodiversity|coral|deforestation|geothermal|hydropower|nuclear.?energy|plastic|power.?grid|solar|tidal|wind|natural.?gas|coal|ecology|earth/,
          "environment",
        ],
        [
          /technology|artificial.?intelligence|\bai\b|computer|computing|robot|digital|internet|data|blockchain|electronics|engineering|aerospace|automobile|transportation|nanotechnology|biotech|machine.?learning|privacy|biometric|batter|nuclear.?weapons|defense|spacecraft|social.?media/,
          "tech",
        ],
        [/animals?|wildlife|species|bees|cats|dogs|endangered|dinosaurs|plants|extinction/, "animals"],
        [/history|archaeology|egyptology|ancient|anthropology/, "history"],
        [
          /politic|policy|criminal.?justice|terrorism|warfare|ukraine|social.?justice|racism|sexism|feminism|discrimination|inequality|diversity|polling/,
          "politics",
        ],
        [/business|economics|careers/, "business"],
        [/travel/, "travel"],
        [/sports?/, "sports"],
        [/gaming|games?|video|podcast|music/, "entertainment"],
        [
          /books?|book.?reviews?|book.?recommendations?|arts?|culture|food|language|education|social.?sciences|sociology|children|parenting|sex(?:uality|-and-gender)|architecture|meter.?poems/,
          "culture",
        ],
        [/opinion|ethics|consciousness|creationism|the.?sciences|advances|observations|cross.?check/, "ideas"],
        [
          /space|astronomy|astrophysics|cosmology|exoplanets|mars|milky.?way|multiverse|solar.?system|universe|physics|quantum|gravity|relativity|string.?theory|large.?hadron.?collider|particle.?physics|optics|chemistry|materials.?science|biology|evolution|fossil|paleontology|genetic|genomics|crispr|gmo|microbiology|microbiome|bacteria|cells|physiology|anatomy|math|mathematics|statistics|topology|science/,
          "science",
        ],
      ],
      "science",
    ),
  urlExtractor: scientificAmericanUrlExtractor,
};

export default scientificamerican;

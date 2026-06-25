import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";

const smithsonian: Provider = {
  key: "smithsonian",
  name: "Smithsonian Magazine",
  hostnames: ["smithsonianmag.com", "www.smithsonianmag.com"],
  seeds: [
    "https://www.smithsonianmag.com/category/science-nature/",
    "https://www.smithsonianmag.com/category/history/",
    "https://www.smithsonianmag.com/category/arts-culture/",
    "https://www.smithsonianmag.com/category/travel/",
    "https://www.smithsonianmag.com/category/innovation/",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?smithsonianmag\.com\/[a-z-]+\/[a-z0-9-]+-\d+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/category/",
      "/tag/",
      "/author/",
      "/videos/",
      "/photocontest/",
      "/search/",
      "/subscribe/",
      "/privacy/",
      "/terms/",
    ]),
  defaultCategory: "science",
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/science|nature|innovation/, "science"],
        [/history|arts|culture|travel/, "culture"],
      ],
      "science",
    ),
};

export default smithsonian;

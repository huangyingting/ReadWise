import type { Provider } from "@/lib/scraper/types";
import { categoryFromRules, excludes } from "./shared";

const undark: Provider = {
  key: "undark",
  name: "Undark",
  hostnames: ["undark.org", "www.undark.org"],
  seeds: [
    "https://undark.org/tag/academia/",
    "https://undark.org/tag/climate-change/",
    "https://undark.org/tag/environment-conservation/",
    "https://undark.org/tag/fish-wildlife/",
    "https://undark.org/tag/health-medicine/",
    "https://undark.org/tag/math-physics/",
    "https://undark.org/tag/natural-sciences/",
    "https://undark.org/tag/science-policy/",
    "https://undark.org/tag/social-sciences/",
    "https://undark.org/tag/space-astronomy/",
    "https://undark.org/tag/technology-innovation/",
  ],
  articleUrlPattern:
    /^https:\/\/(?:www\.)?undark\.org\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?(?:[?#].*)?$/i,
  articleUrlFilter: (url) =>
    excludes(url, [
      "/tag/",
      "/category/",
      "/author/",
      "/page/",
      "/about",
      "/contact",
      "/newsletter",
      "/subscribe",
      "/team",
      "/funding",
      "/corrections",
      "/feed",
      "/wp-",
    ]),
  defaultCategory: "science",
  categoryFor: (url, section) =>
    categoryFromRules(
      url,
      section,
      [
        [/health|medicine|covid|drugs/, "health"],
        [/technology|innovation/, "tech"],
        [/policy|social-sciences|academia/, "politics"],
        [/climate|environment|wildlife|physics|natural-sciences|space|science/, "science"],
      ],
      "science",
    ),
};

export default undark;

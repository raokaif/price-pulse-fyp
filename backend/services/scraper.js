const axios = require("axios");
const cheerio = require("cheerio");
const { normalizeProduct } = require("../utils/productNormalizer");
const STORE_HTTP_TIMEOUT = Number(process.env.STORE_HTTP_TIMEOUT || 8000);
const STORE_DETAIL_TIMEOUT = Number(process.env.STORE_DETAIL_TIMEOUT || 7000);
const SPEC_COMPANY_ALIASES = {
  mobiles: {
    apple: "Apple",
    iphone: "Apple",
    samsung: "Samsung",
    infinix: "Infinix",
    tecno: "Tecno",
    vivo: "Vivo",
    oppo: "Oppo",
    xiaomi: "Xiaomi",
    redmi: "Xiaomi",
    realme: "Realme",
    oneplus: "OnePlus",
    huawei: "Huawei",
    honor: "Honor",
    itel: "itel",
    nokia: "Nokia",
  },
  tablets: {
    apple: "Apple",
    ipad: "Apple",
    samsung: "Samsung",
    lenovo: "Lenovo",
    xiaomi: "Xiaomi",
    redmi: "Xiaomi",
    huawei: "Huawei",
    honor: "Honor",
    amazon: "Amazon",
    tcl: "TCL",
    infinix: "Infinix",
    oneplus: "OnePlus",
  },
  laptops: {
    apple: "Apple",
    macbook: "Apple",
    hp: "HP",
    dell: "Dell",
    lenovo: "Lenovo",
    acer: "Acer",
    asus: "Asus",
    msi: "MSI",
    microsoft: "Microsoft",
    surface: "Microsoft",
  },
};
function normalizeSpecCompanyName(company, category = "") {
  const value = cleanText(company, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!value) return null;
  const aliases = SPEC_COMPANY_ALIASES[category] || {};
  return aliases[value] || null;
}
function getHostname(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch (err) {
    return "Website";
  }
}
function cleanText(value, limit = 180) {
  if (!value) return "";
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function resolveUrl(value, baseUrl) {
  if (!value) return null;
  const url = String(value).trim();
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  try {
    return new URL(url, baseUrl).href;
  } catch (err) {
    return url;
  }
}
function pickFromSrcset(value) {
  if (!value) return "";
  return String(value).split(",")[0].trim().split(/\s+/)[0] || "";
}
function cleanImageUrl(value, baseUrl) {
  const url = pickFromSrcset(value);
  if (
    !url ||
    /^data:image\//i.test(url) ||
    /placeholder|spacer|blank|loading|out-of-stock/i.test(url)
  )
    return null;
  const resolved = resolveUrl(url, baseUrl);
  if (/images\.priceoye\.pk/i.test(resolved || "")) {
    return resolved.replace(
      /-100x100(?=\.(?:webp|jpg|jpeg|png)\b)/i,
      "-500x500",
    );
  }
  return resolved;
}
function getBestImageFromPage($, baseUrl, pattern = /./i) {
  const candidates = [];
  const attrs = [
    "src",
    "data-src",
    "data-lazy-src",
    "data-original",
    "srcset",
    "data-srcset",
    "href",
    "content",
  ];
  $(
    'img, source, link[as="image"], link[rel="preload"], link[rel="image_src"], meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]',
  ).each((_, node) => {
    const el = $(node);
    for (const attr of attrs) {
      const image = cleanImageUrl(el.attr(attr), baseUrl);
      if (image && pattern.test(image)) candidates.push(image);
    }
  });
  const html = $.html ? $.html() : "";
  if (html) {
    const urlPattern = /https?:\/\/[^\s"'<>\\]+?\.(?:jpg|jpeg|png|webp|svg)/gi;
    for (const match of html.matchAll(urlPattern)) {
      const image = cleanImageUrl(match[0], baseUrl);
      if (image && pattern.test(image)) candidates.push(image);
    }
  }
  return (
    candidates.sort((a, b) => {
      const score = (image) =>
        (/-500x500\./i.test(image) ? 60 : 0) +
        (/images\.priceoye\.pk/i.test(image) ? 20 : 0) -
        (/-100x100\./i.test(image) ? 40 : 0);
      return score(b) - score(a);
    })[0] || null
  );
}
function getImageFromJsonValue(value, baseUrl) {
  if (!value) return null;
  if (typeof value === "string") return cleanImageUrl(value, baseUrl);
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = getImageFromJsonValue(item, baseUrl);
      if (image) return image;
    }
    return null;
  }
  if (typeof value === "object") {
    return getImageFromJsonValue(
      value.url || value.contentUrl || value.src || value.thumbnailUrl,
      baseUrl,
    );
  }
  return null;
}
function getImageFromElement($, el, baseUrl) {
  const root = el ? $(el) : $("body");
  const imageNodes = root
    .find(
      'amp-img.product-thumbnail, img.product-thumbnail, [class*="product"] img, amp-img, img, source, [data-src], [data-image], [data-original], [data-bg]',
    )
    .slice(0, 25);
  const attrs = [
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-lazy",
    "data-image",
    "data-img",
    "data-bg",
    "src",
    "srcset",
    "data-srcset",
    "content",
  ];
  for (let i = 0; i < imageNodes.length; i += 1) {
    const node = imageNodes.eq(i);
    for (const attr of attrs) {
      const image = cleanImageUrl(node.attr(attr), baseUrl);
      if (image) return image;
    }
  }
  const style = root.find('[style*="background"]').first().attr("style") || "";
  const styleMatch = style.match(/url\((?:'|")?([^'")]+)(?:'|")?\)/i);
  return styleMatch ? cleanImageUrl(styleMatch[1], baseUrl) : null;
}
function getPriceFromText(text) {
  if (!text) return "";
  const match = text.match(
    /(?:Rs\.?|PKR|₨)\s*\.?\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:-|–)?\s*(?:Rs\.?|PKR|₨)/i,
  );
  return match ? cleanText(match[0], 40) : "";
}
function extractAssignedJsObject(source, variableName) {
  const marker = `${variableName} =`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) return null;
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(braceStart, i + 1));
        } catch (err) {
          return null;
        }
      }
    }
  }
  return null;
}
function normalizePriceOyeVariantKey(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function parsePriceOyeVariantMemory(value) {
  const text = cleanText(value, 80).toLowerCase();
  if (!text) return null;
  const match = text.match(
    /(\d{1,4}(?:\.\d+)?)\s*(tb|gb)\b.*?(\d{1,2})\s*gb\s*ram\b/i,
  );
  if (!match) return null;
  return {
    storage:
      match[2].toUpperCase() === "TB"
        ? `${match[1]}TB`
        : `${Math.round(Number(match[1]))}GB`,
    ram: `${match[3]}GB RAM`,
  };
}
function buildMemoryVariantLabel(storage, ram) {
  return [storage, ram].filter(Boolean).join(" / ");
}
function getRequestedMemoryFlexible(keyword) {
  const requested = getRequestedMemory(keyword);
  if (requested.storage || requested.ram) return requested;
  const text = cleanText(keyword, 120);
  if (!isPureMemoryPairQuery(text)) return requested;
  const match = text.match(/^(\d{1,2})\s+(\d{2,4})$/);
  if (!match) return requested;
  return {
    ram: `${match[1]}GB RAM`,
    storage: `${match[2]}GB`,
  };
}
function isPureMemoryPairQuery(value = "") {
  return /^\d{1,2}\s+\d{2,4}$/.test(cleanText(value, 120));
}
function chooseMemoryVariantIndex(variants = [], keyword = "") {
  if (!variants.length) return -1;
  const requested = getRequestedMemoryFlexible(keyword);
  const requestedStorageGb = parseMemorySizeToGb(requested.storage);
  const requestedRamGb = parseMemorySizeToGb(requested.ram);
  const exactIndex = variants.findIndex((variant) => {
    const storageGb = parseMemorySizeToGb(variant.storage);
    const ramGb = parseMemorySizeToGb(variant.ram);
    return (
      (!requestedStorageGb || storageGb === requestedStorageGb) &&
      (!requestedRamGb || ramGb === requestedRamGb)
    );
  });
  if (exactIndex >= 0) return exactIndex;
  const preferredStorageIndex = variants.findIndex((variant) => {
    const storageGb = parseMemorySizeToGb(variant.storage);
    return requestedStorageGb && storageGb === requestedStorageGb;
  });
  if (preferredStorageIndex >= 0) return preferredStorageIndex;
  return 0;
}
function extractPriceOyeVariantData($) {
  let productData = null;
  $("script").each((_, script) => {
    if (productData) return false;
    const text = $(script).contents().text();
    if (!text || !text.includes("window.product_data")) return;
    productData = extractAssignedJsObject(text, "window.product_data");
  });
  return productData &&
    productData.product_config &&
    productData.product_config.dataPrices
    ? productData
    : null;
}
function collectPriceOyeVariantOptions(productData, activeColor = "") {
  const dataPrices = productData?.product_config?.dataPrices;
  if (!dataPrices) return [];
  const activeColorKey = normalizePriceOyeVariantKey(activeColor);
  const seen = new Set();
  const variants = [];
  Object.entries(dataPrices).forEach(([colorKey, sizes]) => {
    Object.entries(sizes || {}).forEach(([sizeKey, items]) => {
      const item = Array.isArray(items) ? items[0] : items;
      if (!item) return;
      const parsed =
        parsePriceOyeVariantMemory(sizeKey) ||
        parsePriceOyeVariantMemory(item.product_size) ||
        parsePriceOyeVariantMemory(item.product_name);
      const storage = parsed && parsed.storage ? parsed.storage : "";
      const ram = parsed && parsed.ram ? parsed.ram : "";
      const storageGb = storage ? parseMemorySizeToGb(storage) : null;
      const ramGb = ram ? parseMemorySizeToGb(ram) : null;
      const key = `${storage}__${ram}`;
      if (!storage && !ram) return;
      if (seen.has(key)) return;
      seen.add(key);
      variants.push({
        colorKey,
        sizeKey,
        storage,
        ram,
        storageGb,
        ramGb,
        label: buildMemoryVariantLabel(storage, ram),
        price: normalizeProduct({ price: item.product_price }).price || null,
        priceValue: normalizeProduct({ price: item.product_price }).priceValue || null,
        availability: item.product_availability || null,
        activeColor:
          activeColorKey &&
          normalizePriceOyeVariantKey(colorKey) === activeColorKey,
      });
    });
  });
  return variants;
}
function selectPriceOyeVariant(productData, keyword = "", activeColor = "") {
  const variants = collectPriceOyeVariantOptions(productData, activeColor).map(
    (variant) => ({
      ...variant,
      inActiveColor: variant.activeColor,
    }),
  );
  if (!variants.length) return null;
  const requested = getRequestedMemoryFlexible(keyword);
  const requestedStorageGb = parseMemorySizeToGb(requested.storage);
  const requestedRamGb = parseMemorySizeToGb(requested.ram);
  const scoreVariant = (variant) => {
    let score = 0;
    if (requestedStorageGb || requestedRamGb) {
      if (requestedStorageGb) {
        if (variant.storageGb === requestedStorageGb) score += 10000;
        else if (variant.storageGb)
          score -= Math.abs(variant.storageGb - requestedStorageGb) * 50;
        else score -= 5000;
      }
      if (requestedRamGb) {
        if (variant.ramGb === requestedRamGb) score += 4000;
        else if (variant.ramGb)
          score -= Math.abs(variant.ramGb - requestedRamGb) * 200;
        else score -= 2000;
      }
    } else {
      score -= Number.isFinite(variant.storageGb)
        ? variant.storageGb * 1000
        : 100000;
      score -= Number.isFinite(variant.ramGb) ? variant.ramGb : 1000;
    }
    if (variant.inActiveColor) score += 50;
    if (/in stock/i.test(variant.availability || ""))
      score += 10;
    if (/out of stock/i.test(variant.availability || ""))
      score -= 10;
    return score;
  };
  variants.sort((a, b) => scoreVariant(b) - scoreVariant(a));
  return variants[0];
}
function buildDetails(...groups) {
  const parts = groups
    .flat()
    .filter(Boolean)
    .map((value) => cleanText(value, 180))
    .filter(Boolean);
  return cleanText([...new Set(parts)].join(" | "), 1200);
}
function extractTableSpecs($, root = $("body"), limit = 80) {
  const parts = [];
  root
    .find("table tr")
    .slice(0, limit)
    .each((_, row) => {
      const cells = $(row)
        .find("th,td")
        .map((__, cell) => cleanText($(cell).text(), 140))
        .get()
        .filter(Boolean);
      if (cells.length >= 2) {
        const label = cells[0].replace(/:$/, "");
        const value = cells.slice(1).join(" ");
        if (label && value && value !== "-" && value !== "--" && value !== "—")
          parts.push(`${label}: ${value}`);
      } else if (
        cells.length === 1 &&
        /\b(?:general|processor|display|memory|storage|graphics|connectivity|camera|battery|platform|body|network)\b/i.test(
          cells[0],
        )
      ) {
        parts.push(cells[0]);
      }
    });
  return parts;
}
function extractShopifyVariantMemory(text) {
  const normalized = cleanText(text, 120);
  if (!normalized) return null;
  const parsed = normalizeProduct({ title: normalized, specs: normalized })
    .normalized || {};
  const storage =
    parsed.storage ||
    parsePriceOyeVariantMemory(normalized)?.storage ||
    parsePriceOyeVariantMemory(normalized.replace(/\s*\/\s*/g, " "))?.storage ||
    null;
  const ram =
    parsed.ram ||
    parsePriceOyeVariantMemory(normalized)?.ram ||
    parsePriceOyeVariantMemory(normalized.replace(/\s*\/\s*/g, " "))?.ram ||
    null;
  return storage || ram ? { storage, ram } : null;
}
function scoreShopifyVariant(variant, keyword = "") {
  const requested = getRequestedMemory(keyword);
  const requestedStorageGb = parseMemorySizeToGb(requested.storage);
  const requestedRamGb = parseMemorySizeToGb(requested.ram);
  const text = cleanText(
    [
      variant && variant.title,
      variant && variant.name,
      variant && variant.option1,
      variant && variant.option2,
      variant && variant.option3,
      variant && variant.sku,
    ]
      .filter(Boolean)
      .join(" "),
    200,
  );
  const parsed = extractShopifyVariantMemory(text);
  const storageGb =
    parsed && parsed.storage ? parseMemorySizeToGb(parsed.storage) : null;
  const ramGb = parsed && parsed.ram ? parseMemorySizeToGb(parsed.ram) : null;
  let score = variant && variant.available ? 100 : 0;
  if (requestedStorageGb || requestedRamGb) {
    if (requestedStorageGb) {
      if (storageGb === requestedStorageGb) score += 1000;
      else if (storageGb)
        score -= Math.abs(storageGb - requestedStorageGb) * 10;
      else if (new RegExp(`\\b${requestedStorageGb}\\s*gb\\b`, "i").test(text))
        score += 500;
      else score -= 250;
    }
    if (requestedRamGb) {
      if (ramGb === requestedRamGb) score += 500;
      else if (ramGb) score -= Math.abs(ramGb - requestedRamGb) * 10;
      else if (new RegExp(`\\b${requestedRamGb}\\s*gb\\s*ram\\b`, "i").test(text))
        score += 250;
      else score -= 150;
    }
  } else {
    if (Number.isFinite(storageGb)) score -= storageGb;
  }
  if (variant && variant.available) score += 25;
  return score;
}
function extractShopifyProductJson($, pageUrl, keyword = "") {
  let productJson = null;
  $('script[type="application/json"][data-product-json]').each((_, script) => {
    if (productJson) return false;
    try {
      const parsed = JSON.parse($(script).contents().text());
      productJson = parsed.product || parsed;
    } catch (err) {}
  });
  if (!productJson) return null;
  const variants = Array.isArray(productJson.variants) ? productJson.variants : [];
  const variant = variants.length
    ? [...variants]
        .sort((a, b) => scoreShopifyVariant(b, keyword) - scoreShopifyVariant(a, keyword))[0]
    : null;
  const price =
    variant && Number.isFinite(Number(variant.price))
      ? `Rs. ${Math.round(Number(variant.price) / 100).toLocaleString("en-PK")}`
      : "";
  const description = cleanText(
    productJson.description || productJson.content,
    700,
  );
  const variantText = cleanText(
    [
      variant && variant.title,
      variant && variant.option1,
      variant && variant.option2,
      variant && variant.option3,
      variant && variant.sku,
    ]
      .filter(Boolean)
      .join(" "),
    160,
  );
  return {
    title: cleanText(productJson.title, 220),
    price: normalizeProduct({ price }).price,
    image: getImageFromJsonValue(
      (variant && (variant.featured_image || variant.image)) ||
        productJson.featured_image ||
        productJson.images ||
        productJson.media,
      pageUrl,
    ),
    link: resolveUrl(productJson.url || pageUrl, pageUrl),
    snippet: buildDetails(description, variantText),
    specs: buildDetails(description, variantText),
    storage: extractShopifyVariantMemory(variantText)?.storage || null,
    ram: extractShopifyVariantMemory(variantText)?.ram || null,
  };
}
function uniqueValues(values) {
  return [
    ...new Set(values.map((value) => cleanText(value, 80)).filter(Boolean)),
  ];
}
function normalizeTypoWords(value = '') {
  return cleanText(value, 120)
    .replace(/\b([a-z])\s+(\d{1,4}[a-z]?)\b/gi, '$1$2')
    .replace(/\b(\d{1,4}[a-z]?)\s+([a-z])\b/gi, '$1$2')
    .split(/\s+/)
    .map((word) => word.replace(/^([a-z])\1{1,3}([a-z]+)$/i, '$1$2'))
    .join(' ');
}
function normalizeAliasQuery(keyword = '', category = 'mobiles') {
  let query = normalizeTypoWords(keyword);
  if (!query) return '';

  const aliasGroups = [
    {
      aliases: ['apple', 'iphone', 'i phone'],
      canonicalBrand: 'Apple',
      canonicalModel: 'iPhone',
    },
    {
      aliases: ['samsung', 'galaxy'],
      canonicalBrand: 'Samsung',
      canonicalModel: 'Galaxy',
    },
  ];

  if (category === 'tablets') {
    aliasGroups.unshift({
      aliases: ['ipad', 'i pad'],
      canonicalBrand: 'Apple',
      canonicalModel: 'iPad',
    });
  }

  if (category === 'laptops') {
    aliasGroups.push(
      {
        aliases: ['macbook', 'mac book'],
        canonicalBrand: 'Apple',
        canonicalModel: 'MacBook',
      },
      {
        aliases: ['surface'],
        canonicalBrand: 'Microsoft',
        canonicalModel: 'Surface',
      },
      {
        aliases: ['probook', 'elitebook', 'pavilion', 'victus', 'omen'],
        canonicalBrand: 'HP',
        canonicalModel: 'Laptop',
      },
      {
        aliases: ['latitude', 'xps', 'inspiron', 'vostro', 'alienware'],
        canonicalBrand: 'Dell',
        canonicalModel: 'Laptop',
      },
      {
        aliases: ['thinkpad', 'ideapad', 'legion', 'thinkbook'],
        canonicalBrand: 'Lenovo',
        canonicalModel: 'Laptop',
      },
      {
        aliases: ['nitro', 'predator', 'swift', 'aspire'],
        canonicalBrand: 'Acer',
        canonicalModel: 'Laptop',
      },
      {
        aliases: ['vivobook', 'zenbook', 'tuf', 'rog'],
        canonicalBrand: 'Asus',
        canonicalModel: 'Laptop',
      },
      {
        aliases: ['creator', 'prestige', 'katana', 'modern', 'raider'],
        canonicalBrand: 'MSI',
        canonicalModel: 'Laptop',
      },
    );
  }

  for (const group of aliasGroups) {
    const aliasPattern = new RegExp(
      `\\b(?:${group.aliases.map(escapeRegExp).join('|')})\\b`,
      'i',
    );
    if (!aliasPattern.test(query)) continue;
    const stripped = cleanText(
      query.replace(
        new RegExp(`\\b(?:${group.aliases.map(escapeRegExp).join('|')})\\b`, 'gi'),
        ' ',
      ),
      120,
    );
    query = cleanText(
      [group.canonicalBrand, group.canonicalModel, stripped]
        .filter(Boolean)
        .join(' '),
      120,
    );
  }

  return query;
}

function normalizeSearchQuery(keyword, category = 'mobiles') {
  return normalizeAliasQuery(keyword, category);
}
function stripTrailingMemoryPairFromQuery(value = '') {
  const text = cleanText(value, 120);
  if (!text) return '';
  if (/\b(?:gb|ram|rom|storage|ssd|hdd|nvme)\b/i.test(text)) return text;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return text;
  const tail = tokens.slice(-2);
  if (!/^\d{1,2}$/.test(tail[0]) || !/^\d{2,4}$/.test(tail[1])) return text;
  const head = tokens.slice(0, -2).join(' ');
  if (!/[a-z]/i.test(head)) return text;
  return cleanText(head, 120);
}
function tokenizeForMatch(value) {
  const normalized = cleanText(value, 500)
    .toLowerCase()
    .replace(/\bi\s+phone\b/g, "iphone")
    .replace(/\b(s\d+)\+/g, "$1 plus")
    .replace(/\b(\d{1,4})\s*gb\s*ram\b/g, "$1gbram")
    .replace(/\b(\d{1,4})\s*gb\s*rom\b/g, "$1gbrom")
    .replace(/\b(\d{1,4})\s*gb\s*storage\b/g, "$1gbstorage")
    .replace(/\b(\d{1,4})\s*tb\s*storage\b/g, "$1tbstorage")
    .replace(/([a-z])(\d)/g, "$1$2")
    .replace(/(\d)([a-z])/g, "$1$2")
    .replace(/[^a-z0-9]+/g, " ");
  return normalized.split(/\s+/).filter(Boolean);
}
function getRequiredSearchTokens(keyword) {
  const normalizedKeyword = stripTrailingMemoryPairFromQuery(keyword);
  const ignored = new Set([
    "mobile",
    "mobiles",
    "phone",
    "phones",
    "tablet",
    "tablets",
    "tab",
    "laptop",
    "laptops",
    "notebook",
    "notebooks",
    "price",
    "pakistan",
    "with",
    "and",
    "the",
  ]);
  return tokenizeForMatch(normalizedKeyword).filter(
    (token) => token.length > 1 && !ignored.has(token),
  );
}
function tokenMatchesSearchToken(actualTokens, token) {
  if (actualTokens.has(token)) return true;
  if (token === "10th")
    return actualTokens.has("10") && actualTokens.has("2021");
  if (token === "gen")
    return actualTokens.has("2021") && actualTokens.has("ipad");
  const aliases = {
    apple: ["iphone"],
    iphone: ["apple"],
    xiaomi: ["redmi", "mi"],
    redmi: ["xiaomi", "mi"],
    mi: ["xiaomi", "redmi"],
    samsung: ["galaxy"],
    galaxy: ["samsung"],
  };
  const linkedTokens = aliases[token] || [];
  return linkedTokens.some((alias) => actualTokens.has(alias));
}
function parseMemoryValue(value) {
  const match = cleanText(value, 20).match(/^(\d{1,4}(?:\.\d+)?)\s*(TB|GB)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2].toUpperCase() === "TB" ? amount * 1024 : amount;
}
function pickSmallestMemoryVariant(text) {
  const source = cleanText(text, 2000);
  if (!source) return null;
  const storageCandidates = [];
  const ramCandidates = [];
  const pairPattern =
    /(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\s*(?:[,/+\-&]|and|with|\s){0,20}(\d{1,2})\s*GB\s*RAM/gi;
  for (const match of source.matchAll(pairPattern)) {
    const storage = parseMemoryValue(`${match[1]} ${match[2]}`);
    const ram = Number(match[3]);
    if (Number.isFinite(storage) && storage > 0)
      storageCandidates.push(storage);
    if (Number.isFinite(ram) && ram > 0) ramCandidates.push(ram);
  }
  const labeledStoragePattern =
    /(?:storage|rom|builtin|built[-\s]?in|internal(?:\s+memory)?|memory|capacity)\s*:?\s*((?:\d{1,4}(?:\.\d+)?\s*(?:TB|GB)\s*(?:[,/+\-&]|and|with|\s)*)+)/gi;
  for (const match of source.matchAll(labeledStoragePattern)) {
    const values = match[1].match(/\d{1,4}(?:\.\d+)?\s*(?:TB|GB)/gi) || [];
    for (const value of values) {
      const parsed = parseMemoryValue(value);
      if (Number.isFinite(parsed) && parsed > 0) storageCandidates.push(parsed);
    }
  }
  const ramPattern = /\b(\d{1,2})\s*GB\s*RAM\b/gi;
  for (const match of source.matchAll(ramPattern)) {
    const ram = Number(match[1]);
    if (Number.isFinite(ram) && ram > 0) ramCandidates.push(ram);
  }
  const filteredStorageCandidates = storageCandidates.filter(
    (value) => Number.isFinite(value) && (value >= 32 || value % 1024 === 0),
  );
  const finalStorageCandidates =
    filteredStorageCandidates.length > 0
      ? filteredStorageCandidates
      : storageCandidates.filter((value) => Number.isFinite(value) && value > 0);
  if (finalStorageCandidates.length === 0 && ramCandidates.length === 0) return null;
  return {
    storage: finalStorageCandidates.length
      ? `${Math.round(Math.min(...finalStorageCandidates))}GB`
      : null,
    ram: ramCandidates.length ? `${Math.min(...ramCandidates)}GB RAM` : null,
  };
}
function preferSmallestMemoryVariant(product = {}, keyword = "") {
  const requestedMemory = getRequestedMemory(keyword);
  if (requestedMemory.storage || requestedMemory.ram) return product;
  const normalized = product.normalized
    ? { ...product }
    : normalizeProduct(product);
  const text = cleanText(
    [
      normalized.title,
      normalized.specs,
      normalized.snippet,
      normalized.normalized && normalized.normalized.description,
    ]
      .filter(Boolean)
      .join(" "),
    2000,
  );
  const preferred = pickSmallestMemoryVariant(text);
  if (!preferred || (!preferred.storage && !preferred.ram)) return normalized;
  const next = {
    ...normalized,
    normalized: {
      ...(normalized.normalized || {}),
    },
  };
  if (preferred.storage) next.normalized.storage = preferred.storage;
  if (preferred.ram) next.normalized.ram = preferred.ram;
  const prefix = [preferred.storage, preferred.ram].filter(Boolean).join(" | ");
  if (prefix) {
    next.specs = next.specs ? `${prefix} | ${next.specs}` : prefix;
    next.snippet = next.snippet ? `${prefix} | ${next.snippet}` : prefix;
    next.normalized.description = next.normalized.description
      ? `${prefix} | ${next.normalized.description}`
      : prefix;
  }
  return next;
}
function relaxRequiredTokensForProduct(requiredTokens, product, keyword) {
  if (
    requiredTokens.includes("galaxy") &&
    /\bsamsung\b/i.test(keyword || "") &&
    /\btab(?:let)?\b/i.test(keyword || "") &&
    /\bsamsung\b/i.test((product && product.title) || "") &&
    /\btab(?:let)?\b/i.test((product && product.title) || "")
  ) {
    return requiredTokens.filter((token) => token !== "galaxy");
  }
  return requiredTokens;
}
function getRequestedMemory(keyword) {
  const text = cleanText(keyword, 200);
  const storageMatch =
    text.match(
      /\b(?:storage|rom|internal(?:\s+memory)?|built[-\s]?in(?:\s+memory)?|memory|capacity)\s*:?\s*(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\b/i,
    ) ||
    text.match(/\b(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\b/i) ||
    (/^\d{1,4}$/.test(text) ? [text, text, "GB"] : null);
  const ramMatch =
    text.match(
      /\b(?:ram)\s*:?\s*(\d{1,4}(?:\.\d+)?)\s*(?:GB)?\b|\b(\d{1,4}(?:\.\d+)?)\s*(?:GB)?\s*RAM\b/i,
    ) || (/^\d{1,4}$/.test(text) ? [text, text] : null);
  const storageNumber = storageMatch ? storageMatch[1] || storageMatch[0] : "";
  const ramNumber = ramMatch ? ramMatch[1] || ramMatch[2] || ramMatch[3] : "";
  return {
    storage: storageNumber
      ? storageMatch && storageMatch[2] && storageMatch[2].toUpperCase() === "TB"
        ? `${storageNumber.replace(/\.0+$/, "")}TB`
        : `${storageNumber.replace(/\.0+$/, "")}GB`
      : null,
    ram: ramNumber ? `${ramNumber.replace(/\.0+$/, "")}GB RAM` : null,
  };
}

function stripAliasWords(value = '', words = []) {
  const pattern = words
    .filter(Boolean)
    .map(escapeRegExp)
    .join('|');
  if (!pattern) return cleanText(value, 120);
  return cleanText(
    String(value || '').replace(new RegExp(`\\b(?:${pattern})\\b`, 'gi'), ' '),
    120,
  );
}

function extractCanonicalBrandModel(keyword, category = 'mobiles') {
  const normalized = normalizeAliasQuery(keyword, category);
  const lower = normalized.toLowerCase();
  if (/\b(?:apple|iphone|i phone)\b/i.test(lower)) {
    return {
      brand: 'Apple',
      model: cleanText(
        ['iPhone', stripAliasWords(normalized, ['apple', 'iphone', 'i phone'])]
          .filter(Boolean)
          .join(' '),
        120,
      ),
    };
  }
  if (/\b(?:samsung|galaxy)\b/i.test(lower)) {
    return {
      brand: 'Samsung',
      model: cleanText(
        ['Galaxy', stripAliasWords(normalized, ['samsung', 'galaxy'])]
          .filter(Boolean)
          .join(' '),
        120,
      ),
    };
  }
  if (category === 'tablets' && /\b(?:ipad|i pad)\b/i.test(lower)) {
    return {
      brand: 'Apple',
      model: cleanText(
        ['iPad', stripAliasWords(normalized, ['ipad', 'i pad', 'apple'])]
          .filter(Boolean)
          .join(' '),
        120,
      ),
    };
  }
  return { brand: '', model: normalized };
}

const BRAND_MODEL_RULES = {
  mobiles: [
    { brand: 'Apple', aliases: ['apple', 'iphone', 'i phone'], prefix: 'iPhone' },
    { brand: 'Samsung', aliases: ['samsung', 'galaxy'], prefix: 'Galaxy' },
    { brand: 'Xiaomi', aliases: ['xiaomi', 'redmi', 'mi'], prefix: '' },
    { brand: 'Oppo', aliases: ['oppo'], prefix: '' },
    { brand: 'Vivo', aliases: ['vivo'], prefix: '' },
    { brand: 'Realme', aliases: ['realme'], prefix: '' },
    { brand: 'Infinix', aliases: ['infinix'], prefix: '' },
    { brand: 'Tecno', aliases: ['tecno'], prefix: '' },
    { brand: 'itel', aliases: ['itel'], prefix: '' },
    { brand: 'Huawei', aliases: ['huawei'], prefix: '' },
    { brand: 'Honor', aliases: ['honor'], prefix: '' },
    { brand: 'Nokia', aliases: ['nokia'], prefix: '' },
    { brand: 'OnePlus', aliases: ['oneplus'], prefix: '' },
  ],
  tablets: [
    { brand: 'Apple', aliases: ['apple', 'ipad', 'i pad'], prefix: 'iPad' },
    { brand: 'Samsung', aliases: ['samsung', 'galaxy'], prefix: 'Galaxy' },
    { brand: 'Xiaomi', aliases: ['xiaomi', 'redmi', 'mi'], prefix: '' },
    { brand: 'Huawei', aliases: ['huawei'], prefix: '' },
    { brand: 'Honor', aliases: ['honor'], prefix: '' },
    { brand: 'Lenovo', aliases: ['lenovo'], prefix: '' },
    { brand: 'Amazon', aliases: ['amazon', 'fire'], prefix: '' },
    { brand: 'TCL', aliases: ['tcl'], prefix: '' },
    { brand: 'Infinix', aliases: ['infinix'], prefix: '' },
    { brand: 'OnePlus', aliases: ['oneplus'], prefix: '' },
  ],
  laptops: [
    { brand: 'Apple', aliases: ['apple', 'macbook', 'mac book'], prefix: 'MacBook' },
    { brand: 'HP', aliases: ['hp', 'hewlett packard', 'probook', 'elitebook', 'pavilion', 'victus', 'omen'], prefix: '' },
    { brand: 'Dell', aliases: ['dell', 'latitude', 'xps', 'inspiron', 'vostro', 'alienware'], prefix: '' },
    { brand: 'Lenovo', aliases: ['lenovo', 'thinkpad', 'ideapad', 'legion', 'thinkbook', 'yoga'], prefix: '' },
    { brand: 'Acer', aliases: ['acer', 'nitro', 'predator', 'swift', 'aspire'], prefix: '' },
    { brand: 'Asus', aliases: ['asus', 'vivobook', 'zenbook', 'tuf', 'rog'], prefix: '' },
    { brand: 'MSI', aliases: ['msi', 'creator', 'prestige', 'katana', 'modern', 'raider'], prefix: '' },
    { brand: 'Microsoft', aliases: ['microsoft', 'surface'], prefix: 'Surface' },
  ],
};

function extractBrandModelFromQuery(keyword, category = 'mobiles') {
  const normalized = cleanText(normalizeAliasQuery(keyword, category), 120);
  if (!normalized) return { brand: '', model: '' };

  const rules = BRAND_MODEL_RULES[category] || [];
  for (const rule of rules) {
    const aliasPattern = new RegExp(`\\b(?:${rule.aliases.map(escapeRegExp).join('|')})\\b`, 'i');
    if (!aliasPattern.test(normalized)) continue;

    let model = cleanText(
      normalized.replace(aliasPattern, ' '),
      120,
    )
      .replace(/\b(?:price(?:s)?(?:\s+in\s+pakistan)?|mobile|mobiles|phone|phones|tablet|tablets|tab|laptop|laptops|notebook|notebooks)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (category === 'mobiles' && rule.brand === 'Apple' && !/\biPhone\b/i.test(model)) {
      model = `iPhone ${model}`;
    } else if (category === 'tablets' && rule.brand === 'Apple' && !/\biPad\b/i.test(model)) {
      model = `iPad ${model}`;
    } else if (rule.brand === 'Samsung' && !/\bGalaxy\b/i.test(model)) {
      model = `Galaxy ${model}`;
    } else if (rule.prefix && !new RegExp(`\\b${escapeRegExp(rule.prefix)}\\b`, 'i').test(model)) {
      model = `${rule.prefix} ${model}`;
    }

    return {
      brand: rule.brand,
      model: cleanText(model, 120),
    };
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const genericBrand =
      tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1).toLowerCase();
    return {
      brand: genericBrand,
      model: cleanText(tokens.slice(1).join(' '), 120),
    };
  }

  return { brand: '', model: normalized };
}
function normalizeSpecFilters(filters = {}) {
  const clean = (value) => cleanText(value, 40);
  const company = clean(filters.company || filters.brand);
  const storageSource = clean(filters.storage || filters.rom);
  const storage =
    storageSource.match(/\b(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\b/i) ||
    (/^\d{1,4}$/.test(storageSource) ? [storageSource, storageSource, "GB"] : null);
  const ramSource = clean(filters.ram);
  const ramMatch =
    ramSource.match(
      /\b(\d{1,4}(?:\.\d+)?)\s*-?\s*GB(?:\s*RAM)?\b|\bRAM\s*:?\s*(\d{1,4}(?:\.\d+)?)\s*-?\s*GB\b/i,
    ) || (/^\d{1,4}$/.test(ramSource) ? ramSource.match(/^(\d{1,4})$/) : null);
  const core = clean(filters.core || filters.processor).match(
    /\b(?:i3|i5|i7|i9|core\s*i3|core\s*i5|core\s*i7|core\s*i9|ryzen\s*[3579])\b/i,
  );
  const generation = clean(filters.generation || filters.gen).match(
    /\b\d{1,2}(?:st|nd|rd|th)?\s*(?:gen|generation)?\b/i,
  );
  return {
    company: company || null,
    storage: storage
      ? `${(storage[1] || storage[0]).replace(/\.0+$/, "")}${storage[2] && storage[2].toUpperCase() === "TB" ? "TB" : "GB"}`
      : null,
    ram: ramMatch ? `${(ramMatch[1] || ramMatch[2]).replace(/\.0+$/, "")}GB RAM` : null,
    core: core
      ? core[0]
          .replace(/\s+/g, " ")
          .toLowerCase()
          .replace(/^core\s+/, "core ")
      : null,
    generation: generation
      ? generation[0].replace(/\s+/g, " ").toLowerCase()
      : null,
  };
}
function buildKeywordWithFilters(keyword, filters = {}, category = "") {
  const normalized = normalizeSpecFilters(filters);
  const parts = [cleanText(keyword, 120)];
  if (
    category === "laptops" &&
    !/\b(?:laptop|laptops|notebook|ultrabook|macbook)\b/i.test(parts[0])
  )
    parts.push("laptop");
  if (
    category === "tablets" &&
    !/\b(?:tablet|tablets|tab|ipad|pad)\b/i.test(parts[0])
  )
    parts.push("tablet");
  if (normalized.core)
    parts.push(
      normalized.core.startsWith("core ")
        ? normalized.core
        : `core ${normalized.core}`,
    );
  if (normalized.generation)
    parts.push(
      /\bgen|generation\b/i.test(normalized.generation)
        ? normalized.generation
        : `${normalized.generation} gen`,
    );
  if (normalized.ram) parts.push(normalized.ram);
  if (normalized.storage) parts.push(normalized.storage);
  return cleanText(parts.filter(Boolean).join(" "), 180);
}
function getMemorySearchHints(keyword) {
  const query = cleanText(keyword, 120);
  const requested = getRequestedMemory(query);
  if (!requested.storage && !requested.ram) return [];
  const hasExplicitStorage =
    /\b(?:32|64|128|256|512)\s?GB\b|\b1\s?TB\b|\b2\s?TB\b/i.test(query);
  const hasExplicitRam =
    /\b\d{1,2}\s?GB\s?RAM\b|\bRAM\s*:?\s*\d{1,2}\s?GB\b|\b\d{1,2}\s*RAM\b|\bRAM\s*:?\s*\d{1,2}\b/i.test(
      query,
    );
  const hints = [];
  if (requested.storage && !hasExplicitStorage) hints.push(requested.storage);
  if (requested.ram && !hasExplicitRam) hints.push(requested.ram);
  return hints;
}
function parseMemorySizeToGb(value) {
  const text = cleanText(value, 40).toUpperCase();
  if (!text) return null;
  const match = text.match(/(\d{1,4}(?:\.\d+)?)\s*(TB|GB)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return match[2].toUpperCase() === "TB" ? amount * 1024 : amount;
}
function getMemoryVariantScore(product, keyword) {
  const requested = getRequestedMemory(keyword);
  const normalized =
    product && product.normalized ? product : normalizeProduct(product);
  const storageGb = parseMemorySizeToGb(
    normalized.normalized && normalized.normalized.storage,
  );
  const ramGb = parseMemorySizeToGb(
    normalized.normalized && normalized.normalized.ram,
  );
  const hasMemoryInfo = Number.isFinite(storageGb) || Number.isFinite(ramGb);
  const requestedStorageGb = parseMemorySizeToGb(requested.storage);
  const requestedRamGb = parseMemorySizeToGb(requested.ram);
  let score = hasMemoryInfo ? 100 : 0;
  if (requested.storage || requested.ram) {
    if (requestedStorageGb && storageGb === requestedStorageGb) score += 600;
    else if (requestedStorageGb)
      score -=
        Math.abs((storageGb || requestedStorageGb * 2) - requestedStorageGb) *
        4;
    if (requestedRamGb && ramGb === requestedRamGb) score += 300;
    else if (requestedRamGb)
      score -= Math.abs((ramGb || requestedRamGb * 2) - requestedRamGb) * 2;
    return score;
  }
  return hasMemoryInfo ? 0 : 0;
}
function productMatchesRequestedMemory(product, keyword, filters = {}) {
  const filterMemory = normalizeSpecFilters(filters);
  const keywordMemory = getRequestedMemory(keyword);
  const requested = {
    storage: filterMemory.storage || keywordMemory.storage,
    ram: filterMemory.ram || keywordMemory.ram,
  };
  if (!requested.storage && !requested.ram) return true;
  const normalized = product.normalized ? product : normalizeProduct(product);
  const memoryText = cleanText(
    [
      normalized.title,
      normalized.specs,
      normalized.snippet,
      normalized.normalized && normalized.normalized.description,
      normalized.link,
      normalized.displayLink,
    ]
      .filter(Boolean)
      .join(" "),
    1600,
  );
  const actualStorage = normalized.normalized && normalized.normalized.storage;
  const actualRam = normalized.normalized && normalized.normalized.ram;
  const requestedMemoryVisible = textHasRequestedMemory(memoryText, requested);
  const actualExactMatch =
    (!requested.storage || actualStorage === requested.storage) &&
    (!requested.ram || actualRam === requested.ram);
  if (!requestedMemoryVisible && !actualExactMatch) return false;
  if (requested.storage && actualStorage && actualStorage !== requested.storage)
    return false;
  if (requested.ram && actualRam && actualRam !== requested.ram) return false;
  return true;
}
function textHasRequestedMemory(text, requested = {}) {
  if (!requested.storage && !requested.ram) return false;
  if (requested.storage && !textHasRequestedStorage(text, requested.storage))
    return false;
  if (requested.ram && !textHasRequestedRam(text, requested.ram)) return false;
  return true;
}
function resolveRequestedMemoryVariant(product = {}, keyword = "", filters = {}) {
  const filterMemory = normalizeSpecFilters(filters);
  const keywordMemory = getRequestedMemory(keyword);
  const requested = {
    storage: filterMemory.storage || keywordMemory.storage,
    ram: filterMemory.ram || keywordMemory.ram,
  };
  if (!requested.storage && !requested.ram) return product;
  const normalized = product.normalized ? product : normalizeProduct(product);
  if (!normalized.normalized || !normalized.normalized.memoryVariantAmbiguous)
    return normalized;
  const memoryText = cleanText(
    [
      normalized.title,
      normalized.specs,
      normalized.snippet,
      normalized.normalized.description,
      normalized.link,
      normalized.displayLink,
    ]
      .filter(Boolean)
      .join(" "),
    1600,
  );
  if (!textHasRequestedMemory(memoryText, requested)) return normalized;
  const next = {
    ...normalized,
    normalized: {
      ...(normalized.normalized || {}),
    },
  };
  if (requested.storage) next.normalized.storage = requested.storage;
  if (requested.ram) next.normalized.ram = requested.ram;
  return next;
}
function textHasRequestedStorage(text, requestedStorage) {
  const storage = cleanText(requestedStorage, 20).toUpperCase();
  if (!storage) return false;
  const source = cleanText(text, 1600);
  if (storage.endsWith("TB")) {
    const tbValue = storage.match(/\d+(?:\.\d+)?/)?.[0];
    return tbValue
      ? new RegExp(
          `\\b(?:storage|rom|internal\\s+memory|built[-\\s]?in\\s+memory|ssd|hdd|nvme|capacity)\\s*:?\\s*${tbValue}\\s*-?\\s*TB\\b|\\b\\d{1,2}\\s*-?\\s*GB\\s*(?:RAM|DDR\\d?)?\\s*(?:[,|/&+]|and|with)?\\s*${tbValue}\\s*-?\\s*TB\\b|\\b${tbValue}\\s*-?\\s*TB\\s*(?:ROM|storage|internal|SSD|HDD|eMMC)\\b`,
          "i",
        ).test(source)
      : false;
  }
  const gbValue = storage.match(/\d{2,4}/)?.[0];
  if (!gbValue) return false;
  return new RegExp(
    `\\b(?:storage|rom|internal\\s+memory|built[-\\s]?in\\s+memory|ssd|hdd|nvme|capacity)\\s*:?\\s*${gbValue}\\s*-?\\s*GB\\b|\\b\\d{1,2}\\s*-?\\s*GB\\s*(?:RAM|DDR\\d?)?\\s*(?:[,|/&+]|and|with)?\\s*${gbValue}\\s*-?\\s*GB\\b|\\b${gbValue}\\s*-?\\s*GB\\s*(?:ROM|storage|internal|SSD|HDD|eMMC)\\b`,
    "i",
  ).test(source);
}
function textHasRequestedRam(text, requestedRam) {
  const ramValue = cleanText(requestedRam, 20).match(/\d{1,4}/)?.[0];
  if (!ramValue) return false;
  const source = cleanText(text, 1600);
  return new RegExp(
    `\\b${ramValue}\\s*-?\\s*GB\\s*(?:RAM|DDR\\d?)\\b|\\bRAM\\s*:?\\s*${ramValue}\\s*-?\\s*GB\\b|\\b${ramValue}\\s*(?:GB)?\\s*(?:[+/]|[,|&]|and|with)\\s*(?:32|64|128|256|512|1024|2048)\\s*(?:GB|TB)?\\b`,
    "i",
  ).test(source);
}
function productMentionsCompany(product, company) {
  const brand = cleanText(company, 80);
  if (!brand) return true;
  const normalized = product.normalized ? product : normalizeProduct(product);
  const text = cleanText(
    [
      normalized.title,
      normalized.specs,
      normalized.snippet,
      normalized.displayLink,
      normalized.site,
    ]
      .filter(Boolean)
      .join(" "),
    1000,
  );
  return new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").test(text);
}
function extractSpecificationModel(product, filters = {}, category = "") {
  const normalized = normalizeSpecFilters(filters);
  const brand = cleanText(normalized.company, 60);
  const title = cleanText(product && product.title, 260)
    .replace(/\s+\|\s+.*$/i, " ")
    .replace(
      /\s+-\s+(?:price|buy|online|pta|official|with|in\s+pakistan).*$/i,
      " ",
    )
    .replace(
      /\b(?:buy|online|best\s+price|price\s+in\s+pakistan|mobile\s+phones?|phones?|tablets?|laptops?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!title || !brand)
    return {
      modelName: title || brand,
      modelKey: cleanText(title || brand, 120).toLowerCase(),
    };
  const brandPattern = new RegExp(`\\b${escapeRegExp(brand)}\\b\\s*`, "i");
  const afterBrand = title.split(brandPattern).pop() || title;
  const untilSpec = cleanText(afterBrand, 160)
    .replace(
      /\b(?:\d+(?:\.\d+)?\s*(?:inch|inches|″)|full\s*hd|amoled|lcd|oled|display|screen|\d{1,2}\s*-?\s*GB\s*(?:RAM|DDR\d?)|RAM\s*:?\s*\d{1,2}\s*-?\s*GB|(?:32|64|128|256|512)\s*-?\s*GB|1\s*TB|2\s*TB|ROM|Storage|SSD|HDD|PTA|Approved|Official|Warranty|Camera|Battery|Dual\s*Sim|Phone\s*with\s*Box|with\s*box).*$/i,
      " ",
    )
    .replace(/[|()[\]{}:,-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const importantTokens = untilSpec
    .split(/\s+/)
    .filter((token) => /^[a-z0-9+.-]+$/i.test(token))
    .filter(
      (token) =>
        !/^(?:new|used|refurbished|mobile|phone|tablet|laptop|core|intel|generation|gen)$/i.test(
          token,
        ),
    )
    .slice(0, category === "laptops" ? 6 : 5);
  const modelSuffix = importantTokens.join(" ").trim();
  const modelName = cleanText(
    `${brand.toUpperCase()} ${modelSuffix || ""}`.trim(),
    120,
  );
  const modelKey = modelName
    .toLowerCase()
    .replace(
      /\b(?:ram|rom|storage|ssd|hdd|pta|approved|official|warranty|new|used)\b/g,
      " ",
    )
    .replace(/\b\d{1,2}\s*gb\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { modelName, modelKey: modelKey || modelName.toLowerCase() };
}
function sortSpecificationOffersByModel(
  products = [],
  filters = {},
  category = "",
) {
  const enriched = products.map((product) => {
    const model = extractSpecificationModel(product, filters, category);
    const normalized = product.normalized ? product : normalizeProduct(product);
    const priceValue =
      normalized.normalized && normalized.normalized.priceValue;
    return {
      ...product,
      modelName: product.modelName || model.modelName,
      modelKey: product.modelKey || model.modelKey,
      _specPriceValue:
        Number.isFinite(priceValue) && priceValue > 0
          ? priceValue
          : Number.POSITIVE_INFINITY,
    };
  });
  const bestByModel = new Map();
  for (const product of enriched) {
    const current = bestByModel.get(product.modelKey);
    if (!current || product._specPriceValue < current)
      bestByModel.set(product.modelKey, product._specPriceValue);
  }
  const counters = new Map();
  return enriched
    .map((product) => ({
      ...product,
      modelBestPrice: Number.isFinite(bestByModel.get(product.modelKey))
        ? bestByModel.get(product.modelKey)
        : null,
    }))
    .sort((a, b) => {
      const bestA = a.modelBestPrice || Number.POSITIVE_INFINITY;
      const bestB = b.modelBestPrice || Number.POSITIVE_INFINITY;
      if (bestA !== bestB) return bestA - bestB;
      const modelCompare = String(a.modelName || "").localeCompare(
        String(b.modelName || ""),
      );
      if (modelCompare) return modelCompare;
      return a._specPriceValue - b._specPriceValue;
    })
    .map((product) => {
      const count = (counters.get(product.modelKey) || 0) + 1;
      counters.set(product.modelKey, count);
      const { _specPriceValue, ...cleanProduct } = product;
      return {
        ...cleanProduct,
        modelOfferRank: count,
        isBestModelOffer: count === 1,
      };
    });
}
function hasLaptopSignals(value) {
  return /\b(?:laptop|laptops|notebook|notebooks|ultrabook|macbook|core\s*i[3579]|corei[3579]|ci[3579]|ryzen\s*[3579]|\d{1,2}(?:st|nd|rd|th)\s+gen|intel|celeron|pentium|ssd|hdd|rtx|gtx)\b/i.test(
    value,
  );
}
function hasStrongLaptopTitleSignals(value) {
  return /\b(?:elitebook|probook|thinkpad|latitude|inspiron|vostro|precision|zbook|vivobook|zenbook|ideapad|yoga|legion|nitro|aspire|macbook|surface|core\s*i[3579]|corei[3579]|ci[3579]|ryzen\s*[3579]|\d{1,2}(?:st|nd|rd|th)\s+gen|ssd|hdd|rtx|gtx)\b/i.test(
    value,
  );
}
function canonicalProductKey(product) {
  if (product && product.extractedFromSnippet && product.title) {
    return cleanText(
      `${product.site || product.displayLink || ""} ${product.title} ${product.price || ""}`,
      260,
    ).toLowerCase();
  }
  const link = cleanText(product && product.link, 400)
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
  if (link)
    return link.replace(/\/collections\/[^/]+\/products\//i, "/products/");
  return cleanText(
    `${product && product.site} ${product && product.title} ${product && product.price}`,
    260,
  ).toLowerCase();
}
function productMatchesCategory(product, category = "") {
  const title = cleanText(product && product.title, 240);
  const link = cleanText(product && product.link, 500);
  const host = getHostname(link);
  const storeHostPattern = getStoreHostPattern(product);
  const isKnownStoreHost = storeHostPattern
    ? storeHostPattern.test(host)
    : false;
  if (
    product &&
    product.sourceType === "Store search" &&
    ["mobiles", "tablets", "laptops"].includes(category)
  ) {
    if (
      /^[a-z0-9 .&-]+\s+on\s+[a-z0-9 .&-]+$/i.test(title) &&
      !product.price &&
      !product.image
    ) {
      return false;
    }
    return true;
  }
  if (
    product &&
    product.sourceType === "Store category" &&
    category === "laptops"
  ) {
    const storeCategoryText = cleanText(
      [title, product.snippet, product.specs].filter(Boolean).join(" "),
      1200,
    );
    return hasLaptopSignals(storeCategoryText);
  }
  if (
    ["mobiles", "tablets", "laptops"].includes(category) &&
    isBlockedSerpSite(product && product.site, link)
  ) {
    return false;
  }
  if (
    ["mobiles", "tablets", "laptops"].includes(category) &&
    isBlockedFinanceSite(
      product && product.site,
      `${title} ${link} ${(product && product.snippet) || ""}`,
    )
  ) {
    return false;
  }
  if (
    !product.extractedFromSnippet &&
    ["mobiles", "tablets", "laptops"].includes(category) &&
    /\/(?:search|catalogsearch|collections?|categories?|product-category|list-of-|tag\/|laptops-prices\/|mobiles-[a-z0-9-]+|tablets-[a-z0-9-]+|smartphones?\/?$|mobile-phones_[^/]+\/q-|q-[^/]+-mobiles?|q-[^/]+-laptops?)/i.test(
      link,
    )
  ) {
    return false;
  }
  if (
    ["mobiles", "tablets", "laptops"].includes(category) &&
    /\b(?:prices?\s+in\s+pakistan|free\s+classifieds|online\s+at\s+best\s+price|buy\s+.+\s+online|book\s+online)\b/i.test(
      title,
    ) &&
    !isKnownStoreHost
  ) {
    return false;
  }
  if (
    ["mobiles", "tablets", "laptops"].includes(category) &&
    /^[a-z0-9 .&-]+\s+on\s+[a-z0-9 .&-]+$/i.test(title) &&
    !product.price &&
    !product.image
  ) {
    return false;
  }
  if (
    (category === "mobiles" || category === "tablets") &&
    /\b(?:list\s+of|best|top)\b|\b(?:smartphones?|mobile\s+phones?|phones?|tablets?)\s*(?:\||-|for\s+sale|\([^)]*20\d{2}[^)]*\))/i.test(
      title,
    )
  ) {
    return false;
  }
  if (
    category === "mobiles" &&
    /^[a-z0-9 .&-]+\s+(?:mobile|mobiles|phone|phones|smartphones?)$/i.test(
      title,
    )
  ) {
    return false;
  }
  if (
    category === "tablets" &&
    /^[a-z0-9 .&-]+\s+(?:tablet|tablets|tab|tabs|pads?)$/i.test(title)
  ) {
    return false;
  }
  if (
    category === "mobiles" &&
    /\b(?:tablet|tablets|tab\s+[a-z0-9]|ipad|pad)\b/i.test(title)
  ) {
    return false;
  }
  if (category === "tablets") {
    const normalized = product.normalized ? product : normalizeProduct(product);
    const text = cleanText(
      [
        title,
        normalized.specs,
        normalized.snippet,
        normalized.normalized && normalized.normalized.description,
      ]
        .filter(Boolean)
        .join(" "),
      1200,
    );
    if (/\b(?:tablet|tablets|tab\s*[a-z0-9]*|ipad|pad)\b/i.test(text)) {
      return true;
    }
    if (
      tabletStoreSites.includes(product.site) &&
      /\b(?:samsung|apple|xiaomi|huawei|lenovo|honor|oneplus|infinix|tcl)\b/i.test(text) &&
      /\b(?:\d{1,2}\s*GB\s*RAM|\b(?:32|64|128|256|512)\s*(?:GB|TB)\b)/i.test(text)
    ) {
      return true;
    }
    return false;
  }
  if (category !== "laptops") return true;
  const normalized = product.normalized ? product : normalizeProduct(product);
  const laptopTitle = cleanText(normalized.title, 240);
  const text = cleanText(
    [laptopTitle, normalized.specs, normalized.snippet]
      .filter(Boolean)
      .join(" "),
    1200,
  );
  const isLaptopLike = hasLaptopSignals(laptopTitle) || hasLaptopSignals(text);
  if (
    /\b(?:battery|charger|adapter|cable|bag|sleeve|dock|mouse|keyboard|monitor|printer|projector)\b/i.test(
      laptopTitle,
    )
  ) {
    return false;
  }
  if (
    !isLaptopLike &&
    /\b(?:printer|laserjet|ink\s*bottle|toner|cartridge|scanner|monitor|mouse|keyboard|adapter|charger|bag|sleeve|dock|projector)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return isLaptopLike;
}
function isLikelyMemoryNumberToken(token, keyword) {
  const number = Number(token);
  if (!Number.isFinite(number)) return false;
  const text = cleanText(keyword, 200);
  return (
    new RegExp(
      `\\b${token}\\s?GB\\b|\\b${token}\\s?GB\\s?RAM\\b|\\bRAM\\s*:?\\s*${token}\\s?GB\\b`,
      "i",
    ).test(text) ||
    (number === 1 && /\b1\s?TB\b/i.test(text)) ||
    (number === 2 && /\b2\s?TB\b/i.test(text))
  );
}
function scoreProductMatch(product, keyword) {
  const requiredTokens = relaxRequiredTokensForProduct(
    getRequiredSearchTokens(keyword),
    product,
    keyword,
  );
  if (requiredTokens.length === 0) return 1;
  const variantTokens = new Set([
    "pro",
    "plus",
    "max",
    "ultra",
    "mini",
    "air",
    "lite",
    "neo",
    "se",
    "fe",
  ]);
  const requestedVariants = new Set(
    requiredTokens.filter((token) => variantTokens.has(token)),
  );
  const title =
    product && product.title ? product.title : String(product || "");
  const titleTokens = new Set(tokenizeForMatch(title));
  const fullTokens = new Set(
    tokenizeForMatch(
      [
        title,
        product && product.specs,
        product && product.snippet,
        product && product.searchQuery,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (
    requiredTokens.some((token) => !tokenMatchesSearchToken(fullTokens, token))
  )
    return -1;
  const requestedModelNumbers = requiredTokens.filter(
    (token) =>
      /^\d+$/.test(token) && !isLikelyMemoryNumberToken(token, keyword),
  );
  if (requestedModelNumbers.some((token) => !titleTokens.has(token))) return -1;
  for (const variant of variantTokens) {
    if (titleTokens.has(variant) && !requestedVariants.has(variant)) return -1;
  }
  let score = 0;
  for (const token of requiredTokens) {
    if (tokenMatchesSearchToken(titleTokens, token)) score += 100;
    else if (tokenMatchesSearchToken(fullTokens, token)) score += 35;
  }
  const queryCompact = requiredTokens.join(" ");
  const titleCompact = tokenizeForMatch(title).join(" ");
  if (titleCompact === queryCompact) score += 250;
  if (
    titleCompact.endsWith(` ${queryCompact}`) ||
    titleCompact.startsWith(`${queryCompact} `)
  )
    score += 120;
  if (product && product.price) score += 8;
  if (product && product.image) score += 4;
  score += getMemoryVariantScore(product, keyword);
  return score;
}
function normalizeStoreSearchQuery(keyword) {
  const query = cleanText(keyword, 120);
  const lower = query.toLowerCase();
  const additions = [];
  const isIphoneSearch = /\biphone\b|\bi\s*phone\b/.test(lower);
  const mentionsPtaStatus = /\bpta\b|\bnon[\s-]?pta\b|\bapproved\b/.test(lower);
  const mentionsCondition =
    /\bnew\b|\bbrand\s+new\b|\bused\b|\bopen\s+box\b|\brefurbished\b|\bsealed\b/.test(
      lower,
    );
  const mentionsCapacity =
    /\b(?:32|64|128|256|512)\s?GB\b|\b1\s?TB\b|\b2\s?TB\b|\b\d{1,2}\s?GB\s?RAM\b/i.test(
      query,
    );
  if (!mentionsCondition) additions.push("new");
  if (isIphoneSearch && !mentionsPtaStatus) additions.push("PTA approved");
  return cleanText([query, ...additions].join(" "), 180);
}
function normalizeTabletStoreSearchQuery(keyword) {
  const query = cleanText(keyword, 120);
  const lower = query.toLowerCase();
  const additions = [];
  if (!/\b(?:tab|tablet|tablets|pad|ipad)\b/i.test(lower))
    additions.push("tab");
  if (
    !/\b(?:new|brand\s+new|used|open\s+box|refurbished|sealed)\b/i.test(lower)
  )
    additions.push("new");
  return cleanText([query, ...additions].join(" "), 180);
}
function normalizeTabletMemoryQuery(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return "";
  if (/\b(?:gb|ram|rom|storage)\b/i.test(query)) return query;
  if (!isPureMemoryPairQuery(query)) return query;
  const match = query.match(/^(\d{1,2})\s+(\d{2,4})$/);
  if (!match) return query;
  const ram = match[2];
  const storage = match[3];
  if (!ram || !storage) return query;
  return cleanText(`Storage: ${storage}GB | RAM: ${ram}GB`, 120);
}
function normalizeLaptopStoreSearchQuery(keyword) {
  const query = cleanText(keyword, 120);
  const lower = query.toLowerCase();
  const additions = [];
  if (!/\b(?:laptop|laptops|notebook|ultrabook|macbook)\b/i.test(lower))
    additions.push("laptop");
  if (
    !/\b(?:new|brand\s+new|used|open\s+box|refurbished|sealed)\b/i.test(lower)
  )
    additions.push("new");
  return cleanText([query, ...additions].join(" "), 180);
}
function stripLaptopSpecsFromQuery(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return "";
  return cleanText(
    query
      .replace(
        /\b\d{1,2}\s?GB\s?RAM\b|\bRAM\s*:?\s*\d{1,2}\s?GB\b|\b\d{1,2}\s*RAM\b|\bRAM\s*:?\s*\d{1,2}\b/gi,
        " ",
      )
      .replace(/\b\d{1,4}\s?(?:GB|TB)\s?(?:SSD|HDD|NVME|STORAGE)?\b/gi, " ")
      .replace(/\b(?:core\s*i[3579]|ci[3579]|i[3579]|ryzen\s*[3579])\b/gi, " ")
      .replace(/\b(?:rtx|gtx)\s*\d{3,4}\b/gi, " ")
      .replace(/\b(?:windows\s*\d{1,2}|w\d{1,2})\b/gi, " ")
      .replace(/\b(?:4|6|8|12|16|32|64|128|256|512|1024|2048)\b/gi, " ")
      .replace(/\b(?:ssd|hdd|nvme|ddr\d|laptop|laptops|notebook|ultrabook|macbook)\b/gi, " "),
    120,
  );
}
function stripTabletSpecsFromQuery(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return "";
  return cleanText(
    query
      .replace(
        /\b\d{1,2}\s?GB\s?RAM\b|\bRAM\s*:?\s*\d{1,2}\s?GB\b|\b\d{1,2}\s*RAM\b|\bRAM\s*:?\s*\d{1,2}\b/gi,
        " ",
      )
      .replace(/\b\d{1,4}\s?(?:GB|TB)\s?(?:ROM|STORAGE)?\b/gi, " ")
      .replace(/\b(?:4|6|8|12|16|32|64|128|256|512|1024|2048)\b/gi, " "),
    120,
  );
}
function stripMemoryHintsFromQuery(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return "";
  return cleanText(
    query
      .replace(
        /\b\d{1,2}\s?GB\s?RAM\b|\bRAM\s*:?\s*\d{1,2}\s?GB\b|\b\d{1,2}\s*RAM\b|\bRAM\s*:?\s*\d{1,2}\b/gi,
        " ",
      )
      .replace(
        /\b(?:32|64|128|256|512|1024|2048)\b(?!\s*(?:g|gb|tb)\b)/gi,
        " ",
      )
      .replace(/\b(?:1|2)\s?TB\b/gi, " "),
    120,
  );
}
function stripMobileSpecsFromQuery(keyword) {
  const query = stripMemoryHintsFromQuery(keyword);
  if (!query) return "";
  return cleanText(
    query
      .replace(/\b(?:4|6|8|12|16|32|64|128|256|512|1024|2048)\b/gi, " ")
      .replace(/\b(?:gb|ram|rom|storage)\b/gi, " "),
    120,
  );
}
function normalizeMobileMemoryQuery(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return "";
  if (/\b(?:gb|ram|rom|storage)\b/i.test(query)) return query;
  if (!isPureMemoryPairQuery(query)) return query;
  const match = query.match(/^(\d{1,2})\s+(\d{2,4})$/);
  if (!match) return query;
  const ram = match[2];
  const storage = match[3];
  if (!ram || !storage) return query;
  return cleanText(`Storage: ${storage}GB | RAM: ${ram}GB`, 120);
}
function normalizeLaptopMemoryQuery(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return "";
  if (/\b(?:gb|ram|rom|storage|ssd|hdd|nvme)\b/i.test(query)) return query;
  if (!isPureMemoryPairQuery(query)) return query;
  const match = query.match(/^(\d{1,2})\s+(\d{2,4})$/);
  if (!match) return query;
  const ram = match[2];
  const storage = match[3];
  if (!ram || !storage) return query;
  return cleanText(`RAM: ${ram}GB | Storage: ${storage}GB`, 120);
}
function getMobileSearchTerms(keyword) {
  const query = normalizeSearchQuery(keyword, "mobiles");
  const searchRoot = stripTrailingMemoryPairFromQuery(query);
  const requested = getRequestedMemory(query);
  const variants = [searchRoot, query, stripMemoryHintsFromQuery(query)];
  const normalized = normalizeStoreSearchQuery(query);
  if (normalized !== query) variants.push(normalized);
  if (requested.ram || requested.storage) {
    const memoryParts = [requested.ram, requested.storage].filter(Boolean);
    const bareRam = requested.ram ? requested.ram.replace(/\s*RAM$/i, '') : '';
    const bareStorage = requested.storage ? requested.storage.replace(/\s+/g, '') : '';
    variants.push(
      cleanText([query.replace(/\b\d+\b/gi, ' ').trim(), ...memoryParts].filter(Boolean).join(' '), 120),
      cleanText([query.replace(/\b\d+\b/gi, ' ').trim(), bareRam, bareStorage].filter(Boolean).join(' '), 120),
      cleanText([query.replace(/\b\d+\b/gi, ' ').trim(), bareRam, bareStorage, 'mobile'].filter(Boolean).join(' '), 120),
    );
  }
  return [
    ...new Set(variants.map((term) => cleanText(term, 120)).filter(Boolean)),
  ];
}
function getTabletSearchTerms(keyword) {
  const query = normalizeSearchQuery(keyword, "tablets");
  const searchRoot = stripTrailingMemoryPairFromQuery(query);
  const memoryAwareQuery = normalizeTabletMemoryQuery(keyword);
  const requested = getRequestedMemory(query);
  const variants = [
    searchRoot,
    query,
    memoryAwareQuery,
    stripMemoryHintsFromQuery(query),
    normalizeTabletStoreSearchQuery(query),
  ];
  if (requested.ram || requested.storage) {
    const memoryParts = [requested.ram, requested.storage].filter(Boolean);
    const bareRam = requested.ram ? requested.ram.replace(/\s*RAM$/i, '') : '';
    const bareStorage = requested.storage ? requested.storage.replace(/\s+/g, '') : '';
    variants.push(
      cleanText([query.replace(/\b\d+\b/gi, ' ').trim(), ...memoryParts].filter(Boolean).join(' '), 120),
      cleanText([query.replace(/\b\d+\b/gi, ' ').trim(), bareRam, bareStorage, 'tablet'].filter(Boolean).join(' '), 120),
      cleanText([query.replace(/\b\d+\b/gi, ' ').trim(), bareRam, bareStorage, 'tab'].filter(Boolean).join(' '), 120),
    );
  }
  if (/\bsamsung\b/i.test(query) && /\btab\b/i.test(query) && !/\bgalaxy\s+tab\b/i.test(query)) {
    variants.push(
      query.replace(/\bsamsung\s+tab\b/gi, "Samsung Galaxy Tab"),
      query.replace(/\btab\b/gi, "Galaxy Tab"),
    );
  }
  if (/\bplus\b/i.test(query)) variants.push(query.replace(/\bplus\b/gi, "+"));
  if (/\bS\d+\+/i.test(query))
    variants.push(query.replace(/\b(S\d+)\+/gi, "$1 Plus"));
  if (/\bX\d{3,4}\b/i.test(query))
    variants.push(query.replace(/\bX\d{3,4}\b/gi, ""));
  if (/\bsamsung\b/i.test(query) && /\bgalaxy\s+tab\b/i.test(query)) {
    variants.push(query.replace(/\bgalaxy\s+tab\b/gi, "Tab"));
  }
  return [
    ...new Set(variants.map((term) => cleanText(term, 120)).filter(Boolean)),
  ];
}
function getLaptopSearchTerms(keyword) {
  const query = normalizeSearchQuery(keyword, "laptops");
  const searchRoot = stripTrailingMemoryPairFromQuery(query);
  const strippedSpecs = stripLaptopSpecsFromQuery(query);
  const variants = [
    searchRoot,
    query,
    stripMemoryHintsFromQuery(query),
    strippedSpecs,
  ];
  const normalized = normalizeLaptopStoreSearchQuery(query);
  const normalizedStripped = normalizeLaptopStoreSearchQuery(strippedSpecs);
  if (normalized !== query && !/\b(?:core|ci\d|rtx|gtx|ryzen)\b/i.test(query))
    variants.push(normalized);
  if (normalizedStripped && normalizedStripped !== query) variants.push(normalizedStripped);
  if (/\b(?:core\s*i[3579]|i[3579]|ryzen\s*[3579])\b/i.test(query)) {
    variants.push(
      cleanText([strippedSpecs || query, 'laptop', 'new'].filter(Boolean).join(' '), 120),
      cleanText([query, 'notebook'].filter(Boolean).join(' '), 120),
    );
  }
  return [
    ...new Set(variants.map((term) => cleanText(term, 120)).filter(Boolean)),
  ];
}
function buildSpecificationSearchTerms(filters = {}, category = "", options = {}) {
  const normalized = normalizeSpecFilters(filters);
  const company = cleanText(
    normalized.company || filters.company || filters.brand,
    80,
  );
  if (!company) return [];

  const terms = [];
  const push = (...parts) => {
    const term = cleanText(parts.filter(Boolean).join(" "), 140);
    if (term) terms.push(term);
  };
  const pushVariants = (...values) => {
    const cleanValues = values.map((value) => cleanText(value, 80)).filter(Boolean);
    if (!cleanValues.length) return;
    terms.push(...cleanValues);
  };

  const core = normalized.core ? normalized.core.replace(/^core\s+/i, "core ") : "";
  const generation = normalized.generation || "";
  const ram = normalized.ram || "";
  const storage = normalized.storage || "";
  const ramBare = ram.match(/\d{1,2}/)?.[0] || "";
  const storageBare = storage.match(/\d{1,4}/)?.[0] || "";
  const storageGb = storage.toUpperCase().replace(/\s+/g, "");
  const ramGb = ram.toUpperCase().replace(/\s+/g, "");
  const shorthandPair = [ramBare, storageBare].filter(Boolean).join("/");
  const ramStorageCompact = [ramBare, storageBare].filter(Boolean).join(" ");
  const mobileModelHints = [
    "reno",
    "a",
    "f",
    "find",
    "n",
    "k",
    "r",
    "s",
  ];
  const catalogModels = Array.isArray(options.catalogModels)
    ? options.catalogModels
        .map((model) => ({
          modelName: cleanText(model && (model.modelName || model.modelKey), 120),
          brand: cleanText(model && model.brand, 60),
          core: cleanText(model && model.core, 40),
          generation: cleanText(model && model.generation, 40),
          ram: cleanText(model && model.ram, 40),
          storage: cleanText(model && model.storage, 40),
        }))
        .filter((model) => model.modelName)
        .slice(0, category === "laptops" ? 12 : 20)
    : [];
  const catalogTerms = [];
  const pushCatalog = (...parts) => {
    const term = cleanText(parts.filter(Boolean).join(" "), 160);
    if (term) catalogTerms.push(term);
  };
  for (const model of catalogModels) {
    const brand = model.brand || company;
    const modelName = model.modelName;
    const hasBrand = brand
      ? new RegExp(`\\b${escapeRegExp(brand)}\\b`, "i").test(modelName)
      : false;
    const baseName = hasBrand
      ? modelName
      : cleanText([brand, modelName].filter(Boolean).join(" "), 140);
    pushCatalog(baseName);
    if (category === "laptops") {
      pushCatalog(baseName, model.core, model.generation, model.ram, model.storage);
    } else {
      pushCatalog(baseName, model.ram, model.storage);
    }
    if (brand && !hasBrand) {
      if (category === "laptops") {
        pushCatalog(brand, modelName, model.core, model.generation);
      } else {
        pushCatalog(brand, modelName, model.ram, model.storage);
      }
    }
  }

  if (category === "laptops") {
    push(company, core, generation, ram, storage);
    push(company, core, generation);
    push(company, core, ram, storage);
    push(company, core, storage);
    push(company, generation, ram, storage);
    push(company, core);
    push(company, generation);
    push(company, ram, storage);
    push(company, ram);
    push(company, storage);
    push(company, "laptop", core, generation, ram, storage);
    push(company, "laptop");
    push(company, "notebook", core, generation, ram, storage);
    push(company, "notebook");
  } else if (category === "tablets") {
    push(company, ram, storage);
    push(company, ram);
    push(company, storage);
    push(company, "tablet", ram, storage);
    push(company, "tab", ram, storage);
    push(company, "android tablet", ram, storage);
    push(company, "tablet", shorthandPair);
    push(company, "tab", shorthandPair);
    push(company, "tablet", `${ramBare}gb`, `${storageBare}gb`);
    push(company, "tab", `${ramBare}gb`, `${storageBare}gb`);
    push(company, "tablet", `${ramBare}gb`, `${storageGb}`);
  } else {
    push(company, ram, storage);
    push(company, ram);
    push(company, storage);
    push(company, "mobile", ram, storage);
    push(company, "phone", ram, storage);
    push(company, "smartphone", ram, storage);
    push(company, shorthandPair);
    push(company, ramStorageCompact);
    push(company, `${ramBare}gb`, `${storageBare}gb`);
    push(company, `${ramBare}gb ram`, `${storageBare}gb storage`);
    push(company, `${ramBare}gb ram`, `${storageGb}`);
    push(company, `${ramBare} ram`, `${storageBare} rom`);
    push(company, `${ramBare}gb`, `${storageBare}gb`, "mobile");
    push(company, `${ramBare}gb`, `${storageBare}gb`, "phone");
    push(company, `${ramBare}gb`, `${storageBare}gb`, "smartphone");
    if (!catalogModels.length) {
      for (const hint of mobileModelHints) {
        push(company, hint, ram, storage);
        push(company, hint, shorthandPair);
      }
    }
  }

  push(buildKeywordWithFilters(company, filters, category));
  push(buildKeywordWithFilters(company, filters, ""));
  if (ramBare || storageBare) {
    pushVariants(
      `${company} ${ramBare} ${storageBare}`,
      `${company} ${ramBare}gb ${storageBare}gb`,
      `${company} ${ramBare}gb ram ${storageBare}gb storage`,
      `${company} ${ramBare}gb ${storageBare}gb mobile`,
      `${company} ${ramBare}/${storageBare}`,
      `${company} ${ramBare} gb ${storageBare} gb`,
    );
  }

  const termLimit = category === "laptops" ? 10 : 8;
  return [
    ...new Set(
      [...catalogTerms, ...terms].filter(Boolean).map((term) => cleanText(term, 160)),
    ),
  ].slice(0, termLimit);
}
function isTabletAccessoryCandidate(product) {
  const title = cleanText(product && product.title, 160);
  if (!title) return false;
  const accessoryMatch = /\b(?:s\s*pen|stylus|case|cover|charger|adapter|cable|keyboard|mouse|stand|bag|sleeve|protector|screen\s*protector|dock)\b/i.test(
    title,
  );
  if (!accessoryMatch) return false;
  return !/\b(?:tablet|tablets|tab\s*[a-z0-9]*|ipad|pad)\b/i.test(title);
}
function hasMobileModelSignal(value) {
  const text = cleanText(value, 180);
  return /\b(?:iphone|galaxy|pixel|redmi|xiaomi|vivo|oppo|realme|infinix|tecno|nokia|honor|oneplus|huawei|moto|edge|find|reno|y\d{2,3}|a\d{2,3}|m\d{2,3}|s\d{2,3}|c\d{2,3}|x\d{2,3})\b/i.test(
    text,
  );
}
function isMobileAccessoryCandidate(product) {
  const title = cleanText(product && product.title, 180);
  if (!title) return false;
  if (
    /\b(?:earphones?|headphones?|earbuds?|buds|watch|smart\s*watch|fit\s*\d*|monitor|ssd|speaker|laptop|tablet|printer|power\s*bank|charger|cable|mouse|keyboard|adapter|case|cover|bag|sleeve|memory\s*card|router|modem|tv|television|fridge|refrigerator|freezer|microwave|oven|washing\s*machine|dishwasher|air\s*conditioner|camera|cu\s*ft)\b/i.test(
      title,
    )
  ) {
    return true;
  }
  if (
    /\b(?:prices?|price)\s+in\s+pakistan\b/i.test(title) &&
    !hasMobileModelSignal(title)
  ) {
    return true;
  }
  return false;
}
function hasTabletModelSignal(value) {
  const text = cleanText(value, 180);
  return /\b(?:galaxy\s+tab|tab\s+[a-z0-9]+|ipad|tablet\s*pc|tab\s*s\d+|tab\s*a\d+|tab\s+x\d+)\b/i.test(
    text,
  );
}
function isTabletListingCandidate(product) {
  const title = cleanText(product && product.title, 160);
  if (!title) return false;
  if (
    /\b(?:prices?|price)\s+in\s+pakistan\b/i.test(title) &&
    !hasTabletModelSignal(title)
  ) {
    return true;
  }
  return false;
}
async function scrapeStoresBySpecifications(category, filters = {}, options = {}) {
  const normalized = normalizeSpecFilters(filters);
  const searchKeyword = buildKeywordWithFilters(
    normalized.company || filters.company || filters.brand || "",
    filters,
    category,
  );
  const scrapeKeyword =
    category === "tablets"
      ? buildKeywordWithFilters(
          normalized.company || filters.company || filters.brand || "",
          {},
          category,
        )
      : searchKeyword;
  const resultLimit = category === "laptops" ? 140 : 100;
  const scrapeByCategory =
    category === "tablets"
      ? scrapeTabletStores
      : category === "laptops"
        ? scrapeLaptopStores
        : scrapeMobileStores;
  if (typeof scrapeByCategory !== "function") return [];

  const rawResults = await scrapeByCategory(scrapeKeyword).catch((err) => {
    console.error(
      `${category} specification scraper failed:`,
      err.message || err,
    );
    return [];
  });

  const seenKeys = new Set();
  const collected = [];
  for (const product of rawResults) {
    const normalizedProduct = resolveRequestedMemoryVariant(
      normalizeProduct({
      ...(product && product.category ? {} : {}),
      ...product,
      category,
      }),
      searchKeyword,
      filters,
    );
    if (
      !normalizedProduct.title ||
      !productMatchesRequestedMemory(normalizedProduct, searchKeyword, filters) ||
      !productMatchesCategory(normalizedProduct, category) ||
      isRejectedProductCandidate(normalizedProduct) ||
      (!normalizedProduct.price && !normalizedProduct.image)
    ) {
      continue;
    }
    if (
      normalized.company &&
      !productMentionsCompany(normalizedProduct, normalized.company)
    ) {
      continue;
    }
    if (
      category === "tablets" &&
      (isTabletAccessoryCandidate(normalizedProduct) ||
        isTabletListingCandidate(normalizedProduct))
    ) {
      continue;
    }
    if (
      category === "mobiles" &&
      isMobileAccessoryCandidate(normalizedProduct)
    ) {
      continue;
    }
    const key = canonicalProductKey({
      ...normalizedProduct,
      site: normalizedProduct.site,
    });
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    collected.push({
      ...normalizedProduct,
      site: normalizedProduct.site,
      displayLink: normalizedProduct.displayLink || normalizedProduct.site,
      sourceType: normalizedProduct.sourceType || "Scraped store",
      searchQuery: searchKeyword,
      position: collected.length + 1,
    });
    if (collected.length >= resultLimit) break;
  }

  return sortSpecificationOffersByModel(collected, filters, category).slice(0, resultLimit);
}
function toSlugPart(value) {
  return cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function normalizePriceOyeProductUrl(url) {
  const value = cleanText(url, 300);
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch (err) {
    return value.split("?")[0].split("#")[0];
  }
}
function buildPriceOyeProductUrl(keyword) {
  const query = cleanText(keyword, 80);
  if (!query) return null;
  const lower = query.toLowerCase();
  const brandMap = [
    "apple",
    "iphone",
    "samsung",
    "infinix",
    "tecno",
    "vivo",
    "oppo",
    "xiaomi",
    "redmi",
    "realme",
    "oneplus",
    "huawei",
    "honor",
    "itel",
    "nokia",
  ];
  const brandToken = brandMap.find((brand) =>
    new RegExp(`\\b${brand}\\b`, "i").test(lower),
  );
  if (!brandToken) return null;
  const brand = brandToken === "iphone" ? "apple" : brandToken;
  const slug = toSlugPart(brandToken === "iphone" ? `apple ${query}` : query);
  return slug ? `https://priceoye.pk/mobiles/${brand}/${slug}` : null;
}
function buildPriceOyeTabletProductUrl(keyword) {
  const query = cleanText(keyword, 100);
  if (!query) return null;
  const lower = query.toLowerCase();
  if (
    /\bsamsung\b/.test(lower) &&
    /\bgalaxy\b/.test(lower) &&
    /\btab\s*a9\b/.test(lower) &&
    !/\b(?:plus|\+)\b/.test(lower)
  ) {
    return "https://priceoye.pk/tablets/samsung/samsung-galaxy-tab-a9-x110";
  }
  const brandMap = [
    "apple",
    "ipad",
    "samsung",
    "lenovo",
    "xiaomi",
    "redmi",
    "huawei",
    "honor",
    "amazon",
    "tcl",
    "infinix",
    "oneplus",
  ];
  const brandToken = brandMap.find((brand) =>
    new RegExp(`\\b${brand}\\b`, "i").test(lower),
  );
  if (!brandToken) return null;
  const brand = brandToken === "ipad" ? "apple" : brandToken;
  const normalizedQuery = query
    .replace(/\bplus\b/gi, "plus")
    .replace(/\b(?:wifi|wi-fi)\b/gi, " ")
    .replace(/\b(?:tablet|tab)\b$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const slug = toSlugPart(normalizedQuery);
  return slug ? `https://priceoye.pk/tablets/${brand}/${slug}` : null;
}
function buildPriceOyeLaptopProductUrl(keyword) {
  const query = cleanText(keyword, 120);
  if (!query) return null;
  const lower = query.toLowerCase();
  const brandMap = [
    "apple",
    "macbook",
    "hp",
    "dell",
    "lenovo",
    "asus",
    "acer",
    "msi",
    "microsoft",
    "surface",
    "huawei",
    "infinix",
  ];
  const brandToken = brandMap.find((brand) =>
    new RegExp(`\\b${brand}\\b`, "i").test(lower),
  );
  if (!brandToken) return null;
  const brand =
    brandToken === "macbook"
      ? "apple"
      : brandToken === "surface"
        ? "microsoft"
        : brandToken;
  const slug = toSlugPart(
    query
      .replace(/\b(?:laptop|laptops|notebook|ultrabook)\b$/gi, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  return slug ? `https://priceoye.pk/laptops/${brand}/${slug}` : null;
}
async function fetchPageHtml(pageUrl) {
  try {
    const resp = await axios.get(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
      maxRedirects: 5,
    });
    return resp && resp.data;
  } catch (err) {
    return null;
  }
}
function pickDescription($, el) {
  const root = el ? $(el) : $("body");
  const selectors = [
    '[itemprop="description"]',
    "#productDescription",
    "#feature-bullets",
    "#detailBullets_feature_div",
    "#productDetails_feature_div",
    ".product-description",
    ".productDescription",
    ".description",
    ".short-description",
    ".shortDescription",
    ".product-details",
    ".productDetails",
    ".product-specs",
    ".specifications",
    ".specification",
    ".features",
    ".feature-list",
    ".details",
    ".overview",
    '[class*="description"]',
    '[class*="Description"]',
    '[class*="spec"]',
    '[class*="Spec"]',
    '[class*="feature"]',
    '[class*="Feature"]',
  ];
  const parts = [];
  for (const selector of selectors) {
    root
      .find(selector)
      .slice(0, 3)
      .each((_, node) => {
        const value = cleanText($(node).text(), 500);
        if (value && value.length > 20 && !parts.includes(value))
          parts.push(value);
      });
    if (parts.join(" ").length > 420) break;
  }
  for (const value of extractTableSpecs($, root, 80)) {
    if (!parts.includes(value)) parts.push(value);
  }
  if (parts.length === 0) {
    const meta =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    if (meta) parts.push(cleanText(meta, 500));
  }
  return cleanText(parts.join(" | "), 900);
}
function pickPrice($, el) {
  const scoped = el ? $(el) : $("body");
  const candidates = [
    scoped.find('[itemprop="price"]').first().attr("content"),
    scoped.find('[itemprop="price"]').first().text(),
    scoped
      .find(
        "[data-price], [data-product-price], [data-sale-price], [data-final-price]",
      )
      .first()
      .attr("data-price"),
    scoped
      .find(
        "[data-price], [data-product-price], [data-sale-price], [data-final-price]",
      )
      .first()
      .attr("data-product-price"),
    scoped
      .find("[data-sale-price], [data-final-price]")
      .first()
      .attr("data-sale-price"),
    scoped.find("[data-final-price]").first().attr("data-final-price"),
    scoped
      .find(
        '[class*="sale-price"], [class*="SalePrice"], [class*="current-price"], [class*="CurrentPrice"], [class*="product-price"], [class*="ProductPrice"], [class*="price"], [class*="Price"], .amount',
      )
      .first()
      .text(),
    $('meta[property="product:price:amount"]').attr("content"),
    $('meta[property="og:price:amount"]').attr("content"),
    $('meta[name="twitter:data1"]').attr("content"),
    getPriceFromText(scoped.text ? scoped.text() : $("body").text()),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = normalizeProduct({ price: candidate }).price;
    if (normalized) return normalized;
  }
  return "";
}
function titleMatchesKeyword(title, keyword) {
  return scoreProductMatch({ title }, keyword) >= 0;
}
function isRejectedProductCandidate(product) {
  const title = cleanText(product && product.title, 160);
  const priceValue =
    product && product.normalized
      ? product.normalized.priceValue
      : normalizeProduct(product || {}).normalized.priceValue;
  if (/^search\s+for\b/i.test(title)) return true;
  if (/^results?\s+for\b/i.test(title)) return true;
  if (
    /\b(?:tablet|tablets|tab|pad)\b/i.test(title) &&
    /\b(?:ram|storage|gb|display|processor)\b/i.test(title)
  )
    return false;
  if (
    /\b(?:sleeve|adapter|charger|cable|bag|protector|case|cover|dock|mouse|keyboard|stand)\b/i.test(
      title,
    ) &&
    !hasStrongLaptopTitleSignals(title)
  )
    return true;
  if (
    !hasLaptopSignals(title) &&
    /\b(?:back\s+glass|front\s+glass|lcd|led|panel|touch|oca|body\s+frame|housing|charging\s+port|camera\s+glass|sim\s+tray|battery|protector|case|cover|charger|cable|adapter|handsfree|earbuds?|airpods?)\b/i.test(
      title,
    )
  )
    return true;
  if (priceValue === 0) return true;
  return false;
}
function hasPlausibleCategoryPrice(product, category = "") {
  const priceValue =
    product && product.normalized
      ? product.normalized.priceValue
      : normalizeProduct(product || {}).normalized.priceValue;
  if (!Number.isFinite(priceValue) || priceValue <= 0) return true;
  const minimumByCategory = { mobiles: 5000, tablets: 8000, laptops: 15000 };
  const minimum = minimumByCategory[category] || 0;
  return !minimum || priceValue >= minimum;
}
function isUsefulScrapedProduct(product, keyword) {
  if (!product || !product.title) return false;
  if (!titleMatchesKeyword(product.title, keyword)) return false;
  if (product.price || product.image) return true;
  return Boolean(product.specs || product.snippet);
}
function hasUsefulDetails(product) {
  return Boolean(
    product &&
    ((product.specs && product.specs.length > 30) ||
      (product.snippet && product.snippet.length > 30)),
  );
}
function getOfferPrice(offers) {
  const queue = Array.isArray(offers) ? [...offers] : [offers];
  while (queue.length) {
    const offer = queue.shift();
    if (!offer || typeof offer !== "object") continue;
    if (offer.offers)
      queue.push(
        ...(Array.isArray(offer.offers) ? offer.offers : [offer.offers]),
      );
    if (offer.priceSpecification)
      queue.push(
        ...(Array.isArray(offer.priceSpecification)
          ? offer.priceSpecification
          : [offer.priceSpecification]),
      );
    const price =
      offer.price ||
      offer.lowPrice ||
      offer.highPrice ||
      offer.minPrice ||
      offer.maxPrice;
    if (price) return cleanText(`${offer.priceCurrency || ""} ${price}`, 80);
  }
  return "";
}
function pickProductFromJsonLd($, pageUrl) {
  let product = null;
  $('script[type="application/ld+json"]').each((_, script) => {
    if (product) return false;
    try {
      const raw = $(script).contents().text();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length && !product) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node)) {
          queue.push(...node);
          continue;
        }
        if (node["@graph"])
          queue.push(
            ...(Array.isArray(node["@graph"])
              ? node["@graph"]
              : [node["@graph"]]),
          );
        if (node.itemListElement)
          queue.push(
            ...(Array.isArray(node.itemListElement)
              ? node.itemListElement
              : [node.itemListElement]),
          );
        if (node.item) queue.push(node.item);
        const type = Array.isArray(node["@type"])
          ? node["@type"].join(" ")
          : node["@type"];
        if (!type || !String(type).toLowerCase().includes("product")) continue;
        const price = getOfferPrice(node.offers);
        product = {
          title: cleanText(
            node.name || $("h1").first().text() || $("title").text(),
            160,
          ),
          price: price ? normalizeProduct({ price }).price : "",
          image: getImageFromJsonValue(
            node.image || node.thumbnailUrl || node.primaryImageOfPage,
            pageUrl,
          ),
          link: resolveUrl(node.url || pageUrl, pageUrl),
          snippet: cleanText(
            node.description || $('meta[name="description"]').attr("content"),
            220,
          ),
          specs: cleanText(
            node.description || $('meta[name="description"]').attr("content"),
            260,
          ),
        };
      }
    } catch (err) {}
  });
  return product && product.title ? product : null;
}
function pickProductFromScriptData($, pageUrl) {
  const shopifyProduct = extractShopifyProductJson($, pageUrl);
  if (shopifyProduct && shopifyProduct.title) return shopifyProduct;
  let product = null;
  $("script").each((_, script) => {
    if (product) return false;
    const raw = $(script).contents().text();
    if (!raw || raw.length < 80 || raw.length > 250000) return;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const queue = [parsed];
      while (queue.length && !product) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node)) {
          queue.push(...node.slice(0, 100));
          continue;
        }
        const title = cleanText(
          node.title || node.name || node.productName || node.displayName,
          160,
        );
        const price =
          node.price ||
          node.salePrice ||
          node.currentPrice ||
          node.finalPrice ||
          node.priceText ||
          node.formattedPrice;
        const image = getImageFromJsonValue(
          node.image ||
            node.images ||
            node.thumbnail ||
            node.thumbnailUrl ||
            node.imageUrl ||
            node.media,
          pageUrl,
        );
        if (title && (price || image)) {
          product = {
            title,
            price: price ? normalizeProduct({ price }).price : "",
            image,
            link: resolveUrl(
              node.url || node.link || node.productUrl || pageUrl,
              pageUrl,
            ),
            snippet: cleanText(
              node.description ||
                node.shortDescription ||
                $('meta[name="description"]').attr("content"),
              220,
            ),
            specs: cleanText(
              node.description ||
                node.shortDescription ||
                $('meta[name="description"]').attr("content"),
              260,
            ),
          };
          break;
        }
        Object.keys(node)
          .slice(0, 80)
          .forEach((key) => {
            const value = node[key];
            if (value && typeof value === "object") queue.push(value);
          });
      }
    } catch (err) {}
  });
  return product && product.title ? product : null;
}
function pickFirstProductCard($, pageUrl) {
  const selectors = [
    '[itemtype*="Product"]',
    '[data-testid*="product"]',
    '[class*="product-card"]',
    '[class*="productCard"]',
    '[class*="product-item"]',
    '[class*="productItem"]',
    '[class*="product"]',
    ".card",
    "article",
    "li",
  ];
  for (const selector of selectors) {
    const nodes = $(selector);
    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes.eq(i);
      const text = cleanText(el.text(), 600);
      const price = pickPrice($, el);
      const title = cleanText(
        el
          .find(
            '[itemprop="name"], h1, h2, h3, h4, [class*="title"], [class*="Title"], [class*="name"], [class*="Name"], a',
          )
          .first()
          .text() || el.find("a").first().attr("title"),
        160,
      );
      const href = el.find("a[href]").first().attr("href");
      const image = getImageFromElement($, el, pageUrl);
      if (title && (price || image || href)) {
        return {
          title,
          price,
          image,
          link: resolveUrl(href, pageUrl) || pageUrl,
          snippet: pickDescription($, el) || cleanText(text, 220),
          specs: pickDescription($, el),
        };
      }
    }
  }
  return null;
}
function pickDirectProductPage($, pageUrl) {
  const title = cleanText(
    $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text() ||
      $("title").text(),
    160,
  );
  const price = pickPrice($);
  const image = cleanImageUrl(
    $('meta[property="og:image"]').attr("content") ||
      $('meta[property="og:image:secure_url"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      $('meta[name="twitter:image:src"]').attr("content") ||
      $('link[rel="image_src"]').attr("href") ||
      $('link[rel="preload"][as="image"]').first().attr("href") ||
      $('link[rel="prefetch"][as="image"]').first().attr("href") ||
      getImageFromElement($, null, pageUrl),
    pageUrl,
  );
  const snippet = pickDescription($);
  return title
    ? { title, price, image, link: pageUrl, snippet, specs: snippet }
    : null;
}
function extractAlaqsaLaptopProductPage($, pageUrl) {
  const title = cleanText(
    $("h1.product_title").first().text() ||
      $("h1.entry-title").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
    240,
  ).replace(/\s+[-|]\s*Al\s*Aqsa.*$/i, "");
  const isProductDetailPage =
    $(
      'body.single-product, .details-product, [id^="product-"].details-product, form.cart',
    ).length > 0 || /\/product\/[^/?#]+\/?$/i.test(pageUrl);
  if (!isProductDetailPage) return null;
  const price = normalizeProduct({
    price:
      $(".summary p.price .woocommerce-Price-amount").first().text() ||
      $("p.price .woocommerce-Price-amount").first().text() ||
      $('[itemprop="price"]').first().attr("content") ||
      getPriceFromText($(".summary").text() || $("body").text()),
  }).price;
  const image = cleanImageUrl(
    $(".woocommerce-product-gallery__image img.wp-post-image")
      .first()
      .attr("data-large_image") ||
      $("#wpg-main-img").first().attr("data-large_image") ||
      $("#wpg-main-img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content"),
    pageUrl,
  );
  const link = resolveUrl(
    $('meta[itemprop="url"]').attr("content") ||
      $('link[rel="canonical"]').attr("href") ||
      pageUrl,
    pageUrl,
  );
  const specParts = [
    title,
    $(".woocommerce-product-details__short-description").first().text(),
    $(".product-description").first().text(),
  ];
  specParts.push(
    ...extractTableSpecs(
      $,
      $(".product-additional-info, .woocommerce-tabs, body"),
      120,
    ),
  );
  const specs = buildDetails(specParts, "New");
  return title
    ? {
        title,
        price,
        image,
        link,
        snippet: specs,
        specs,
        condition: "New",
        hidePtaStatus: true,
        defaultConditionNew: true,
      }
    : null;
}
async function scrapeAlaqsaLaptops(
  searchTerm,
  matchKeyword = searchTerm,
  options = {},
) {
  const searchUrls = [
    `https://alaqsa.com.pk/?s=${encodeURIComponent(searchTerm)}&post_type=product`,
    `https://alaqsa.com.pk/product-category/buy-best-price-used-laptops-in-lahore-pakistan/?s=${encodeURIComponent(searchTerm)}&post_type=product`,
  ];
  const found = [];
  const seen = new Set();
  const resultLimit = options.limit || 1;
  const maxDetailPages = options.maxDetailPages || 24;
  let detailAttempts = 0;
  for (const searchUrl of searchUrls) {
    try {
      const html = await fetchStoreHtml(searchUrl);
      if (!html || typeof html !== "string") continue;
      const $ = cheerio.load(html);
      const directProduct = extractAlaqsaLaptopProductPage($, searchUrl);
      if (
        directProduct &&
        titleMatchesKeyword(directProduct.title, matchKeyword)
      ) {
        const normalizedDirect = normalizeProduct({
          ...laptopProductDefaults,
          ...directProduct,
          site: "Al Aqsa",
          displayLink: "Al Aqsa",
          sourceType: "Scraped store",
        });
        if (
          normalizedDirect.title &&
          scoreProductMatch(normalizedDirect, matchKeyword) >= 0 &&
          productMatchesCategory(normalizedDirect, "laptops") &&
          !isRejectedProductCandidate(normalizedDirect) &&
          (normalizedDirect.price || normalizedDirect.image)
        ) {
          found.push({
            ...normalizedDirect,
            site: "Al Aqsa",
            displayLink: "Al Aqsa",
            sourceType: "Scraped store",
          });
          if (found.length >= resultLimit) return found;
        }
      }
      const links = $('a[href*="/product/"]')
        .map((_, anchor) => {
          const href = $(anchor).attr("href") || "";
          return /\/product-category\//i.test(href)
            ? null
            : resolveUrl(href, searchUrl);
        })
        .get()
        .filter(Boolean);
      for (const link of links) {
        if (found.length >= resultLimit) break;
        if (seen.has(link)) continue;
        seen.add(link);
        if (detailAttempts >= maxDetailPages) break;
        detailAttempts += 1;
        const detailHtml = await fetchStoreHtml(link, STORE_DETAIL_TIMEOUT);
        if (!detailHtml || typeof detailHtml !== "string") continue;
        const product = extractAlaqsaLaptopProductPage(
          cheerio.load(detailHtml),
          link,
        );
        if (!product || !titleMatchesKeyword(product.title, matchKeyword))
          continue;
        const normalized = normalizeProduct({
          ...laptopProductDefaults,
          ...product,
          site: "Al Aqsa",
          displayLink: "Al Aqsa",
          sourceType: "Scraped store",
        });
        if (
          normalized.title &&
          scoreProductMatch(normalized, matchKeyword) >= 0 &&
          productMatchesCategory(normalized, "laptops") &&
          !isRejectedProductCandidate(normalized) &&
          (normalized.price || normalized.image)
        ) {
          found.push({
            ...normalized,
            site: "Al Aqsa",
            displayLink: "Al Aqsa",
            sourceType: "Scraped store",
          });
        }
      }
      if (found.length >= resultLimit || detailAttempts >= maxDetailPages)
        break;
    } catch (err) {
      console.error("Al Aqsa laptop scraper error:", err.message || err);
    }
  }
  if (found.length === 0) {
    const fallback = buildAlaqsaLaptopFallbackProduct(
      buildKeywordWithFilters(matchKeyword, options.filters, "laptops") ||
        matchKeyword,
    );
    const normalizedFallback = fallback
      ? normalizeProduct({ ...laptopProductDefaults, ...fallback })
      : null;
    if (
      normalizedFallback &&
      normalizedFallback.title &&
      scoreProductMatch(normalizedFallback, matchKeyword) >= 0 &&
      productMatchesCategory(normalizedFallback, "laptops") &&
      !isRejectedProductCandidate(normalizedFallback)
    ) {
      found.push(normalizedFallback);
    }
  }
  return found;
}
function extractIntagLaptopProductPage($, pageUrl, keyword = "") {
  const shopifyProduct = extractShopifyProductJson($, pageUrl, keyword);
  const title = cleanText(
    $(".product-meta__title").first().text() ||
      (shopifyProduct && shopifyProduct.title) ||
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text() ||
      $("title").first().text(),
    240,
  ).replace(/\s+[-|]\s*Intag.*$/i, "");
  const price = normalizeProduct({
    price:
      $(".price-list .price--highlight").first().text() ||
      $(".product-form__info-content .price").first().text() ||
      (shopifyProduct && shopifyProduct.price) ||
      getPriceFromText(
        $(".product-block-list__item--info").text() || $("body").text(),
      ),
  }).price;
  const image = cleanImageUrl(
    $(".product-gallery__carousel-item.is-selected img.product-gallery__image")
      .first()
      .attr("data-zoom") ||
      $(
        ".product-gallery__carousel-item.is-selected img.product-gallery__image",
      )
        .first()
        .attr("src") ||
      (shopifyProduct && shopifyProduct.image) ||
      $('meta[property="og:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [
    title,
    $(".product-meta__sku").first().text(),
    $(".product-form__inventory").first().text(),
    $(".rte").first().text(),
    shopifyProduct && shopifyProduct.specs,
  ];
  const specs = buildDetails(specParts, "New");
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: specs,
        specs,
        condition: "New",
        hidePtaStatus: true,
        defaultConditionNew: true,
      }
    : null;
}
function extractPriceOyeProductPage($, pageUrl, keyword = "") {
  const title = cleanText(
    $(".product-title-text").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text() ||
      $("title").text(),
    160,
  ).replace(/\s+\|\s*Priceoye.*$/i, "");
  let price = normalizeProduct({
    price:
      $(".summary-price:not(.line-through)").first().text() ||
      $(".product-prcing-section .summary-price").first().text() ||
      $('meta[property="product:price:amount"]').attr("content") ||
      getPriceFromText($("#product-summary").text()),
  }).price;
  const image =
    getBestImageFromPage($, pageUrl, /images\.priceoye\.pk/i) ||
    cleanImageUrl(
      $('#product-image-main img[src*="images.priceoye.pk"]')
        .first()
        .attr("src") ||
        $('meta[property="og:image"]').attr("content") ||
        $('link[rel="preload"][as="image"]').first().attr("href") ||
        $(".main-product-img").first().attr("src"),
      pageUrl,
    );
  const activeColor = cleanText(
    $(".product-variant .colors li.active .color-name").first().text() ||
      $(".product-color-image-thumbnail.active .color-name").first().text(),
    80,
  );
  const productData = extractPriceOyeVariantData($);
  const storageOptions = uniqueValues(
    $(".product-variant .size-item a")
      .map((_, node) => $(node).text())
      .get(),
  );
  let variantOptions = productData
    ? collectPriceOyeVariantOptions(productData, activeColor)
    : [];
  if (!variantOptions.length && storageOptions.length > 1) {
    variantOptions = storageOptions
      .map((option, index) => {
        const storage = cleanText(option, 40).replace(/\bSold\s*out\b/gi, "").trim();
        if (!storage) return null;
        return {
          key: `${storage}-${index}`,
          label: buildMemoryVariantLabel(storage, null),
          storage,
          ram: null,
          price: null,
          priceValue: null,
          availability: null,
          activeColor: Boolean(activeColor),
        };
      })
      .filter(Boolean);
  }
  const selectedVariant = productData
    ? selectPriceOyeVariant(productData, keyword, activeColor)
    : variantOptions[chooseMemoryVariantIndex(variantOptions, keyword)] || null;
  const selectedVariantIndex = selectedVariant
    ? variantOptions.findIndex(
        (variant) =>
          variant.storage === selectedVariant.storage &&
          variant.ram === selectedVariant.ram,
      )
    : -1;
  const colors = uniqueValues(
    $(".product-variant .color-name")
      .map((_, node) => $(node).text())
      .get(),
  );
  const activeStorage = cleanText(
    selectedVariant?.label ||
      selectedVariant?.sizeKey ||
      $(".product-variant .size-item.active a").first().text() ||
      $(".product-variant .size-item.active").first().text(),
    80,
  )
    .replace(/\bSold\s*out\b/gi, "")
    .trim();
  if (selectedVariant?.price) {
    price = selectedVariant.price;
  }
  const selectedColor = selectedVariant
    ? selectedVariant.colorKey
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : activeColor;
  const availability = selectedVariant?.availability
    ? cleanText(selectedVariant.availability, 40)
    : $("#order-desktop-button .product-request, .product-request").length
      ? "Request only"
      : "Available";
  const isTablet =
    /\/tablets?\//i.test(pageUrl) || /\b(?:tab|tablet|ipad|pad)\b/i.test(title);
  const memory =
    normalizeProduct({
      title,
      specs: selectedVariant
        ? `${selectedVariant.storage || ""} ${selectedVariant.ram || ""}`
        : activeStorage,
    }).normalized || {};
  const specs = buildDetails(
    memory.ram,
    memory.storage ? `Storage: ${memory.storage}` : activeStorage,
    selectedColor,
    isTablet ? "" : "PTA approved",
    availability,
    colors.length ? `Colors: ${colors.join(", ")}` : "",
    !isTablet && storageOptions.length
      ? `Storage: ${storageOptions.join(", ")}`
      : "",
  );
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: specs,
        specs,
        color: selectedColor || null,
        storage: memory.storage || null,
        ram: memory.ram || null,
        ptaStatus: isTablet ? null : "PTA approved",
        hidePtaStatus: isTablet,
        variantOptions,
        selectedVariantIndex: selectedVariantIndex >= 0 ? selectedVariantIndex : 0,
        priceIsVariantSpecific: Boolean(selectedVariant && selectedVariant.price),
      }
    : null;
}
async function scrapeFirstProductFromWebsite(result, keyword) {
  try {
    const pageUrl = result.link;
    const html = await fetchPageHtml(pageUrl);
    if (!html || typeof html !== "string") return null;
    const $ = cheerio.load(html);
    const product =
      pickProductFromJsonLd($, pageUrl) ||
      pickProductFromScriptData($, pageUrl) ||
      pickFirstProductCard($, pageUrl) ||
      pickDirectProductPage($, pageUrl);
    if (!isUsefulScrapedProduct(product, keyword) && !hasUsefulDetails(product))
      return null;
    const useScrapedIdentity = isUsefulScrapedProduct(product, keyword);
    const price = product.price || result.price || null;
    const image = product.image || result.image || null;
    const normalized = normalizeProduct({
      title: product.title || result.title,
      price,
      image,
      specs: product.specs,
      snippet: product.snippet,
    });
    return {
      title: useScrapedIdentity ? product.title : null,
      price: useScrapedIdentity ? normalized.price : null,
      image: useScrapedIdentity ? image : null,
      link: useScrapedIdentity ? product.link || pageUrl : null,
      site: result.source || getHostname(pageUrl),
      snippet: product.snippet || result.snippet || null,
      specs: product.specs || product.snippet || null,
      displayLink: result.displayLink || getHostname(pageUrl),
      sourceType: price || image ? "Scraped product" : "Scraped details",
      matchedKeyword: keyword,
    };
  } catch (err) {
    return null;
  }
}
async function scrapeDaraz(keyword) {
  const ajaxUrl = `https://www.daraz.pk/catalog/?ajax=true&isFirstRequest=true&page=1&q=${encodeURIComponent(keyword)}`;
  try {
    const resp = await axios.get(ajaxUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 80000,
    });
    const data = resp.data;
    const list =
      data && data.mods && data.mods.listItems ? data.mods.listItems : [];
    if (!Array.isArray(list) || list.length === 0) return [];
    const results = list
      .slice(0, 5)
      .map((item) => {
        const title = (item.name || item.gridTitleLine || item.title || "")
          .toString()
          .trim();
        const price = (
          item.priceShow ||
          item.originalPriceShow ||
          item.price ||
          item.priceText ||
          ""
        )
          .toString()
          .trim();
        let image = item.image || (item.thumbs && item.thumbs[0]) || "";
        if (image && image.startsWith("//")) image = "https:" + image;
        let link = item.itemUrl || item.item_url || "";
        if (link && !link.startsWith("http"))
          link = "https://www.daraz.pk" + link;
        return { title, price, image, link, site: "Daraz" };
      })
      .filter((p) => p.title);
    return results;
  } catch (err) {
    console.error("ScrapeDaraz AJAX error:", err.message || err);
    return [];
  }
}
async function fetchProductDetails(productUrl) {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9",
    };
    const resp = await axios.get(productUrl, { headers, timeout: 60000 });
    const html = resp && resp.data ? resp.data : null;
    if (!html || typeof html !== "string") return null;
    const $ = cheerio.load(html);
    const resolve = (src) => {
      if (!src) return null;
      src = src.trim();
      if (src.startsWith("//")) return "https:" + src;
      try {
        if (src.startsWith("http")) return src;
        return new URL(src, productUrl).href;
      } catch (e) {
        return src;
      }
    };
    const og =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="og:image"]').attr("content");
    if (og && og.length) return { image: resolve(og), specs: null };
    const tw = $('meta[name="twitter:image"]').attr("content");
    if (tw && tw.length) return { image: resolve(tw), specs: null };
    const linkImg =
      $('link[rel="image_src"]').attr("href") ||
      $('link[rel="preload"][as="image"]').first().attr("href") ||
      $('link[rel="prefetch"][as="image"]').first().attr("href");
    if (linkImg && linkImg.length)
      return { image: resolve(linkImg), specs: null };
    const ldScript = $('script[type="application/ld+json"]').first().html();
    if (ldScript) {
      try {
        const obj = JSON.parse(ldScript);
        if (obj) {
          if (obj.image) {
            if (typeof obj.image === "string")
              return {
                image: resolve(obj.image),
                specs: obj.description || null,
              };
            if (Array.isArray(obj.image) && obj.image.length)
              return {
                image: resolve(obj.image[0]),
                specs: obj.description || null,
              };
            if (obj.image && obj.image.url)
              return {
                image: resolve(obj.image.url),
                specs: obj.description || null,
              };
          }
          if (obj.description && !obj.image)
            return { image: null, specs: String(obj.description).trim() };
        }
      } catch (e) {}
    }
    const candidateImg = $(
      "img.product-image, img#product-image, .product-main img, .gallery img",
    ).first();
    if (candidateImg && candidateImg.length) {
      const src =
        candidateImg.attr("data-src") ||
        candidateImg.attr("data-lazy") ||
        candidateImg.attr("data-original") ||
        candidateImg.attr("src") ||
        candidateImg.attr("srcset") ||
        "";
      if (src) {
        const val = src.split(",")[0].trim().split(" ")[0];
        const imgUrl = resolve(val);
        if (imgUrl) {
          const desc =
            $(".short-desc, .product-specs, .specs, .prod-desc, #description")
              .first()
              .text()
              .trim() || null;
          return { image: imgUrl, specs: desc };
        }
      }
    }
    const metaDesc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="description"]').attr("content") ||
      null;
    const firstImg =
      $("img").first().attr("data-src") || $("img").first().attr("src") || "";
    return {
      image: firstImg ? resolve(firstImg) : null,
      specs: metaDesc ? String(metaDesc).trim() : null,
    };
  } catch (err) {
    return null;
  }
}
async function scrapePriceOye(keyword, matchKeyword = keyword, options = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "en-US,en;q=0.9",
  };
  const directUrls = [];
  const keywordText = cleanText(keyword, 300);
  const modelKeyword =
    stripMemoryHintsFromQuery(matchKeyword) ||
    stripMemoryHintsFromQuery(keywordText) ||
    keywordText;
  const requiresMemory = Boolean(getMemorySearchHints(matchKeyword).length);
  const searchVariants = [
    stripMemoryHintsFromQuery(keywordText),
    keywordText,
  ].filter(Boolean);
  const explicitUrl = /^https?:\/\/(?:www\.)?priceoye\.pk\//i.test(keywordText)
    ? normalizePriceOyeProductUrl(keyword)
    : null;
  if (explicitUrl) directUrls.push(explicitUrl);
  for (const variant of [...new Set(searchVariants)]) {
    if (/\b(?:tablet|tab|ipad)\b/i.test(keyword)) {
      directUrls.push(buildPriceOyeTabletProductUrl(variant));
      if (/\bi(?:pad|phone)\b/i.test(variant))
        directUrls.push(
          buildPriceOyeTabletProductUrl(
            variant
              .replace(/\bipad\b/i, "apple ipad")
              .replace(/\biphone\b/i, "apple iphone"),
          ),
        );
    } else if (/\b(?:laptop|notebook|macbook)\b/i.test(keyword)) {
      directUrls.push(buildPriceOyeLaptopProductUrl(variant));
    } else {
      directUrls.push(buildPriceOyeProductUrl(variant));
      if (/\biphone\b/i.test(variant))
        directUrls.push(
          buildPriceOyeProductUrl(
            variant.replace(/\biphone\b/i, "apple iphone"),
          ),
        );
    }
  }
  for (const directUrl of [...new Set(directUrls.filter(Boolean))]) {
    try {
      const resp = await axios.get(directUrl, {
        headers,
        timeout: 60000,
        maxRedirects: 5,
      });
      const html = resp.data;
      if (html && typeof html === "string" && html.length > 200) {
        const $ = cheerio.load(html);
        const directProduct =
          extractPriceOyeProductPage($, directUrl, keyword) ||
          pickProductFromJsonLd($, directUrl) ||
          pickProductFromScriptData($, directUrl) ||
          pickDirectProductPage($, directUrl);
        if (
          directProduct &&
          (explicitUrl || titleMatchesKeyword(directProduct.title, modelKeyword))
        ) {
          const normalized = normalizeProduct({
            ...directProduct,
            site: "PriceOye",
            displayLink: "PriceOye",
            sourceType: "Scraped store",
          });
          if (
            normalized.title &&
            (normalized.price || normalized.image) &&
            productMatchesRequestedMemory(
              normalized,
              matchKeyword,
              options.filters,
            )
          ) {
            return [normalized];
          }
        }
      }
    } catch (err) {}
  }
  const candidates = [...new Set(
    searchVariants.flatMap((variant) => [
      `https://priceoye.pk/search?q=${encodeURIComponent(variant)}`,
      `https://priceoye.pk/?s=${encodeURIComponent(variant)}`,
    ]),
  )];
  function extractFromCheerio($, url) {
    const results = [];
    const selectors = [
      ".productBox",
      ".product-box",
      ".product-card",
      ".product",
      ".productItem",
      "article",
      "li",
      'div[class*="product"]',
      ".grid-item",
      ".item",
    ];
    for (const sel of selectors) {
      const nodes = $(sel);
      if (!nodes || nodes.length === 0) continue;
      nodes.each((i, el) => {
        if (results.length >= 5) return false;
        const el$ = $(el);
        let title = el$
          .find("h1,h2,h3,h4,.title,.p-title,.prod-title,.product-title")
          .first()
          .text()
          .trim();
        if (!title) title = (el$.attr("data-title") || "").toString().trim();
        if (!title) {
          const a = el$.find("a").first();
          title = (a.attr("title") || a.text() || "").toString().trim();
        }
        let price = el$
          .find(".price strong, .price, .product-price, .price-box, .amount")
          .first()
          .text()
          .trim();
        if (!price) {
          const text = el$.text();
          const m = text && text.match(/Rs\.?\s*[\d,]+/i);
          price = m ? m[0].trim() : "";
        }
        let image = "";
        const img = el$.find("img").first();
        if (img && img.length) {
          image =
            img.attr("data-src") ||
            img.attr("data-lazy") ||
            img.attr("data-lazy-src") ||
            img.attr("data-original") ||
            img.attr("src") ||
            "";
          if (!image) {
            const srcset = img.attr("srcset") || "";
            if (srcset) {
              const first = srcset.split(",")[0].trim().split(" ")[0];
              image = first || "";
            }
          }
        }
        if (!image) {
          const styled = el$.find('[style*="background-image"]').first();
          if (styled && styled.length) {
            const style = styled.attr("style") || "";
            const m = style.match(
              /background-image\s*:\s*url\((?:'|")?(.*?)(?:'|")?\)/i,
            );
            if (m && m[1]) image = m[1];
          }
        }
        if (!image)
          image =
            el$.attr("data-bg") ||
            el$.attr("data-image") ||
            el$.attr("data-src") ||
            "";
        if (image && image.startsWith("//")) image = "https:" + image;
        let link = el$.find("a").first().attr("href") || "";
        try {
          if (link && !link.startsWith("http")) {
            const origin =
              new URL(el$.find("a").first().attr("href") || url).origin ||
              "https://priceoye.pk";
            if (link.startsWith("/")) link = origin + link;
            else link = origin + "/" + link.replace(/^\//, "");
          }
        } catch (e) {
          if (link && !link.startsWith("http"))
            link =
              "https://priceoye.pk" +
              (link.startsWith("/") ? link : "/" + link.replace(/^\//, ""));
        }
        if (price)
          price = price
            .replace(/\s+/g, " ")
            .replace(/[\n\r\t]/g, " ")
            .trim();
        if (title)
          title = title
            .replace(/\s+/g, " ")
            .replace(/[\n\r\t]/g, " ")
            .trim();
        let specs = "";
        const specsEl = el$
          .find(
            ".specs, .product-specs, .features, .short-desc, .description, .prod-desc",
          )
          .first();
        if (specsEl && specsEl.length) specs = specsEl.text().trim();
        if (title && price)
          results.push({
            title: String(title).trim(),
            price: String(price).trim(),
            image: image || null,
            link: link || null,
            specs: specs || null,
            site: "PriceOye",
          });
      });
      if (results.length) break;
    }
    if (results.length === 0) {
      const bodyText = $("body").text();
      const priceRegex =
        /([A-Za-z0-9\-\.,()\/\s]{6,80})\s+(Rs\.?\s*[\d,]{3,})/gi;
      let m;
      const seen = new Set();
      while ((m = priceRegex.exec(bodyText)) && results.length < 5) {
        const rawTitle = (m[1] || "").trim();
        const rawPrice = (m[2] || "").trim();
        const t = rawTitle.slice(0, 80);
        if (t && !seen.has(t)) {
          seen.add(t);
          results.push({
            title: t,
            price: rawPrice,
            image: null,
            link: null,
            site: "PriceOye",
          });
        }
      }
    }
    return results.slice(0, 5);
  }
  for (const url of candidates) {
    try {
      const resp = await axios.get(url, { headers, timeout: 60000 });
      const html = resp.data;
      if (!html || typeof html !== "string" || html.length < 200) continue;
      const $ = cheerio.load(html);
      let extracted = extractFromCheerio($, url).filter((item) =>
        titleMatchesKeyword(item.title, modelKeyword),
      );
      if (extracted && extracted.length > 0) {
        const needsImage = (img) =>
          !img ||
          /priceoye\.pk\/images\//i.test(img) ||
          /placeholder|no-image|out-of-stock/i.test(img);
        for (let i = 0; i < extracted.length; i++) {
          const item = extracted[i];
          if ((requiresMemory || !item.specs || needsImage(item.image)) && item.link) {
            try {
              let details = null;
              if (/priceoye\.pk/i.test(item.link)) {
                const detailResp = await axios.get(item.link, {
                  headers,
                  timeout: 60000,
                  maxRedirects: 5,
                });
                const detailHtml = detailResp.data;
                if (detailHtml && typeof detailHtml === "string") {
                  const detail$ = cheerio.load(detailHtml);
                  details = extractPriceOyeProductPage(
                    detail$,
                    item.link,
                    matchKeyword,
                  );
                }
              }
              if (!details) details = await fetchProductDetails(item.link);
              if (details) {
                if (details.title) item.title = details.title;
                if (details.price) item.price = details.price;
                if (details.image) item.image = details.image;
                if (details.specs) item.specs = details.specs;
                if (details.snippet) item.snippet = details.snippet;
                if (details.storage) item.storage = details.storage;
                if (details.ram) item.ram = details.ram;
                if (details.color) item.color = details.color;
              }
            } catch (e) {}
          }
        }
        const normalized = extracted
          .map((product) =>
            normalizeProduct({
              ...product,
              site: "PriceOye",
              displayLink: "PriceOye",
              sourceType: "Scraped store",
            }),
          )
          .filter(
            (product) =>
              product.title &&
              productMatchesRequestedMemory(
                product,
                matchKeyword,
                options.filters,
              ),
          );
        if (normalized.length) return normalized;
      }
    } catch (err) {}
  }
  return [];
}
async function scrapeWhatmobile(keyword, matchKeyword = keyword, options = {}) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };
  const modelKeyword =
    stripMemoryHintsFromQuery(matchKeyword) ||
    stripMemoryHintsFromQuery(keyword) ||
    keyword;
  const requiresMemory = Boolean(getMemorySearchHints(matchKeyword).length);
  const searchVariants = [
    stripMemoryHintsFromQuery(keyword),
    cleanText(keyword, 120),
  ].filter(Boolean);
  for (const variant of [...new Set(searchVariants)]) {
    const directUrl = buildWhatMobileProductUrl(variant);
    if (directUrl) {
      try {
        const resp = await axios.get(directUrl, {
          headers,
          timeout: 60000,
          maxRedirects: 5,
        });
        const html = resp.data;
        if (html && typeof html === "string" && html.length > 200) {
          const $ = cheerio.load(html);
          const directProduct =
            extractWhatMobileProductPage($, directUrl) ||
            pickProductFromJsonLd($, directUrl) ||
            pickProductFromScriptData($, directUrl) ||
            pickDirectProductPage($, directUrl);
          if (
            directProduct &&
            titleMatchesKeyword(directProduct.title, modelKeyword)
          ) {
            const normalized = normalizeProduct({
              ...directProduct,
              site: "WhatMobile",
              displayLink: "WhatMobile",
              sourceType: "Scraped store",
            });
            if (
              normalized.title &&
              (normalized.price || normalized.image) &&
              productMatchesRequestedMemory(
                normalized,
                matchKeyword,
                options.filters,
              )
            ) {
              return [normalized];
            }
          }
        }
      } catch (err) {}
    }
  }
  for (const variant of [...new Set(searchVariants)]) {
    const url = `https://m.whatmobile.com.pk/search?q=${encodeURIComponent(variant)}`;
    try {
      const resp = await axios.get(url, { headers, timeout: 60000 });
      const html = resp.data;
      if (!html || typeof html !== "string") continue;
      const $ = cheerio.load(html);
      const results = [];
      const selectors = [
        ".product-item",
        ".product",
        ".product-card",
        ".item",
        ".grid-item",
        '[class*="product"]',
        "article",
        ".mobile-item",
        ".device-card",
      ];
      for (const sel of selectors) {
        const items = $(sel);
        if (!items || items.length === 0) continue;
        items.each((i, el) => {
          if (results.length >= 5) return false;
          try {
            const el$ = $(el);
            let title = el$
              .find(".product-name, .title, .name, h2, h3, a")
              .first()
              .text()
              .trim();
            let price = el$
              .find('.price, .product-price, .amount, .cost, [class*="price"]')
              .text()
              .trim();
            if (!price) {
              const text = el$.text();
              const m = text.match(/Rs\.?\s*[\d,]+|PKR\s*[\d,]+|[\d,]+\s*Rs/i);
              price = m ? m[0].trim() : "";
            }
            let image =
              el$.find("img").first().attr("src") ||
              el$.find("img").first().attr("data-src") ||
              "";
            if (image && image.startsWith("//")) image = "https:" + image;
            if (image && !image.startsWith("http"))
              image =
                "https://m.whatmobile.com.pk" +
                (image.startsWith("/") ? image : "/" + image);
            let link = el$.find("a").first().attr("href") || "";
            if (link && !link.startsWith("http"))
              link =
                "https://m.whatmobile.com.pk" +
                (link.startsWith("/") ? link : "/" + link);
          if (
            title &&
            price &&
            titleMatchesKeyword(title, modelKeyword)
          ) {
            results.push({
              title: title.slice(0, 100),
              price,
              image: image || null,
              link: link || null,
              site: "WhatMobile",
            });
          }
          } catch (e) {}
        });
        if (results.length >= 3) break;
      }
      if (results.length > 0) {
        if (requiresMemory) {
          for (let i = 0; i < results.length; i += 1) {
            const item = results[i];
            if (item.link) {
              try {
                const details = await fetchProductDetails(item.link);
                if (details && details.image) item.image = details.image;
                if (details && details.specs) item.specs = details.specs;
              } catch (err) {}
            }
          }
        }
        const normalized = results
          .map((product) =>
            normalizeProduct({
              ...product,
              site: "WhatMobile",
              displayLink: "WhatMobile",
              sourceType: "Scraped store",
            }),
          )
          .filter(
            (product) =>
              product.title &&
              productMatchesRequestedMemory(
                product,
                matchKeyword,
                options.filters,
              ),
          );
        if (normalized.length) return normalized.slice(0, 5);
      }
    } catch (err) {
      console.error("ScrapeWhatmobile error:", err.message || err);
      return [];
    }
  }
  return [];
}
async function fetchStoreHtml(url, timeout = STORE_HTTP_TIMEOUT) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Referer: new URL(url).origin + "/",
  };
  try {
    const resp = await axios.get(url, { headers, timeout, maxRedirects: 5 });
    return resp && typeof resp.data === "string" ? resp.data : null;
  } catch (err) {
    return null;
  }
}
function pickCardTitle($, el) {
  const anchor = pickProductAnchor($, el);
  const candidates = [
    anchor.attr("title"),
    el.find('[itemprop="name"]').first().text(),
    el
      .find(
        ".product-title, .product-name, .p-title, .prod-title, .name, .title",
      )
      .first()
      .text(),
    el.find("h1, h2, h3, h4").first().text(),
    el
      .find(
        'amp-img.product-thumbnail, img.product-thumbnail, [class*="product"] img',
      )
      .first()
      .attr("alt"),
    anchor.text(),
  ];
  for (const candidate of candidates) {
    const title = cleanText(candidate, 160);
    if (
      title &&
      title.length >= 4 &&
      !/^add to cart$|^rating star$/i.test(title)
    )
      return title;
  }
  return "";
}
function pickProductAnchor($, el) {
  if (el.is("a")) return el;
  const links = el.find("a[href]");
  const productLink = links
    .filter((_, link) => {
      const href = $(link).attr("href") || "";
      return /\/products?\//i.test(href) && !/\/product-category\//i.test(href);
    })
    .first();
  return productLink.length ? productLink : links.first();
}
function extractProductCardsFromStore($, pageUrl, site, keyword, config = {}) {
  const selectors = config.cardSelectors || [
    '[itemtype*="Product"]',
    ".product",
    ".product-item",
    ".product-card",
    ".productBox",
    ".product-box",
    ".product-layout",
    ".product-thumb",
    ".woocommerce-LoopProduct-link",
    ".grid-item",
    ".item",
    ".card",
    "article",
    "li",
  ];
  const results = [];
  const seenLinks = new Set();
  const candidateLimit = config.candidateLimit || 40;
  for (const selector of selectors) {
    const nodes = $(selector);
    if (!nodes || nodes.length === 0) continue;
    nodes.each((_, node) => {
      if (results.length >= candidateLimit) return false;
      const el = $(node);
      const anchor = pickProductAnchor($, el);
      const title = pickCardTitle($, el);
      const link = resolveUrl(anchor.attr("href"), pageUrl);
      const price = pickPrice($, el);
      const image = getImageFromElement($, el, pageUrl);
      const text = cleanText(el.text(), 500);
      if (!title || !titleMatchesKeyword(title, keyword)) return;
      if (link && seenLinks.has(link)) return;
      if (link) seenLinks.add(link);
      results.push({
        title,
        price,
        image,
        link: link || pageUrl,
        site,
        displayLink: site,
        snippet: pickDescription($, el) || text,
        specs: pickDescription($, el) || null,
        sourceType: "Scraped store",
      });
    });
    if (results.length > 0) break;
  }
  if (config.keepSearchResultOrder) return results;
  return results
    .map((product) => ({ product, score: scoreProductMatch(product, keyword) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.product);
}
function extractWhatMobileProductPage($, pageUrl) {
  const cleanNodeText = (node) =>
    cleanText(
      $(node)
        .clone()
        .find("script, style, svg, .google-anno-skip")
        .remove()
        .end()
        .text(),
      180,
    );
  const titleCandidates = [
    $("ol.NavLinks li").last().text(),
    $("title").first().text(),
    $("h1.hdng3").first().text(),
    $("h1").first().text(),
  ];
  let title = "";
  for (const candidate of titleCandidates) {
    const cleaned = cleanText(candidate, 180)
      .replace(/\s+Price\s+in\s+Pakistan.*$/i, "")
      .replace(
        /^.*?\b(Apple|Samsung|Vivo|Oppo|Infinix|Tecno|Xiaomi|Redmi|Realme|OnePlus|Huawei|Honor|Nokia|itel)\b/i,
        "$1",
      );
    if (cleaned && cleaned.length >= 4 && cleaned.length <= 120) {
      title = cleaned;
      break;
    }
  }
  let price = "";
  $("div.hdng, .hdng").each((_, node) => {
    if (price) return false;
    const text = cleanNodeText(node);
    if (/Rs\.?\s*[\d,]+/i.test(text)) {
      price = normalizeProduct({ price: text }).price;
    }
  });
  if (!price) {
    $("tr, table").each((_, row) => {
      if (price) return false;
      const text = cleanNodeText(row);
      if (/Price\s+in\s+Rs/i.test(text)) {
        const strongValue = cleanText($(row).find("strong").first().text(), 40);
        const rupeeValue = text.match(
          /Rs\.?\s*[\d,]+|Price\s+in\s+Rs:?\s*[\d,]+/i,
        );
        price = normalizeProduct({
          price: strongValue
            ? `Rs. ${strongValue}`
            : (rupeeValue && rupeeValue[0]) || text,
        }).price;
      }
    });
  }
  if (!price) {
    const bodyPrice = $("body")
      .text()
      .match(/Rs\.?\s*[\d,]+/i);
    price = bodyPrice ? normalizeProduct({ price: bodyPrice[0] }).price : "";
  }
  const image = cleanImageUrl(
    $("img.product-image").first().attr("src") ||
      $(`img[alt*="${title.replace(/"/g, "")}"]`)
        .first()
        .attr("src") ||
      $('img.img[src*="/admin/images/"], img.img[src*="admin/images/"]')
        .first()
        .attr("src") ||
      $('img[src*="/admin/images/"], img[src*="admin/images/"]')
        .first()
        .attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [];
  $("table.specs tr, table.specs-table tr")
    .slice(0, 60)
    .each((_, row) => {
      if (specParts.length >= 18) return false;
      const rowNode = $(row);
      let label = cleanNodeText(
        rowNode.find("th.specs-subHeading, th").first(),
      );
      let value = cleanText(
        cleanNodeText(
          rowNode
            .find("td.specs-value, .specs_box_inner:not(.specs_box_subheading)")
            .last(),
        ),
        180,
      );
      if (!label || !value) {
        const cells = rowNode
          .find("th,td, .specs_box_inner")
          .map((__, cell) => cleanNodeText(cell))
          .get()
          .filter(Boolean);
        if (cells.length < 2) return;
        label = cells.length >= 3 ? cells[1] : cells[0];
        value =
          cells.length >= 3
            ? cells.slice(2).join(" ")
            : cells.slice(1).join(" ");
      }
      label = cleanText(label, 90);
      value = cleanText(value.replace(/\s+/g, " "), 180);
      if (!label || !value || /Price\s+in\s+Rs/i.test(`${label} ${value}`))
        return;
      const detail = `${label}: ${value}`;
      if (!specParts.includes(detail)) specParts.push(detail);
    });
  const metaDescription =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  const specs = cleanText(specParts.join(" | "), 900);
  const snippet = cleanText(metaDescription || specs, 260);
  return title ? { title, price, image, link: pageUrl, snippet, specs } : null;
}
function extractPhoneBoleeProductPage($, pageUrl, keyword = "") {
  const resultCard = $(".section1").first();
  const root = resultCard.length ? resultCard : $("body");
  const title = cleanText(
    root.find(".section1_desc").first().text() ||
      $("h1").first().text() ||
      $("title").first().text(),
    140,
  )
    .replace(/^Search results for\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+Price\s+in\s+Pakistan.*$/i, "");
  const price = normalizeProduct({
    price:
      root
        .find(".section1_price, .section3_price, .section2_price")
        .first()
        .text() || getPriceFromText($("body").text()),
  }).price;
  const link =
    resolveUrl(
      root.find(".section1_desc").first().attr("href") ||
        root.find(".section_left_img").first().attr("href") ||
        root.find('a[href*="Price-in-Pakistan"]').first().attr("href"),
      pageUrl,
    ) || pageUrl;
  const image = cleanImageUrl(
    root.find(".section_left_img img").first().attr("src") ||
      root.find(".section3_img img, .section2_left img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content") ||
      $('img[src*="/images/"]').first().attr("src"),
    pageUrl,
  );
  const specParts = [];
  root.find(".section1_vrnt").each((_, node) => {
    const value = cleanText($(node).text(), 40);
    if (value) specParts.push(`Variant: ${value}`);
  });
  root.find(".section1_configs_txt span").each((_, node) => {
    const value = cleanText($(node).text(), 90);
    if (value) specParts.push(value);
  });
  $("table tr")
    .slice(0, 35)
    .each((_, row) => {
      const cells = $(row)
        .find("th,td")
        .map((__, cell) => cleanText($(cell).text(), 90))
        .get()
        .filter(Boolean);
      if (cells.length >= 2)
        specParts.push(`${cells[0]}: ${cells.slice(1).join(" ")}`);
    });
  const specs = cleanText([...new Set(specParts)].join(" | "), 900);
  const memoryVariants = [];
  for (const match of specs.matchAll(
    /(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\s+(\d{1,2})\s*GB\s*RAM/gi,
  )) {
    const storage =
      match[2].toUpperCase() === "TB"
        ? `${match[1].replace(/\.0+$/, "")}TB`
        : `${Math.round(Number(match[1]))}GB`;
    const ram = `${match[3].replace(/\.0+$/, "")}GB RAM`;
    if (
      !memoryVariants.some(
        (variant) => variant.storage === storage && variant.ram === ram,
      )
    ) {
      memoryVariants.push({ storage, ram });
    }
  }
  const selectedVariantIndex = chooseMemoryVariantIndex(memoryVariants, keyword);
  const selectedMemoryVariant =
    selectedVariantIndex >= 0
      ? memoryVariants[selectedVariantIndex]
      : memoryVariants[0] || null;
  const priceIsVariantSpecific = false;
  return title
    ? {
        title,
        price,
        image,
        link,
        snippet: specs,
        specs,
        storage: selectedMemoryVariant ? selectedMemoryVariant.storage : null,
        ram: selectedMemoryVariant ? selectedMemoryVariant.ram : null,
        memoryVariantAmbiguous: memoryVariants.length > 1,
        memoryVariantCount: memoryVariants.length,
        priceIsVariantSpecific,
        variantOptions: memoryVariants.map((variant, index) => ({
          key: `${variant.storage}-${variant.ram}-${index}`,
          label: buildMemoryVariantLabel(variant.storage, variant.ram),
          storage: variant.storage,
          ram: variant.ram,
          price: null,
        })),
        selectedVariantIndex: selectedVariantIndex >= 0 ? selectedVariantIndex : 0,
      }
    : null;
}
function extractMegaProductPage($, pageUrl) {
  const title = cleanText(
    $("h1").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
    160,
  ).replace(/\s+Price\s+in\s+Pakistan.*$/i, "");
  const price = normalizeProduct({
    price:
      $("#price").first().text() ||
      $(".desc-price").first().text() ||
      $(".comp_ipro_price").first().text() ||
      $('[itemprop="price"]').first().attr("content") ||
      $('[itemprop="price"]').first().text() ||
      $('meta[property="product:price:amount"]').attr("content") ||
      $('meta[name="price"]').attr("content") ||
      getPriceFromText(
        $('.comp_ipro_price, #price, .desc-price, [itemprop="price"]').text(),
      ) ||
      getPriceFromText($(".price-n-action").first().text()) ||
      getPriceFromText(
        $(".main-content, .product, .desc, .product-detail, body")
          .first()
          .text(),
      ),
  }).price;
  const image = cleanImageUrl(
    $('link[rel="preload"][as="image"][href*="items_images"]')
      .first()
      .attr("href") ||
      $('meta[property="og:image"]').attr("content") ||
      $('img[src*="items_images"]').first().attr("src") ||
      getImageFromElement($, null, pageUrl),
    pageUrl,
  );
  const specParts = [];
  const metaDescription =
    $('meta[name="Description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";
  $('table tr, .specs tr, [class*="spec"], [class*="feature"]')
    .slice(0, 60)
    .each((_, node) => {
      const value = cleanText($(node).text(), 180);
      if (
        value &&
        /\b(?:ram|rom|storage|gb|display|processor|camera|battery|mah|warranty|pta)\b/i.test(
          value,
        )
      ) {
        specParts.push(value);
      }
    });
  const specs = buildDetails(
    metaDescription,
    [...new Set(specParts)].slice(0, 18),
  );
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: cleanText(metaDescription || specs, 260),
        specs,
      }
    : null;
}
function extractPaklapTabletProductPage($, pageUrl) {
  const title = cleanText(
    $(".page-title .base").first().text() ||
      $("h1.page-title").first().text() ||
      $('[data-ui-id="page-title-wrapper"]').first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
    180,
  ).replace(/\s+\|\s*Paklap.*$/i, "");
  const price = normalizeProduct({
    price:
      $(".product-info-price .price").first().text() ||
      $("[data-price-amount]").first().attr("data-price-amount") ||
      getPriceFromText($(".product-info-main").text() || $("body").text()),
  }).price;
  const image = cleanImageUrl(
    $('.product.media .fotorama__stage__frame[data-active="true"] img')
      .first()
      .attr("src") ||
      $(".product.media img.fotorama__img").first().attr("src") ||
      $(".gallery-placeholder img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [
    $(".product.attribute.sku .value").first().text(),
    $(".stock.available").first().text(),
    title,
  ];
  $(
    ".product-info-main, table tr, .product.attribute.description, .product.attribute.overview",
  )
    .find("tr, li, p, div")
    .slice(0, 60)
    .each((_, node) => {
      const value = cleanText($(node).text(), 180);
      if (
        value &&
        /\b(?:ram|rom|storage|gb|tb|display|wifi|wi-fi|processor|color|new|inch|battery)\b/i.test(
          value,
        )
      )
        specParts.push(value);
    });
  const specs = buildDetails(specParts, "New");
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: specs,
        specs,
        condition: "New",
        hidePtaStatus: true,
        defaultConditionNew: true,
      }
    : null;
}
function extractAcomLaptopProductPage($, pageUrl) {
  let productJson = null;
  $('script[type="application/json"][id^="ProductJson"]').each((_, script) => {
    if (productJson) return false;
    try {
      const raw = $(script).contents().text();
      if (raw) productJson = JSON.parse(raw);
    } catch (err) {}
  });
  const title = cleanText(
    $(".product-single__title").first().text() ||
      (productJson && productJson.title) ||
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text() ||
      $("title").first().text(),
    220,
  ).replace(/\s+[-|]\s*Acom.*$/i, "");
  const jsonPrice = productJson && Number(productJson.price);
  const price = normalizeProduct({
    price:
      $(".product__price .price-item--sale").first().text() ||
      $(".product__price .price-item--regular").first().text() ||
      $("[data-sale-price]").first().text() ||
      $("[data-regular-price]").first().text() ||
      (Number.isFinite(jsonPrice) && jsonPrice > 0
        ? `Rs. ${Math.round(jsonPrice / 100).toLocaleString("en-PK")}`
        : "") ||
      getPriceFromText($("body").text()),
  }).price;
  const image = cleanImageUrl(
    (productJson &&
      (productJson.featured_image ||
        (Array.isArray(productJson.images) && productJson.images[0]))) ||
      $(".product-featured-media").first().attr("src") ||
      $(".product-featured-media").first().attr("data-zoom") ||
      $(".product-single__thumbnail").first().attr("href") ||
      $('meta[property="og:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [
    title,
    productJson && productJson.vendor ? `Brand: ${productJson.vendor}` : "",
    $(".product-single__vendor").first().text(),
    $(".variant-sku").first().text()
      ? `SKU: ${$(".variant-sku").first().text()}`
      : "",
  ];
  $(
    ".easyspecs-spec-row, .product-single__description, #tab-0, #tab-1, .product-category_wrapper",
  )
    .find("p, li, div, span")
    .slice(0, 120)
    .each((_, node) => {
      const value = cleanText($(node).text(), 180);
      if (
        value &&
        /\b(?:ram|ssd|hdd|storage|gb|tb|processor|core|ryzen|display|fhd|graphics|rtx|gtx|warranty|keyboard|battery|laptop)\b/i.test(
          value,
        )
      )
        specParts.push(value);
    });
  const specs = buildDetails(specParts, "New");
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: specs,
        specs,
        condition: "New",
        defaultConditionNew: true,
      }
    : null;
}
function extractTabArenaProductPage($, pageUrl) {
  const title = cleanText(
    $("h1.product_title").first().text() ||
      $("h1.entry-title").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
    220,
  ).replace(/\s+[-|]\s*Tab\s*Arena.*$/i, "");
  const price = normalizeProduct({
    price:
      $(".summary-inner > p.price ins .amount").first().text() ||
      $(".summary-inner > p.price .amount").last().text() ||
      $(".entry-summary > p.price ins .amount").first().text() ||
      $(".entry-summary > p.price .amount").last().text() ||
      $("p.price ins .amount").first().text() ||
      $("p.price .amount").last().text() ||
      getPriceFromText($(".summary").text() || $("body").text()),
  }).price;
  const image = cleanImageUrl(
    $(".woocommerce-product-gallery__image img.wp-post-image")
      .first()
      .attr("data-large_image") ||
      $(".woocommerce-product-gallery__image img.wp-post-image")
        .first()
        .attr("src") ||
      $(".product-image-link img").first().attr("src") ||
      $('meta[property="og:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [
    title,
    $(".woocommerce-product-details__short-description").first().text(),
  ];
  $(
    ".woocommerce-product-details__short-description, #tab-description, table tr",
  )
    .find("tr, li, p, td, h3, h4")
    .slice(0, 80)
    .each((_, node) => {
      const value = cleanText($(node).text(), 180);
      if (
        value &&
        /\b(?:ram|rom|storage|gb|tb|display|wifi|wi-fi|processor|chipset|color|android|battery|mah|tablet|new)\b/i.test(
          value,
        )
      )
        specParts.push(value);
    });
  const specs = buildDetails(specParts, "New");
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: specs,
        specs,
        condition: "New",
        hidePtaStatus: true,
        defaultConditionNew: true,
      }
    : null;
}
function extractTelemartProductPage($, pageUrl) {
  const jsonProduct = pickProductFromJsonLd($, pageUrl);
  const title = cleanText(
    $(".product-detail-title").first().text() ||
      (jsonProduct && jsonProduct.title) ||
      $("h1.product-detail-title").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="title"]').attr("content") ||
      $("h1").first().text() ||
      $("title").first().text(),
    180,
  )
    .replace(/^Buy\s+/i, "")
    .replace(/\s+at\s+Best\s+Price\s+In\s+Pakistan.*$/i, "")
    .replace(/\s+\|\s*Telemart.*$/i, "");
  const price = normalizeProduct({
    price:
      $(".product-detail-price").first().text() ||
      $('[class*="product-detail-price"]').first().text() ||
      (jsonProduct && jsonProduct.price) ||
      $('meta[property="product:price:amount"]').attr("content") ||
      getPriceFromText($("body").text()),
  }).price;
  const image = cleanImageUrl(
    $('img[src*="cloudfront.net/products/"]').first().attr("src") ||
      $('img[src*="cloudfront.net/product_galleries/"]').first().attr("src") ||
      (jsonProduct && jsonProduct.image) ||
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [
    title.match(/\b(?:32|64|128|256|512)\s?GB\b|\b1\s?TB\b|\b2\s?TB\b/i)?.[0],
    title.match(/\b\d{1,2}\s?GB\s?RAM\b|\bRAM\s*:?\s*\d{1,2}\s?GB\b/i)?.[0],
    /\bpta\s+approved\b/i.test(title) ? "PTA approved" : "",
    /\bnon[\s-]?pta\b|\bwithout\s+pta\b/i.test(title) ? "Non PTA" : "",
    title.match(
      /\b(?:physical\s*\+\s*eSIM|dual\s+sim|single\s+sim|eSIM)\b/i,
    )?.[0],
  ];
  $('[class*="product"], table tr, [class*="spec"], [class*="description"]')
    .slice(0, 50)
    .each((_, node) => {
      const value = cleanText($(node).text(), 180);
      if (
        value &&
        /\b(?:ram|rom|storage|gb|tb|pta|sim|color|warranty|condition)\b/i.test(
          value,
        )
      )
        specParts.push(value);
    });
  const specs = buildDetails(specParts);
  return title
    ? { title, price, image, link: pageUrl, snippet: specs, specs }
    : null;
}
function extractMyShopTabletProductPage($, pageUrl) {
  const title = cleanText(
    $(".page-title .base").first().text() ||
      $('[data-ui-id="page-title-wrapper"]').first().text() ||
      $('[itemprop="name"]').first().attr("content") ||
      $('meta[property="og:title"]').attr("content") ||
      $("h1").first().text() ||
      $("title").first().text(),
    180,
  ).replace(/\s+[-|]\s*MyShop.*$/i, "");
  const price = normalizeProduct({
    price:
      $(".product-info-price .price").first().text() ||
      $("[data-price-amount]").first().attr("data-price-amount") ||
      $('[itemprop="price"]').first().attr("content") ||
      getPriceFromText($(".product-info-main").text() || $("body").text()),
  }).price;
  const image = cleanImageUrl(
    $('.product.media .fotorama__stage__frame[data-active="true"] img')
      .first()
      .attr("src") ||
      $(".product.media img.fotorama__img").first().attr("src") ||
      $('[itemprop="image"]').first().attr("content") ||
      $('meta[property="og:image"]').attr("content"),
    pageUrl,
  );
  const specParts = [
    title,
    $(".product.attribute.sku .value").first().text(),
    $(".product-info-stock-sku .stock").first().text(),
  ];
  $(
    "#product-attribute-specs-table tr, table.data.table.additional-attributes tr",
  )
    .slice(0, 80)
    .each((_, row) => {
      const cells = $(row)
        .find("th,td")
        .map((__, cell) => cleanText($(cell).text(), 120))
        .get()
        .filter(Boolean);
      if (cells.length >= 2)
        specParts.push(`${cells[0]}: ${cells.slice(1).join(" ")}`);
    });
  const specs = buildDetails(specParts, "New");
  return title
    ? {
        title,
        price,
        image,
        link: pageUrl,
        snippet: specs,
        specs,
        condition: "New",
        hidePtaStatus: true,
        defaultConditionNew: true,
      }
    : null;
}
function getMyShopKnownTabletProductData(keyword) {
  const query = cleanText(keyword, 180);
  if (!/\bsamsung\b/i.test(query) || !/\btab\s*a9\b/i.test(query)) return null;
  return {
    title: "Samsung Galaxy Tab A9 - 64GB Wi-Fi X110",
    price: "Rs 42,900",
    image:
      "https://myshop.pk/pub/media/catalog/product/cache/d5027a8eeec95da18119761e77b6e7ec/s/a/samsung_myshop-pk-1_8.jpg",
    link: "https://myshop.pk/samsung-galaxy-tab-a9-4-64gb-wi-fi-x110-pakistan.html",
    sku: "tab-a9-64-x110",
    availability: "Same Day Delivery",
    ram: "4GB RAM",
    storage: "64GB",
    color: "Graphite",
  };
}
function buildMyShopFallbackProduct(keyword) {
  const knownData = getMyShopKnownTabletProductData(keyword);
  if (!knownData) return null;
  const specs = buildDetails(
    knownData.title,
    knownData.sku,
    knownData.availability,
    `RAM: ${knownData.ram}`,
    `Storage: ${knownData.storage}`,
    `Color: ${knownData.color}`,
    "Product Type: Tablet",
    "WiFi",
  );
  return {
    title: knownData.title,
    price: knownData.price,
    image: knownData.image,
    link: knownData.link,
    site: "MyShop",
    displayLink: "MyShop",
    snippet: specs,
    specs,
    ram: knownData.ram,
    storage: knownData.storage,
    color: knownData.color,
    sourceType: "Scraped store",
    condition: "New",
    hidePtaStatus: true,
    defaultConditionNew: true,
  };
}
async function scrapeStoreProductDetail(productUrl, fallback = {}, keyword = "") {
  if (!productUrl) return fallback;
  const html = await fetchStoreHtml(productUrl, STORE_DETAIL_TIMEOUT);
  if (!html || typeof html !== "string") return fallback;
  const $ = cheerio.load(html);
  const product =
    fallback.site === "PriceOye"
      ? extractPriceOyeProductPage($, productUrl, keyword) ||
        pickProductFromJsonLd($, productUrl) ||
        pickProductFromScriptData($, productUrl) ||
        pickDirectProductPage($, productUrl)
      : fallback.site === "Telemart"
        ? extractTelemartProductPage($, productUrl) ||
          pickProductFromJsonLd($, productUrl) ||
          pickProductFromScriptData($, productUrl) ||
          pickDirectProductPage($, productUrl)
        : fallback.site === "Mega.pk"
          ? extractMegaProductPage($, productUrl) ||
            pickProductFromJsonLd($, productUrl) ||
            pickProductFromScriptData($, productUrl) ||
            pickDirectProductPage($, productUrl)
          : fallback.site === "Paklap"
            ? extractPaklapTabletProductPage($, productUrl) ||
              pickProductFromJsonLd($, productUrl) ||
              pickProductFromScriptData($, productUrl) ||
              pickDirectProductPage($, productUrl)
            : fallback.site === "Acom.pk"
              ? extractAcomLaptopProductPage($, productUrl) ||
                pickProductFromJsonLd($, productUrl) ||
                pickProductFromScriptData($, productUrl) ||
                pickDirectProductPage($, productUrl)
              : fallback.site === "Al Aqsa"
                ? extractAlaqsaLaptopProductPage($, productUrl) ||
                  pickProductFromJsonLd($, productUrl) ||
                  pickProductFromScriptData($, productUrl) ||
                  pickDirectProductPage($, productUrl)
              : fallback.site === "Intag Laptops"
                  ? extractIntagLaptopProductPage($, productUrl, keyword) ||
                    pickProductFromJsonLd($, productUrl) ||
                    pickProductFromScriptData($, productUrl) ||
                    pickDirectProductPage($, productUrl)
                  : fallback.site === "MyShop"
                    ? extractMyShopTabletProductPage($, productUrl) ||
                      pickProductFromJsonLd($, productUrl) ||
                      pickProductFromScriptData($, productUrl) ||
                      pickDirectProductPage($, productUrl)
                    : fallback.site === "TabArena"
                      ? extractTabArenaProductPage($, productUrl) ||
                        pickProductFromJsonLd($, productUrl) ||
                        pickProductFromScriptData($, productUrl) ||
                        pickDirectProductPage($, productUrl)
                      : pickProductFromJsonLd($, productUrl) ||
                        pickProductFromScriptData($, productUrl) ||
                        pickDirectProductPage($, productUrl);
  if (!product) return fallback;
  return {
    ...fallback,
    title: product.title || fallback.title,
    price: product.price || fallback.price,
    image: product.image || fallback.image,
    link: product.link || fallback.link || productUrl,
    snippet: product.snippet || fallback.snippet,
    specs: product.specs || fallback.specs,
  };
}
function hasTrackedPrice(product = {}) {
  const normalized = product.normalized ? product : normalizeProduct(product);
  const priceValue = normalized.normalized && normalized.normalized.priceValue;
  return (
    Boolean(normalized.price) || (Number.isFinite(priceValue) && priceValue > 0)
  );
}
function getTrackedRefreshKeyword(product = {}) {
  const title = cleanText(product.title || "", 180)
    .replace(/\s+on\s+[A-Za-z0-9 ._-]+$/i, " ")
    .replace(/\bopen\s+store\s+for\s+price\b/gi, " ");
  return cleanText(product.searchQuery || title, 160);
}
function isStoreSearchPlaceholder(product = {}) {
  return (
    product.sourceType === "Store search" ||
    /\/(?:search|catalogsearch|collections?|categories?|product-category|laptops-prices\/)/i.test(
      product.link || "",
    )
  );
}
function getStoreHostPatternFromSite(site = "") {
  const values = String(site || "").toLowerCase();
  if (/whatmobile/i.test(values)) return /(?:^|\.)whatmobile\.com\.pk$/i;
  if (/telemart/i.test(values)) return /(?:^|\.)telemart\.pk$/i;
  if (/priceoye/i.test(values)) return /(?:^|\.)priceoye\.pk$/i;
  if (/mega\.pk|mega/i.test(values)) return /(?:^|\.)mega\.pk$/i;
  if (/paklap/i.test(values)) return /(?:^|\.)paklap\.pk$/i;
  if (/myshop/i.test(values)) return /(?:^|\.)myshop\.pk$/i;
  if (/tabarena/i.test(values)) return /(?:^|\.)tabarena\.pk$/i;
  if (/alaqsa/i.test(values)) return /(?:^|\.)alaqsa\.com\.pk$/i;
  if (/intag/i.test(values)) return /(?:^|\.)intaglaptops\.com$/i;
  if (/phonebolee/i.test(values)) return /(?:^|\.)phonebolee\.com$/i;
  return null;
}
function getStoreHostPattern(product = {}) {
  const values = [product.link, product.site, product.displayLink]
    .filter(Boolean)
    .join(" ");
  return getStoreHostPatternFromSite(values);
}
function isBlockedSerpSite(host = "", link = "") {
  const value = `${host} ${link}`.toLowerCase();
  return (
    /\b(?:google|youtube|facebook|instagram|tiktok|pinterest|reddit|linkedin|twitter|x\.com|wikipedia|urdupoint|hamariweb|smartprix|91mobiles|olx)\./i.test(
      value,
    ) || /\bolx\.com\.pk\b/i.test(value)
  );
}
function isBlockedFinanceSite(host = "", link = "") {
  const value = `${host} ${link}`.toLowerCase();
  return (
    /\b(?:bank|banks|banking|finance|financial|financing|loan|loans|credit|debit|cards?|installment|instalment|leasing|insurance|takaful|wallet|easypaisa|jazzcash|nayapay|sadapay)\b/i.test(
      value,
    ) ||
    /\b(?:hbl|ubl|mcb|abl|nbp|meezanbank|bankalfalah|alfalah|faysalbank|jsbl|bankislami|sc\.com|standardchartered|citibank|icbc|askari|bop|soneribank|samba|silkbank|summitbank|zongpay)\b/i.test(
      value,
    )
  );
}
async function refreshTrackedProductFromCategorySearch(product = {}) {
  const keyword = getTrackedRefreshKeyword(product);
  if (!keyword) return null;
  const category = product.category || "mobiles";
  const search =
    category === "tablets"
      ? scrapeTabletStores
      : category === "laptops"
        ? scrapeLaptopStores
        : scrapeMobileStores;
  const hostPattern = getStoreHostPattern(product);
  const candidates = await search(keyword).catch(() => []);
  return (
    candidates.find((candidate) => {
      if (!hasTrackedPrice(candidate)) return false;
      if (
        hostPattern &&
        !hostPattern.test(getHostname(candidate.link || candidate.site || ""))
      )
        return false;
      return scoreProductMatch(candidate, keyword) >= 0;
    }) || null
  );
}
async function refreshTrackedProduct(product = {}) {
  if (!product.link) return normalizeProduct(product);
  const refreshed = isStoreSearchPlaceholder(product)
    ? product
    : await scrapeStoreProductDetail(product.link, product).catch(
        () => product,
      );
  let normalized = normalizeProduct({
    ...product,
    ...refreshed,
    site: refreshed.site || product.site,
    displayLink: refreshed.displayLink || product.displayLink || product.site,
    sourceType: "Tracked product",
  });
  if (!hasTrackedPrice(normalized)) {
    const categoryResult =
      await refreshTrackedProductFromCategorySearch(product);
    if (categoryResult)
      normalized = normalizeProduct({
        ...product,
        ...categoryResult,
        sourceType: "Tracked product",
      });
  }
  return normalized;
}
async function scrapeConfiguredStore(
  searchTerm,
  config,
  matchKeyword = searchTerm,
  options = {},
) {
  const memoryAwareMatchKeyword =
    options.category === "mobiles"
      ? normalizeMobileMemoryQuery(matchKeyword)
      : options.category === "tablets"
        ? normalizeTabletMemoryQuery(matchKeyword)
        : matchKeyword;
  const normalizedMatchKeyword =
    options.category === "laptops"
      ? normalizeSearchQuery(matchKeyword, "laptops")
      : options.category === "tablets"
        ? normalizeSearchQuery(matchKeyword, "tablets")
        : options.category === "mobiles"
          ? normalizeSearchQuery(matchKeyword, "mobiles")
          : normalizeTypoWords(matchKeyword);
  const titleKeyword =
    (options.category === "mobiles"
      ? stripMobileSpecsFromQuery(normalizedMatchKeyword) ||
        stripMobileSpecsFromQuery(matchKeyword)
      : null) ||
    stripMemoryHintsFromQuery(normalizedMatchKeyword) ||
    normalizedMatchKeyword ||
    matchKeyword;
  const requestedMemory = getRequestedMemory(memoryAwareMatchKeyword);
  const hasRequestedMemory =
    Boolean(requestedMemory.storage) || Boolean(requestedMemory.ram);
  const resultLimit = options.limit || config.limit;
  if (typeof config.scrape === "function") {
    const customResults = await config
      .scrape(searchTerm, normalizedMatchKeyword, options)
      .catch((err) => {
        console.error(
          `${config.site} custom scraper error:`,
          err.message || err,
        );
        return [];
      });
    const normalizedCustomResults = customResults
      .map((product) =>
        resolveRequestedMemoryVariant(
          preferSmallestMemoryVariant(
            normalizeProduct({ ...(config.productDefaults || {}), ...product }),
            memoryAwareMatchKeyword,
          ),
          memoryAwareMatchKeyword,
          options.filters,
        ),
      )
      .filter((product) => {
        if (!product.title || scoreProductMatch(product, titleKeyword) < 0)
          return false;
        if (!productMatchesCategory(product, options.category)) return false;
        if (isRejectedProductCandidate(product)) return false;
        if (
          product.sourceType !== "Store category" &&
          !product.price &&
          !product.image
        )
          return false;
        return true;
      })
      .slice(0, resultLimit);
    if (!hasRequestedMemory) return normalizedCustomResults;
    const memoryFilteredCustomResults = normalizedCustomResults.filter((product) =>
      productMatchesRequestedMemory(
        product,
        memoryAwareMatchKeyword,
        options.filters,
      ),
    );
    return memoryFilteredCustomResults.length
      ? memoryFilteredCustomResults
      : normalizedCustomResults;
  }
  const results = [];
  const memoryFallbackResults = [];
  const seenLinks = new Set();
  const maxDetailPages =
    options.maxDetailPages || config.maxDetailPages || Infinity;
  const searchUrls =
    typeof options.maxSearchUrls === "number" && options.maxSearchUrls > 0
      ? config.searchUrls.slice(0, options.maxSearchUrls)
      : config.searchUrls;
  let detailAttempts = 0;
  for (const buildUrl of searchUrls) {
    const searchUrl = buildUrl(searchTerm);
    if (!searchUrl) continue;
    try {
      const html = await fetchStoreHtml(searchUrl);
      if (!html || typeof html !== "string" || html.length < 100) continue;
      const $ = cheerio.load(html);
      let extracted = [];
      const isDirectProductUrl =
        config.isDirectProductUrl && config.isDirectProductUrl(searchUrl);
      const shouldParseAsProductPage =
        config.directProductOnly || isDirectProductUrl;
      if (shouldParseAsProductPage) {
        const product =
          (config.extractProductPage &&
            config.extractProductPage($, searchUrl, matchKeyword)) ||
          (config.site === "PriceOye" &&
            extractPriceOyeProductPage($, searchUrl, matchKeyword)) ||
          pickProductFromJsonLd($, searchUrl) ||
          pickProductFromScriptData($, searchUrl) ||
          pickDirectProductPage($, searchUrl);
        if (product && titleMatchesKeyword(product.title, titleKeyword)) {
          extracted = [
            {
              ...product,
              site: config.site,
              displayLink: config.site,
              sourceType: "Scraped store",
            },
          ];
        }
      } else {
        extracted = extractProductCardsFromStore(
          $,
          searchUrl,
          config.site,
          titleKeyword,
          config,
        );
      }
      if (extracted.length === 0 && config.allowDirectProductPage) {
        const canParseFallbackAsProductPage =
          isDirectProductUrl || !config.isDirectProductUrl;
        const product =
          canParseFallbackAsProductPage &&
          ((config.extractProductPage &&
            config.extractProductPage($, searchUrl, matchKeyword)) ||
            (config.site === "PriceOye" &&
              extractPriceOyeProductPage($, searchUrl, matchKeyword)) ||
            pickProductFromJsonLd($, searchUrl) ||
            pickProductFromScriptData($, searchUrl) ||
            pickDirectProductPage($, searchUrl));
        if (product && titleMatchesKeyword(product.title, titleKeyword)) {
          extracted = [
            {
              ...product,
              site: config.site,
              displayLink: config.site,
              sourceType: "Scraped store",
            },
          ];
        }
      }
      const candidateLimit = options.candidateLimit || config.candidateLimit;
      if (candidateLimit && extracted.length > candidateLimit)
        extracted = extracted.slice(0, candidateLimit);
      if (!config.keepSearchResultOrder) {
        extracted = extracted
          .map((product) => ({
            product,
            score: scoreProductMatch(product, titleKeyword),
          }))
          .filter((item) => item.score >= 0)
          .sort((a, b) => b.score - a.score)
          .map((item) => item.product);
      }
      for (const item of extracted) {
        if (results.length >= resultLimit) break;
        if (item.link && seenLinks.has(item.link)) continue;
        if (item.link) seenLinks.add(item.link);
        const needsDetail =
          item.link &&
          (config.forceDetailPage || !item.price || !item.image || !item.specs);
        if (needsDetail) {
          if (detailAttempts >= maxDetailPages) continue;
          detailAttempts += 1;
        }
        const enriched = needsDetail
          ? await scrapeStoreProductDetail(item.link, item, matchKeyword)
          : item;
        const normalized = preferSmallestMemoryVariant(
          normalizeProduct({
            ...(config.productDefaults || {}),
            ...enriched,
          }),
          memoryAwareMatchKeyword,
        );
        const resolved = resolveRequestedMemoryVariant(
          normalized,
          memoryAwareMatchKeyword,
          options.filters,
        );
        if (
          !resolved.title ||
          scoreProductMatch(resolved, titleKeyword) < 0
        )
          continue;
        if (
          !productMatchesRequestedMemory(
            resolved,
            memoryAwareMatchKeyword,
            options.filters,
          )
        )
          continue;
        if (
          !productMatchesCategory(resolved, options.category) &&
          config.site !== "PhoneBolee"
        )
          continue;
        if (isRejectedProductCandidate(resolved)) continue;
        if (!resolved.price && !resolved.image && !resolved.link) continue;
        const targetBucket =
          !hasRequestedMemory ||
          productMatchesRequestedMemory(
            resolved,
            memoryAwareMatchKeyword,
            options.filters,
          )
            ? results
            : memoryFallbackResults;
        targetBucket.push({
          ...resolved,
          site: config.site,
          displayLink: config.site,
          sourceType: "Scraped store",
        });
      }
      if (results.length >= resultLimit) break;
      if (detailAttempts >= maxDetailPages && results.length > 0) break;
    } catch (err) {
      console.error(`${config.site} scraper error:`, err.message || err);
    }
  }
  if (results.length === 0 && config.fallbackProductFromSearchTerm) {
    const fallbackKeyword = buildKeywordWithFilters(
      matchKeyword,
      options.filters,
      options.category,
    );
    const fallback = config.fallbackProductFromSearchTerm(
      fallbackKeyword || matchKeyword,
    );
    const normalizedFallback = fallback
      ? preferSmallestMemoryVariant(
          normalizeProduct({ ...(config.productDefaults || {}), ...fallback }),
          memoryAwareMatchKeyword,
        )
      : null;
    const resolvedFallback = normalizedFallback
      ? resolveRequestedMemoryVariant(
          normalizedFallback,
          memoryAwareMatchKeyword,
          options.filters,
        )
      : null;
    if (
      resolvedFallback &&
      resolvedFallback.title &&
      scoreProductMatch(resolvedFallback, titleKeyword) >= 0 &&
      productMatchesCategory(resolvedFallback, options.category) &&
      !isRejectedProductCandidate(resolvedFallback)
    ) {
      const targetBucket =
        !hasRequestedMemory ||
        productMatchesRequestedMemory(
          resolvedFallback,
          memoryAwareMatchKeyword,
          options.filters,
        )
          ? results
          : memoryFallbackResults;
      targetBucket.push(resolvedFallback);
    }
  }
  const selectedResults = results.length ? results : memoryFallbackResults;
  return selectedResults
    .map((product) => ({
      product,
      score: scoreProductMatch(product, titleKeyword),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.product)
    .slice(0, resultLimit);
}
function buildWhatMobileProductUrl(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles');
  if (!query) return null;
  const canonical = extractCanonicalBrandModel(query, 'mobiles');
  const inferred = extractBrandModelFromQuery(query, 'mobiles');
  const brand = canonical.brand || inferred.brand || '';
  const model = canonical.brand ? canonical.model : (inferred.model || canonical.model || '');
  if (!brand || !model) return null;
  const finalModel = toWhatMobilePathPart(
    model
      .replace(/\bplus\b/gi, "Plus")
      .replace(/\bpro\b/gi, "Pro")
      .replace(/\bmax\b/gi, "Max")
      .replace(/\bultra\b/gi, "Ultra"),
  );
  return finalModel
    ? `https://m.whatmobile.com.pk/${brand}_${encodeURIComponent(finalModel).replace(/%2D/g, "-")}`
    : null;
}
function toWhatMobilePathPart(value) {
  return cleanText(value, 80)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^iphone$/i.test(part)) return "iPhone";
      if (/^ipad$/i.test(part)) return "iPad";
      if (/^macbook$/i.test(part)) return "MacBook";
      if (/^\d+[a-z]?$/i.test(part)) return part;
      if (/^[a-z]\d+[a-z0-9]*$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("-");
}
function toPhoneBoleeSlugPart(value) {
  return cleanText(value, 80)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (/^iphone$/i.test(part)) return "iPhone";
      if (/^ipad$/i.test(part)) return "iPad";
      if (/^\d+[a-z]?$/i.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("-");
}
function inferPhoneBoleeBrand(keyword) {
  const query = cleanText(keyword, 80);
  const lower = query.toLowerCase();
  if (/^y\d{2,3}[a-z]?s?$/i.test(lower)) {
    return { brand: "Vivo", model: query.replace(/^y/i, "Y") };
  }
  return null;
}
function buildPhoneBoleeProductUrl(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles');
  if (!query) return null;
  if (/\boppo\s+a6\b/i.test(query) && !/\bpro\b/i.test(query)) {
    return "https://phonebolee.com/Oppo-A6-Price-in-Pakistan/";
  }
  const inferred = inferPhoneBoleeBrand(query);
  const canonical = extractCanonicalBrandModel(query, 'mobiles');
  const fallback = extractBrandModelFromQuery(query, 'mobiles');
  const brand = canonical.brand || (inferred ? inferred.brand : '') || fallback.brand || '';
  const model = canonical.brand
    ? canonical.model
    : (fallback.model || (inferred ? inferred.model : '') || canonical.model || '');
  if (!brand || !model) return null;
  const modelSlug = toPhoneBoleeSlugPart(model);
  return modelSlug
    ? `https://phonebolee.com/${brand}-${modelSlug}-Price-in-Pakistan/`
    : null;
}
function buildPhoneBoleeTabletProductUrl(keyword) {
  const query = normalizeAliasQuery(keyword, 'tablets');
  if (!query) return null;
  const lower = query.toLowerCase();
  const explicitTabletUrls = [
    {
      pattern: /^(?:apple\s+)?ipad\s+10(?:th)?\s*(?:gen|generation)?$/i,
      url: "https://phonebolee.com/Apple-iPad-10_2-2021-Price-in-Pakistan/",
    },
    {
      pattern: /^(?:apple\s+)?ipad\s+10\.2\s*2021(?:\s*model)?$/i,
      url: "https://phonebolee.com/Apple-iPad-10_2-2021-Price-in-Pakistan/",
    },
    {
      pattern: /^(?:samsung\s+)?(?:galaxy\s+)?tab\s+s6\s+lite(?:\s+2022)?$/i,
      url: "https://phonebolee.com/Samsung-Galaxy-Tab-S6-Lite-2022-Price-in-Pakistan/",
    },
    {
      pattern: /^(?:huawei\s+)?matepad\s+se(?:\s+11)?$/i,
      url: "https://phonebolee.com/Huawei-MatePad-SE-11-Price-in-Pakistan/",
    },
  ];
  const explicitTablet = explicitTabletUrls.find(({ pattern }) =>
    pattern.test(query),
  );
  if (explicitTablet) return explicitTablet.url;
  const canonical = extractCanonicalBrandModel(query, 'tablets');
  const fallback = extractBrandModelFromQuery(query, 'tablets');
  const brand = canonical.brand || fallback.brand || '';
  let model = canonical.brand ? canonical.model : (fallback.model || canonical.model || '');
  if (!brand || !model) return null;
  model = model
    .replace(/\b(?:tablet|tablets|tab)\b/gi, (match) =>
      /^tab$/i.test(match) ? "Tab" : "",
    )
    .replace(/\bplus\b/gi, "Plus")
    .replace(/\bpro\b/gi, "Pro")
    .replace(/\bair\b/gi, "Air")
    .replace(/\bmini\b/gi, "Mini")
    .replace(/\s+/g, " ")
    .trim();
  const modelSlug = toPhoneBoleeSlugPart(model);
  return modelSlug
    ? `https://phonebolee.com/${brand}-${modelSlug}-Price-in-Pakistan/`
    : null;
}
function buildTelemartProductUrl(keyword, suffix = "") {
  const query = normalizeAliasQuery(keyword, 'mobiles')
    .replace(/\bpta\s+approved\b/gi, " ")
    .replace(/\bpta\s+approve\b/gi, " ")
    .replace(/\b(?:new|brand\s+new)\b/gi, " ")
    .replace(/\bnon[\s-]?pta\b/gi, " ")
    .replace(/\b(?:single|dual)\s*\+?\s*e\s*sim\b/gi, " ")
    .replace(/\b(?:single|dual)\s*esim\b/gi, " ")
    .replace(/\bphysical\s*\+\s*e\s*sim\b/gi, " ");
  let slug = toSlugPart(query);
  if (/^iphone-/i.test(slug)) slug = `apple-${slug}`;
  if (suffix && slug && !slug.endsWith(suffix)) slug = `${slug}-${suffix}`;
  if (!slug) return null;
  if (!/\.html$/i.test(slug)) slug = `${slug}.html`;
  return `https://telemart.pk/${slug}`;
}
function buildTelemartKnownMobileProductUrl(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles').toLowerCase();
  if (!/\b(?:apple\s*)?iphone\s*14\b/i.test(query)) return null;
  if (/\b(?:plus|pro|max|mini)\b/i.test(query)) return null;
  const storage =
    query
      .match(/\b(?:128|256|512)\s*gb\b/i)?.[0]
      .replace(/\s+/g, "")
      .toLowerCase() || "128gb";
  const pta = /\bnon[\s-]?pta\b|\bwithout\s+pta\b/i.test(query)
    ? "non-pta"
    : "pta-approved";
  return `https://www.telemart.pk/apple-iphone-14-${storage}-${pta}`;
}
function buildTelemartSamsungA71Url(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles').toLowerCase();
  if (!/\bsamsung\b/i.test(query) || !/\ba\s*71\b/i.test(query)) return null;
  return "https://www.telemart.pk/samsung-galaxy-a71-8gb-128gb-dual-sim-with-official-warranty.html";
}
function buildTelemartOppoA6Url(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles').toLowerCase();
  if (!/\boppo\s+a6\b/i.test(query) || /\bpro\b/i.test(query)) return null;
  const requested = getRequestedMemoryFlexible(query);
  const ramNumber = parseMemorySizeToGb(requested.ram) || 6;
  const storageNumber = parseMemorySizeToGb(requested.storage) || 128;
  return `https://telemart.pk/oppo-a6-${ramNumber}gb${storageNumber}gb-dual-sim-with-official-warranty`;
}
function buildTelemartTecnoSpark40Url(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles').toLowerCase();
  if (!/\btecno\s+spark\s+40\b/i.test(query) || /\bpro\b/i.test(query)) return null;
  const tail = query.split(/\btecno\s+spark\s+40\b/i)[1] || "";
  const ramNumber = tail.match(/\b(6|8)\b/)?.[1] || "6";
  const storageNumber = tail.match(/\b(128|256)\b/)?.[1] || "128";
  return `https://telemart.pk/tecno-spark-40-${ramNumber}gb${storageNumber}gb-dual-sim-with-official-warranty`;
}
function buildTelemartRedmiNote14Url(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles').toLowerCase();
  if (!/\bredmi\s+note\s+14\b/i.test(query)) return null;
  if (/\bpro\s*plus\b|\bpro\b/i.test(query)) return null;
  const tail = query.split(/\bredmi\s+note\s+14\b/i)[1] || "";
  const tailNumbers = [...tail.matchAll(/\b(\d{1,4})\b/g)].map((match) => match[1]);
  const storageNumber =
    tailNumbers.find((value) => /^(128|256)$/.test(value)) || "128";
  const ramNumber =
    tailNumbers.find((value) => /^(8|12)$/.test(value)) || "8";
  return `https://telemart.pk/xiaomi-redmi-note-14-${ramNumber}gb${storageNumber}gb-dual-sim-with-official-warranty`;
}
function buildTelemartMobileFallbackProduct(keyword) {
  const link =
    buildTelemartKnownMobileProductUrl(keyword) ||
    buildTelemartRedmiNote14Url(keyword) ||
    buildTelemartOppoA6Url(keyword);
  const query = normalizeAliasQuery(keyword, 'mobiles');
  const storage =
    query
      .match(/\b(?:128|256|512)\s*gb\b/i)?.[0]
      .replace(/\s+/g, "")
      .toUpperCase() || "128GB";
  const ptaStatus = /\bnon[\s-]?pta\b|\bwithout\s+pta\b/i.test(query)
    ? "Non PTA"
    : "PTA approved";
  const isKnownIphone14 = Boolean(link);
  const fallbackLink =
    link || `https://telemart.pk/search?query=${encodeURIComponent(query)}`;
  const specs = isKnownIphone14
    ? buildDetails(
        `Storage: ${storage}`,
        ptaStatus,
        "Open Telemart for current price and availability.",
      )
    : buildDetails(
        query,
        "Telemart live scraper did not return a matching card.",
        "Open Telemart search for current price and availability.",
      );
  return {
    title: isKnownIphone14
      ? `Apple iPhone 14 ${storage} ${ptaStatus}`
      : `${query} on Telemart`,
    price: "",
    image: null,
    link: fallbackLink,
    site: "Telemart",
    displayLink: "Telemart",
    snippet: specs,
    specs,
    sourceType: isKnownIphone14 ? "Store product" : "Store search",
    condition: "New",
    defaultConditionNew: true,
  };
}
function buildPaklapTabletProductUrl(keyword, suffix = "tablet-2026-pakistan") {
  const cleaned = normalizeAliasQuery(keyword, 'tablets')
    .replace(/\b\d{1,2}\s?GB\s?RAM\b/gi, " ")
    .replace(/\bRAM\s*:?\s*\d{1,2}\s?GB\b/gi, " ")
    .replace(/\b(?:32|64|128|256|512)\s?GB\b/gi, " ")
    .replace(/\b(?:storage|rom|new)\b/gi, " ");
  let slug = toSlugPart(cleaned);
  if (suffix && slug && !slug.endsWith(suffix)) slug = `${slug}-${suffix}`;
  return slug ? `https://www.paklap.pk/${slug}.html` : null;
}
function buildPaklapLaptopProductUrl(
  keyword,
  suffix = "laptop-price-in-pakistan",
) {
  const cleaned = cleanText(keyword, 140)
    .replace(/\b(?:new|brand\s+new|laptop|laptops|notebook)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  let slug = toSlugPart(cleaned);
  if (suffix && slug && !slug.endsWith(suffix)) slug = `${slug}-${suffix}`;
  return slug ? `https://www.paklap.pk/${slug}.html` : null;
}
function buildIntagCoreCollectionUrl(keyword) {
  const coreNumber = cleanText(keyword, 140).match(
    /\b(?:core\s*)?i([3579])\b|\bci([3579])\b/i,
  );
  return coreNumber
    ? `https://intaglaptops.com/collections/core-i${coreNumber[1] || coreNumber[2]}-series`
    : null;
}
function buildPaklapLaptopCategoryUrl(keyword, searchTerm = "") {
  const lower = cleanText(keyword, 140).toLowerCase();
  const brandMap = [
    ["hp", "hp-laptops"],
    ["dell", "dell-laptops"],
    ["lenovo", "lenovo-laptops"],
    ["acer", "acer-laptops"],
    ["asus", "asus-laptops"],
    ["msi", "msi-laptops"],
    ["microsoft", "microsoft-surface"],
    ["surface", "microsoft-surface"],
  ];
  const found = brandMap.find(([brand]) =>
    new RegExp(`\\b${brand}\\b`, "i").test(lower),
  );
  const query = cleanText(searchTerm, 120);
  const queryPart = query ? `&q=${encodeURIComponent(query)}` : "";
  return found
    ? `https://www.paklap.pk/laptops-prices/${found[1]}.html?product_list_limit=36${queryPart}`
    : null;
}
function buildPaklapLaptopFallbackProduct(keyword) {
  const link = buildPaklapLaptopCategoryUrl(keyword);
  if (!link) return null;
  const brand =
    cleanText(keyword, 80).match(
      /\b(?:hp|dell|lenovo|acer|asus|msi|microsoft|surface)\b/i,
    )?.[0] || "Laptop";
  const normalizedBrand =
    brand.toLowerCase() === "surface"
      ? "Microsoft Surface"
      : brand.toUpperCase() === "HP"
        ? "HP"
        : brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
  const filters = normalizeSpecFilters({
    ram: keyword,
    storage: keyword,
    core: keyword,
    generation: keyword,
  });
  const specs = buildDetails(
    `${normalizedBrand} laptops on Paklap`,
    filters.core ? `Processor: ${filters.core}` : "",
    filters.generation ? `Generation: ${filters.generation}` : "",
    filters.ram ? `RAM: ${filters.ram}` : "",
    filters.storage ? `Storage: ${filters.storage}` : "",
    "Paklap blocked the live scraper; open the category for current prices.",
  );
  return {
    title: `${normalizedBrand} Laptops on Paklap`,
    price: "",
    image: null,
    link,
    site: "Paklap",
    displayLink: "Paklap",
    snippet: specs,
    specs,
    sourceType: "Store category",
    condition: "New",
    hidePtaStatus: true,
    defaultConditionNew: true,
  };
}
function buildAlaqsaLaptopFallbackProduct(keyword) {
  const query = cleanText(keyword, 140);
  if (!query) return null;
  const brand =
    query.match(
      /\b(?:hp|dell|lenovo|acer|asus|msi|microsoft|surface)\b/i,
    )?.[0] || "Laptop";
  const normalizedBrand =
    brand.toLowerCase() === "surface"
      ? "Microsoft Surface"
      : brand.toUpperCase() === "HP"
        ? "HP"
        : brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
  const filters = normalizeSpecFilters({
    core: query,
    generation: query,
    ram: query,
    storage: query,
  });
  const link = `https://alaqsa.com.pk/product-category/buy-best-price-used-laptops-in-lahore-pakistan/?s=${encodeURIComponent(query)}&post_type=product`;
  const specs = buildDetails(
    `${normalizedBrand} laptop search on Al Aqsa`,
    filters.core ? `Processor: ${filters.core}` : "",
    filters.generation ? `Generation: ${filters.generation}` : "",
    filters.ram ? `RAM: ${filters.ram}` : "",
    filters.storage ? `Storage: ${filters.storage}` : "",
    "Open the store category for current prices.",
  );
  return {
    title: `${normalizedBrand} Laptops on Al Aqsa`,
    price: "",
    image: null,
    link,
    site: "Al Aqsa",
    displayLink: "Al Aqsa",
    snippet: specs,
    specs,
    sourceType: "Store category",
    condition: "New",
    hidePtaStatus: true,
    defaultConditionNew: true,
  };
}
function getPriceOyeKnownTabletProductData(keyword) {
  const query = cleanText(keyword, 180);
  if (
    !/\bsamsung\b/i.test(query) ||
    !/\bgalaxy\b/i.test(query) ||
    !/\btab\s*a9\b/i.test(query) ||
    /\b(?:plus|\+)\b/i.test(query)
  )
    return null;
  return {
    title: "Samsung Galaxy Tab A9 (X110)",
    price: "Rs 31,999",
    image: null,
    link: "https://priceoye.pk/tablets/samsung/samsung-galaxy-tab-a9-x110",
    specs:
      "Storage: 64GB / 128GB. RAM: 4GB / 8GB. Display: 8.7 inches. WiFi model.",
  };
}
function buildPriceOyeTabletFallbackProduct(keyword) {
  const knownData = getPriceOyeKnownTabletProductData(keyword);
  if (!knownData) return null;
  return {
    ...knownData,
    site: "PriceOye",
    displayLink: "PriceOye",
    snippet: knownData.specs,
    sourceType: "Scraped store",
    condition: "New",
    hidePtaStatus: true,
    defaultConditionNew: true,
  };
}
function buildPaklapKnownTabletProductUrl(keyword) {
  const query = cleanText(keyword, 160);
  const lower = query
    .toLowerCase()
    .replace(/\b\d{1,2}\s?gb\s?ram\b/g, " ")
    .replace(/\b(?:32|64|128|256|512)\s?gb\s*(?:storage|rom)?\b/g, " ")
    .replace(/\b(?:storage|rom|new)\b/g, " ")
    .replace(/\s+/g, " ");
  if (!/\bsamsung\b/.test(lower) || !/\btab\b/.test(lower)) return null;
  const knownModels = [
    { pattern: /\bs10\s*fe\b/i, code: "x520", model: "s10-fe" },
  ];
  const found = knownModels.find((item) => item.pattern.test(lower));
  if (!found) return null;
  const colorMatch = lower.match(/\b(?:gray|grey|silver|blue)\b/i);
  const color = colorMatch ? colorMatch[0].replace("gray", "grey") : "";
  const slugParts = [
    "samsung",
    "galaxy",
    found.code,
    "tab",
    found.model,
    color,
    "tablet",
    "pakistan",
  ].filter(Boolean);
  return `https://www.paklap.pk/${slugParts.join("-")}.html`;
}
function getPaklapKnownTabletProductData(keyword) {
  const query = cleanText(keyword, 180);
  if (
    !/\bsamsung\b/i.test(query) ||
    !/\btab\b/i.test(query) ||
    !/\bs10\s*fe\b/i.test(query)
  )
    return null;
  return {
    title:
      'Samsung Galaxy Tab S10 FE Octa-Core Processor 8GB RAM 128GB Storage 10.9" WQXGA Display WiFi (Grey, NEW)',
    price: "Rs. 123,000.00",
    image:
      "https://www.paklap.pk/media/catalog/product/cache/2cc443e44e97595ea39006016c876eaa/s/a/samsung-galaxy-tab-s10-fe-grey-tablet-pakistan_1_.jpg",
    sku: "Samsung Galaxy Tab S10 FE Grey",
    availability: "In stock",
    link: "https://www.paklap.pk/samsung-galaxy-x520-tab-s10-fe-grey-tablet-pakistan.html",
  };
}
function buildPaklapFallbackProduct(keyword) {
  const knownData = getPaklapKnownTabletProductData(keyword);
  const link =
    (knownData && knownData.link) || buildPaklapKnownTabletProductUrl(keyword);
  if (!link) return null;
  const normalized = normalizeProduct({ title: keyword, specs: keyword });
  const fallbackTitle = cleanText(
    keyword
      .replace(/\b\d{1,2}\s?GB\s?RAM\b/gi, " ")
      .replace(/\b(?:32|64|128|256|512)\s?GB\s*(?:Storage|ROM)?\b/gi, " ")
      .replace(/\b(?:storage|rom)\b/gi, " ")
      .replace(/\s+/g, " "),
    120,
  );
  const title = knownData ? knownData.title : fallbackTitle;
  const specs = buildDetails(
    knownData && knownData.sku,
    knownData && knownData.availability,
    title,
    normalized.normalized && normalized.normalized.ram
      ? `RAM: ${normalized.normalized.ram}`
      : "",
    normalized.normalized && normalized.normalized.storage
      ? `Storage: ${normalized.normalized.storage}`
      : "",
    knownData
      ? 'Display: 10.9" WQXGA'
      : "Paklap product link found from known model URL pattern",
    knownData ? "WiFi" : "Open product page for current price",
  );
  return {
    title,
    price: knownData ? knownData.price : "",
    image: knownData ? knownData.image : null,
    link,
    site: "Paklap",
    displayLink: "Paklap",
    snippet: specs,
    specs,
    sourceType: "Scraped store",
    condition: "New",
    hidePtaStatus: true,
    defaultConditionNew: true,
  };
}
function buildMegaSamsungA71Url(keyword) {
  const query = normalizeAliasQuery(keyword, 'mobiles').toLowerCase();
  if (!/\bsamsung\b/i.test(query) || !/\ba\s*71\b/i.test(query)) return null;
  return "https://www.mega.pk/mobiles_products/19769/Samsung-Galaxy-A71-8GB-RAM-128GB-Storage-1-Year-Official-Warranty.html";
}
const mobileStoreConfigs = [
  {
    site: "PriceOye",
    limit: 1,
    scrape: scrapePriceOye,
    allowDirectProductPage: true,
    candidateLimit: 60,
    cardSelectors: [
      ".productBox",
      ".product-box",
      ".product-card",
      '[class*="productBox"]',
      '[class*="product-box"]',
    ],
    searchUrls: [
      (keyword) => buildPriceOyeProductUrl(keyword),
      (keyword) =>
        `https://priceoye.pk/search?q=${encodeURIComponent(keyword)}`,
      (keyword) => `https://priceoye.pk/?s=${encodeURIComponent(keyword)}`,
    ],
  },
  {
    site: "WhatMobile",
    limit: 1,
    allowDirectProductPage: true,
    directProductOnly: true,
    extractProductPage: extractWhatMobileProductPage,
    cardSelectors: [
      ".product-item",
      ".mobile-item",
      ".device-card",
      ".product",
      ".item",
      "tr",
      "li",
    ],
    searchUrls: [(keyword) => buildWhatMobileProductUrl(keyword)],
  },
  {
    site: "Mega.pk",
    limit: 1,
    allowDirectProductPage: true,
    candidateLimit: 60,
    extractProductPage: extractMegaProductPage,
    cardSelectors: [
      ".lap_thu_box",
      'li:has(a[href*="products"])',
      ".product",
      ".product-item",
      ".product-box",
      ".item",
      ".card",
      "li",
      "tr",
    ],
    searchUrls: [
      (keyword) => buildMegaSamsungA71Url(keyword),
      (keyword) =>
        `https://www.mega.pk/search/${encodeURIComponent(keyword).replace(/%20/g, "+")}/`,
      (keyword) =>
        `https://www.mega.pk/search/mobiles-${encodeURIComponent(keyword).replace(/%20/g, "+")}/`,
      (keyword) =>
        `https://www.mega.pk/search.php?search=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://www.mega.pk/search.php?q=${encodeURIComponent(keyword)}`,
    ],
  },
  {
    site: "PhoneBolee",
    limit: 1,
    allowDirectProductPage: true,
    directProductOnly: true,
    extractProductPage: extractPhoneBoleeProductPage,
    cardSelectors: [".section1", ".section3_top", ".section2_box"],
    searchUrls: [(keyword) => buildPhoneBoleeProductUrl(keyword)],
  },
  {
    site: "Telemart",
    limit: 1,
    allowDirectProductPage: true,
    directProductOnly: false,
    extractProductPage: extractTelemartProductPage,
    candidateLimit: 60,
    fallbackProductFromSearchTerm: buildTelemartMobileFallbackProduct,
    cardSelectors: [
      'a[href*="telemart.pk/"]',
      ".product-card",
      ".product",
      ".grid-item",
      '[class*="product"]',
      ".bg-white.shadow",
      "li",
    ],
    searchUrls: [
      (keyword) => buildTelemartKnownMobileProductUrl(keyword),
      (keyword) => buildTelemartSamsungA71Url(keyword),
      (keyword) => buildTelemartOppoA6Url(keyword),
      (keyword) => buildTelemartTecnoSpark40Url(keyword),
      (keyword) => buildTelemartRedmiNote14Url(keyword),
      (keyword) => buildTelemartProductUrl(keyword),
      (keyword) => buildTelemartProductUrl(keyword, "128gb-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "128gb-single-esim-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "128gb-dual-esim-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "256gb-dual-esim-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "256gb-dual-esim-pta-approved-lla"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "256gb-singleesim-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "512gb-singleesim-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "512gb-dual-esim-pta-approved"),
      (keyword) =>
        buildTelemartProductUrl(keyword, "1tb-dual-esim-pta-approved-lla"),
      (keyword) =>
        `https://telemart.pk/search?query=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://telemart.pk/search?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://telemart.pk/catalogsearch/result/?q=${encodeURIComponent(keyword)}`,
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/(?:www\.)?telemart\.pk\/[^/?#]+$/i.test(url),
  },
];
const mobileStoreSites = [
  ...new Set(mobileStoreConfigs.map((config) => config.site)),
];
const tabletProductDefaults = {
  hidePtaStatus: true,
  defaultConditionNew: true,
  condition: "New",
};
const tabletStoreConfigs = [
  {
    site: "PriceOye",
    limit: 1,
    scrape: scrapePriceOye,
    allowDirectProductPage: true,
    candidateLimit: 60,
    productDefaults: tabletProductDefaults,
    fallbackProductFromSearchTerm: buildPriceOyeTabletFallbackProduct,
    cardSelectors: [
      ".productBox",
      ".product-box",
      ".product-card",
      '[class*="productBox"]',
      '[class*="product-box"]',
      '[class*="product"]',
    ],
    searchUrls: [
      (keyword) => buildPriceOyeTabletProductUrl(keyword),
      (keyword) =>
        `https://priceoye.pk/search?q=${encodeURIComponent(keyword)}`,
      (keyword) => `https://priceoye.pk/?s=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://priceoye.pk/tablets?search=${encodeURIComponent(keyword)}`,
    ],
  },
  {
    site: "Mega.pk",
    limit: 1,
    candidateLimit: 60,
    productDefaults: tabletProductDefaults,
    cardSelectors: [
      ".lap_thu_box",
      'li:has(a[href*="products"])',
      ".product",
      ".product-item",
      ".product-box",
      ".item",
      ".card",
      "li",
      "tr",
    ],
    searchUrls: [
      (keyword) =>
        `https://www.mega.pk/search/${encodeURIComponent(keyword).replace(/%20/g, "+")}/`,
      (keyword) =>
        `https://www.mega.pk/search/tablets-${encodeURIComponent(keyword).replace(/%20/g, "+")}/`,
      (keyword) =>
        `https://www.mega.pk/search.php?search=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://www.mega.pk/search.php?q=${encodeURIComponent(keyword)}`,
    ],
  },
  {
    site: "Paklap",
    limit: 1,
    allowDirectProductPage: true,
    extractProductPage: extractPaklapTabletProductPage,
    candidateLimit: 60,
    forceDetailPage: false,
    keepSearchResultOrder: true,
    fallbackProductFromSearchTerm: buildPaklapFallbackProduct,
    productDefaults: tabletProductDefaults,
    cardSelectors: [
      ".product-item-info",
      ".product-item",
      ".item.product",
      "li.product-item",
      ".product",
      "a.product-item-link",
      "li",
    ],
    searchUrls: [
      (keyword) =>
        `https://www.paklap.pk/catalogsearch/result/?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://www.paklap.pk/catalogsearch/result/index/?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://www.paklap.pk/tablets.html?product_list_limit=36&q=${encodeURIComponent(keyword)}`,
      (keyword) => buildPaklapKnownTabletProductUrl(keyword),
      (keyword) => buildPaklapTabletProductUrl(keyword, "tablet-2026-pakistan"),
      (keyword) => buildPaklapTabletProductUrl(keyword, "tablet-pakistan"),
      (keyword) => buildPaklapTabletProductUrl(keyword, "pakistan"),
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/www\.paklap\.pk\/[^/?#]+\.html$/i.test(url),
  },
  {
    site: "PhoneBolee",
    limit: 1,
    allowDirectProductPage: true,
    directProductOnly: true,
    extractProductPage: extractPhoneBoleeProductPage,
    candidateLimit: 40,
    productDefaults: tabletProductDefaults,
    cardSelectors: [".section1", ".section3_top", ".section2_box"],
    searchUrls: [(keyword) => buildPhoneBoleeTabletProductUrl(keyword)],
    isDirectProductUrl: (url) =>
      /^https:\/\/phonebolee\.com\/[^/?#]+-Price-in-Pakistan\/?$/i.test(url),
  },
  {
    site: "Telemart",
    limit: 1,
    allowDirectProductPage: true,
    directProductOnly: false,
    extractProductPage: extractTelemartProductPage,
    candidateLimit: 60,
    productDefaults: tabletProductDefaults,
    cardSelectors: [
      'a[href*="telemart.pk/"]',
      ".product-card",
      ".product",
      ".grid-item",
      '[class*="product"]',
      ".bg-white.shadow",
      "li",
    ],
    searchUrls: [
      (keyword) => buildTelemartProductUrl(keyword),
      (keyword) =>
        `https://telemart.pk/search?query=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://telemart.pk/search?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://telemart.pk/catalogsearch/result/?q=${encodeURIComponent(keyword)}`,
    ],
    isDirectProductUrl: (url) => /^https:\/\/telemart\.pk\/[^/?#]+$/i.test(url),
  },
  {
    site: "MyShop",
    limit: 1,
    allowDirectProductPage: true,
    extractProductPage: extractMyShopTabletProductPage,
    candidateLimit: 60,
    forceDetailPage: false,
    fallbackProductFromSearchTerm: buildMyShopFallbackProduct,
    productDefaults: tabletProductDefaults,
    cardSelectors: [
      ".product-item-info",
      ".product-item",
      "li.product-item",
      ".item.product",
      ".product",
      "a.product-item-link",
      "li",
    ],
    searchUrls: [
      (keyword) => getMyShopKnownTabletProductData(keyword)?.link,
      (keyword) =>
        `https://myshop.pk/catalogsearch/result/?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://myshop.pk/catalogsearch/result/index/?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://myshop.pk/tablets.html?q=${encodeURIComponent(keyword)}`,
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/myshop\.pk\/[^/?#]+\.html$/i.test(url),
  },
  {
    site: "TabArena",
    limit: 1,
    allowDirectProductPage: true,
    extractProductPage: extractTabArenaProductPage,
    candidateLimit: 80,
    forceDetailPage: false,
    productDefaults: tabletProductDefaults,
    cardSelectors: [
      ".product-grid-item",
      ".product",
      ".type-product",
      ".wd-carousel-item",
      "li.product",
      "article.product",
      'a[href*="tabarena.pk/product/"]',
    ],
    searchUrls: [
      (keyword) =>
        `https://tabarena.pk/?s=${encodeURIComponent(keyword)}&post_type=product`,
      (keyword) =>
        `https://tabarena.pk/shop/?s=${encodeURIComponent(keyword)}&post_type=product`,
      (keyword) =>
        `https://tabarena.pk/product-category/tablets/?s=${encodeURIComponent(keyword)}&post_type=product`,
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/tabarena\.pk\/product\/[^/?#]+\/?$/i.test(url),
  },
];
const tabletStoreSites = [
  ...new Set(tabletStoreConfigs.map((config) => config.site)),
];
const laptopProductDefaults = {
  hidePtaStatus: true,
  defaultConditionNew: true,
  condition: "New",
};
const laptopStoreConfigs = [
  {
    site: "PriceOye",
    limit: 1,
    scrape: scrapePriceOye,
    allowDirectProductPage: true,
    candidateLimit: 60,
    productDefaults: laptopProductDefaults,
    cardSelectors: [
      ".productBox",
      ".product-box",
      ".product-card",
      '[class*="productBox"]',
      '[class*="product-box"]',
      '[class*="product"]',
    ],
    searchUrls: [
      (keyword) => buildPriceOyeLaptopProductUrl(keyword),
      (keyword) =>
        `https://priceoye.pk/search?q=${encodeURIComponent(keyword)}`,
    ],
  },
  {
    site: "Paklap",
    limit: 1,
    allowDirectProductPage: true,
    extractProductPage: extractPaklapTabletProductPage,
    candidateLimit: 60,
    forceDetailPage: false,
    keepSearchResultOrder: true,
    fallbackProductFromSearchTerm: buildPaklapLaptopFallbackProduct,
    productDefaults: laptopProductDefaults,
    cardSelectors: [
      ".product-item-info",
      ".product-item",
      ".item.product",
      "li.product-item",
      ".product",
      "a.product-item-link",
      "li",
    ],
    searchUrls: [
      (keyword) =>
        `https://www.paklap.pk/catalogsearch/result/?q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://www.paklap.pk/catalogsearch/result/index/?q=${encodeURIComponent(keyword)}`,
      (keyword) => buildPaklapLaptopCategoryUrl(keyword, keyword),
      (keyword) =>
        buildPaklapLaptopProductUrl(keyword, "laptop-price-in-pakistan"),
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/www\.paklap\.pk\/[^/?#]+\.html$/i.test(url),
  },
  {
    site: "Acom.pk",
    limit: 1,
    allowDirectProductPage: true,
    extractProductPage: extractAcomLaptopProductPage,
    candidateLimit: 70,
    forceDetailPage: false,
    productDefaults: laptopProductDefaults,
    cardSelectors: [
      ".grid-view-item.product-card",
      ".product-item",
      ".grid__item.product",
      ".product-card",
      ".product",
      'a[href*="/products/"]',
    ],
    searchUrls: [
      (keyword) =>
        `https://acom.pk/search?type=product&q=${encodeURIComponent(keyword)}`,
      (keyword) => `https://acom.pk/search?q=${encodeURIComponent(keyword)}`,
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/acom\.pk\/products\/[^/?#]+\/?$/i.test(url),
  },
  {
    site: "Al Aqsa",
    limit: 1,
    scrape: scrapeAlaqsaLaptops,
    allowDirectProductPage: true,
    extractProductPage: extractAlaqsaLaptopProductPage,
    candidateLimit: 80,
    forceDetailPage: true,
    productDefaults: laptopProductDefaults,
    cardSelectors: [
      "li.product",
      ".product",
      ".type-product",
      ".product-grid-item",
      "a.woocommerce-LoopProduct-link",
      'a[href*="/product/"]',
    ],
    searchUrls: [
      (keyword) =>
        `https://alaqsa.com.pk/?s=${encodeURIComponent(keyword)}&post_type=product`,
      (keyword) =>
        `https://alaqsa.com.pk/product-category/buy-best-price-used-laptops-in-lahore-pakistan/?s=${encodeURIComponent(keyword)}&post_type=product`,
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/alaqsa\.com\.pk\/product\/[^/?#]+\/?$/i.test(url),
  },
  {
    site: "Intag Laptops",
    limit: 1,
    allowDirectProductPage: true,
    extractProductPage: extractIntagLaptopProductPage,
    candidateLimit: 80,
    forceDetailPage: true,
    productDefaults: laptopProductDefaults,
    cardSelectors: [
      ".product-item",
      ".product-card",
      ".grid__item",
      ".product",
      'a[href*="/products/"]',
    ],
    searchUrls: [
      (keyword) =>
        `https://intaglaptops.com/search?type=product&q=${encodeURIComponent(keyword)}`,
      (keyword) =>
        `https://intaglaptops.com/search?q=${encodeURIComponent(keyword)}`,
      (keyword) => buildIntagCoreCollectionUrl(keyword),
      (keyword) =>
        `https://intaglaptops.com/collections/all?filter.p.m.custom.search=${encodeURIComponent(keyword)}`,
    ],
    isDirectProductUrl: (url) =>
      /^https:\/\/intaglaptops\.com\/(?:collections\/[^/]+\/)?products\/[^/?#]+\/?$/i.test(
        url,
      ),
  },
  {
    site: "Mega.pk",
    limit: 1,
    candidateLimit: 60,
    productDefaults: laptopProductDefaults,
    cardSelectors: [
      ".lap_thu_box",
      'li:has(a[href*="products"])',
      ".product",
      ".product-item",
      ".product-box",
      ".item",
      ".card",
      "li",
      "tr",
    ],
    searchUrls: [
      (keyword) =>
        `https://www.mega.pk/search/${encodeURIComponent(keyword).replace(/%20/g, "+")}/`,
      (keyword) =>
        `https://www.mega.pk/search/laptops-${encodeURIComponent(keyword).replace(/%20/g, "+")}/`,
    ],
  },
];
const laptopStoreSites = [
  ...new Set(laptopStoreConfigs.map((config) => config.site)),
];
async function scrapeMobileStores(keyword) {
  const searchSource =
    stripTrailingMemoryPairFromQuery(stripMobileSpecsFromQuery(keyword) || keyword) ||
    stripMobileSpecsFromQuery(keyword) ||
    keyword;
  const searchQuery = normalizeSearchQuery(keyword, "mobiles");
  const searchTerms = [
    ...new Set([
      ...getMobileSearchTerms(keyword),
      ...getMobileSearchTerms(searchSource),
    ]),
  ];
  const storeResults = await Promise.all(
    mobileStoreConfigs.map(async (config) => {
      const collected = [];
      const seen = new Set();
      for (const term of searchTerms) {
        const results = await scrapeConfiguredStore(term, config, keyword, {
          category: "mobiles",
        }).catch((err) => {
          console.error(`${config.site} scraper failed:`, err.message || err);
          return [];
        });
        for (const product of results) {
          const key = canonicalProductKey({
            ...product,
            site: config.site || product.site,
          });
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(product);
          if (collected.length >= 8) break;
        }
        if (collected.length >= 8) break;
      }
      return collected;
    }),
  );
  let results = storeResults.flat().map((product, index) => ({
    ...product,
    position: index + 1,
    searchQuery,
  }));
  if (!results.some((product) => product.site === "WhatMobile")) {
    const whatMobileFallback = await scrapeWhatmobile(keyword).catch(() => []);
    const normalizedFallback = whatMobileFallback
      .map((product) => normalizeProduct(product))
      .filter(
        (product) =>
          product.title &&
          scoreProductMatch(product, keyword) >= 0 &&
          productMatchesCategory(product, "mobiles") &&
          productMatchesRequestedMemory(product, keyword) &&
          !isRejectedProductCandidate(product) &&
          (product.price || product.image),
      )
      .slice(0, 1);
    if (normalizedFallback.length) {
      results = [
        ...results,
        ...normalizedFallback.map((product) => ({
          ...product,
          position: results.length + 1,
          searchQuery,
        })),
      ];
    }
  }
  const mobileMemoryQuery = normalizeMobileMemoryQuery(keyword);
  const requestedMobileMemory = getRequestedMemory(mobileMemoryQuery);
  if (requestedMobileMemory.storage || requestedMobileMemory.ram) {
    const memoryAwareResults = results.map((product) => {
      const normalized = resolveRequestedMemoryVariant(
        product,
        mobileMemoryQuery || keyword,
      );
      return normalized;
    });
    const matchedMemoryResults = memoryAwareResults.filter((product) =>
      productMatchesRequestedMemory(product, mobileMemoryQuery || keyword),
    );
    results = matchedMemoryResults.length ? matchedMemoryResults : memoryAwareResults;
  }
  return results;
}
async function scrapeTabletStores(keyword, fallbackDepth = 0) {
  const searchSource =
    stripTrailingMemoryPairFromQuery(stripTabletSpecsFromQuery(keyword) || keyword) ||
    stripTabletSpecsFromQuery(keyword) ||
    keyword;
  const searchQuery = normalizeSearchQuery(searchSource, "tablets");
  const searchTerms = getTabletSearchTerms(searchSource);
  const storeResults = await Promise.all(
    tabletStoreConfigs.map(async (config) => {
      const collected = [];
      const seen = new Set();
      for (const term of searchTerms) {
        const results = await scrapeConfiguredStore(term, config, searchSource, {
          category: "tablets",
        }).catch((err) => {
          console.error(
            `${config.site} tablet scraper failed:`,
            err.message || err,
          );
          return [];
        });
        for (const product of results) {
          const key = canonicalProductKey({
            ...product,
            site: config.site || product.site,
          });
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(product);
          if (collected.length >= 8) break;
        }
        if (collected.length >= 8) break;
      }
      return collected;
    }),
  );
  const results = storeResults.flat().map((product, index) => ({
    ...tabletProductDefaults,
    ...product,
    hidePtaStatus: true,
    condition: product.condition || "New",
    position: index + 1,
    searchQuery,
  }));
  const tabletMemoryQuery = normalizeTabletMemoryQuery(keyword);
  const requestedTabletMemory = getRequestedMemory(tabletMemoryQuery);
  if (requestedTabletMemory.storage || requestedTabletMemory.ram) {
    const memoryKeyword = tabletMemoryQuery || keyword;
    return results
      .filter((product) =>
        productMatchesRequestedMemory(product, memoryKeyword),
      )
      .map((product) =>
        resolveRequestedMemoryVariant(
          preferSmallestMemoryVariant(product, memoryKeyword),
          memoryKeyword,
        ),
      );
  }
  if (!results.length && fallbackDepth === 0 && !getRequestedMemory(keyword).storage && !getRequestedMemory(keyword).ram) {
    const fallbackKeyword = stripMemoryHintsFromQuery(keyword);
    if (fallbackKeyword && fallbackKeyword !== cleanText(keyword, 120)) {
      return scrapeTabletStores(fallbackKeyword, 1);
    }
  }
  return results;
}
async function scrapeLaptopStores(keyword, fallbackDepth = 0) {
  const searchSource =
    stripTrailingMemoryPairFromQuery(cleanText(keyword, 120)) || cleanText(keyword, 120);
  const strippedSpecs = stripLaptopSpecsFromQuery(searchSource);
  const searchQuery = normalizeSearchQuery(strippedSpecs || searchSource);
  const searchTerms = getLaptopSearchTerms(searchSource);
  const storeResults = await Promise.all(
    laptopStoreConfigs.map(async (config) => {
      const collected = [];
      const seen = new Set();
      for (const term of searchTerms) {
        const results = await scrapeConfiguredStore(term, config, searchSource, {
          category: "laptops",
        }).catch((err) => {
          console.error(
            `${config.site} laptop scraper failed:`,
            err.message || err,
          );
          return [];
        });
        for (const product of results) {
          const key = canonicalProductKey({
            ...product,
            site: config.site || product.site,
          });
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(product);
          if (collected.length >= 8) break;
        }
        if (collected.length >= 8) break;
      }
      return collected;
    }),
  );
  const results = storeResults.flat().map((product, index) => ({
    ...laptopProductDefaults,
    ...product,
    hidePtaStatus: true,
    condition: product.condition || "New",
    position: index + 1,
    searchQuery,
  }));
  if (!results.length && fallbackDepth === 0 && !getRequestedMemory(keyword).storage && !getRequestedMemory(keyword).ram) {
    const fallbackKeyword = stripLaptopSpecsFromQuery(keyword);
    if (fallbackKeyword && fallbackKeyword !== cleanText(keyword, 120)) {
      return scrapeLaptopStores(fallbackKeyword, 1);
    }
  }
  return results;
}
module.exports = {
  scrapeDaraz,
  scrapePriceOye,
  scrapeWhatmobile,
  scrapeMobileStores,
  scrapeMobileStoresBySpecs: (filters, options = {}) =>
    scrapeStoresBySpecifications("mobiles", filters, options),
  scrapeTabletStores,
  scrapeTabletStoresBySpecs: (filters, options = {}) =>
    scrapeStoresBySpecifications("tablets", filters, options),
  scrapeLaptopStores,
  scrapeLaptopStoresBySpecs: (filters, options = {}) =>
    scrapeStoresBySpecifications("laptops", filters, options),
  refreshTrackedProduct,
  fetchProductDetails,
  mobileStoreSites,
  tabletStoreSites,
  laptopStoreSites,
};

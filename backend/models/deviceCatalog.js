const { getDB } = require('../config/database');
const { normalizeProduct } = require('../utils/productNormalizer');

const CATALOG_COLLECTION = 'deviceCatalog';

function compact(value, limit = 240) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function normalizeCategory(category = '') {
  const value = String(category || '').trim().toLowerCase();
  if (value === 'mobile' || value === 'phones' || value === 'phone') return 'mobiles';
  if (value === 'tablet' || value === 'tabs' || value === 'tab') return 'tablets';
  if (value === 'laptop' || value === 'notebook') return 'laptops';
  return ['mobiles', 'tablets', 'laptops'].includes(value) ? value : 'mobiles';
}

function getKnownCatalogCompanies(category = '') {
  return {
    mobiles: [
      'Apple', 'Huawei', 'Nokia', 'Oppo', 'Samsung', 'Xiaomi'
    ],
    tablets: [
      'Apple', 'Huawei', 'Lenovo', 'Samsung', 'Xiaomi'
    ],
    laptops: [
      'Apple', 'HP', 'Dell', 'Lenovo', 'Acer', 'Asus', 'MSI', 'Microsoft', 'Razer'
    ],
  }[normalizeCategory(category)] || [];
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(value) {
  return compact(value, 80)
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function extractCore(text) {
  const match = compact(text, 600).match(/\b(?:core\s*i[3579]|i[3579]|ryzen\s*[3579])\b/i);
  if (!match) return null;
  return titleCase(match[0].replace(/\s+/g, ' '));
}

function extractGeneration(text) {
  const match = compact(text, 600).match(/\b\d{1,2}(?:st|nd|rd|th)?\s*(?:gen|generation)\b/i);
  if (!match) return null;
  return compact(match[0], 20).replace(/\s+/g, ' ').toLowerCase();
}

function getBrandAliases(category = '') {
  return {
    mobiles: {
      apple: 'Apple',
      iphone: 'Apple',
      samsung: 'Samsung',
      infinix: 'Infinix',
      tecno: 'Tecno',
      vivo: 'Vivo',
      oppo: 'Oppo',
      xiaomi: 'Xiaomi',
      redmi: 'Xiaomi',
      realme: 'Realme',
      oneplus: 'OnePlus',
      huawei: 'Huawei',
      honor: 'Honor',
      itel: 'itel',
      nokia: 'Nokia',
      oppo: 'Oppo',
    },
    tablets: {
      apple: 'Apple',
      ipad: 'Apple',
      samsung: 'Samsung',
      lenovo: 'Lenovo',
      xiaomi: 'Xiaomi',
      redmi: 'Xiaomi',
      huawei: 'Huawei',
      honor: 'Honor',
      amazon: 'Amazon',
      tcl: 'TCL',
      infinix: 'Infinix',
      oneplus: 'OnePlus',
    },
    laptops: {
      apple: 'Apple',
      macbook: 'Apple',
      hp: 'HP',
      dell: 'Dell',
      lenovo: 'Lenovo',
      acer: 'Acer',
      asus: 'Asus',
      msi: 'MSI',
      microsoft: 'Microsoft',
      surface: 'Microsoft',
    },
  }[normalizeCategory(category)] || {};
}

function inferBrand(text, category = '') {
  const aliases = getBrandAliases(category);
  const normalized = compact(text, 220).toLowerCase();
  for (const [needle, brand] of Object.entries(aliases)) {
    if (new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(normalized)) return brand;
  }
  return null;
}

function buildSearchText(doc) {
  return compact(
    [
      doc.brand,
      doc.familyName,
      doc.modelName,
      doc.modelKey,
      doc.ram,
      doc.storage,
      doc.core,
      doc.generation,
      ...(doc.aliases || []),
      ...(doc.searchQueries || []),
      doc.sampleTitle,
      doc.sampleSpecs,
      doc.sampleSnippet,
    ]
      .filter(Boolean)
      .join(' '),
    1800
  ).toLowerCase();
}

function buildSpecKey(doc) {
  return compact(
    [doc.ram, doc.storage, doc.core, doc.generation]
      .filter(Boolean)
      .join('|'),
    120
  ).toLowerCase();
}

function buildModelKey(doc) {
  return compact(doc.modelKey || doc.modelName || doc.sampleTitle || '', 180)
    .toLowerCase()
    .replace(/\b(?:price|in|pakistan|new|used|official|pta|approved|warranty|mobile|tablet|laptop|phones?|smartphones?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MODEL_NAME_STOPWORDS = new Set([
  'price',
  'prices',
  'pakistan',
  'official',
  'officially',
  'pta',
  'approved',
  'warranty',
  'new',
  'used',
  'refurbished',
  'mobile',
  'mobiles',
  'phone',
  'phones',
  'smartphone',
  'smartphones',
  'tablet',
  'tablets',
  'laptop',
  'laptops',
  'notebook',
  'notebooks',
  'spec',
  'specs',
  'specification',
  'specifications',
  'wifi',
  'wi',
  'fi',
  'lte',
  '4g',
  '5g',
  'cellular',
  'buy',
  'online',
  'with',
  'for',
  'and',
  'series',
  'model',
  'models',
]);

const MODEL_TOKEN_MAP = {
  apple: 'Apple',
  iphone: 'iPhone',
  ipad: 'iPad',
  macbook: 'MacBook',
  oneplus: 'OnePlus',
  samsung: 'Samsung',
  xiaomi: 'Xiaomi',
  redmi: 'Redmi',
  oppo: 'Oppo',
  vivo: 'Vivo',
  realme: 'Realme',
  huawei: 'Huawei',
  honor: 'Honor',
  nokia: 'Nokia',
  google: 'Google',
  motorola: 'Motorola',
  sony: 'Sony',
  nubia: 'Nubia',
  tecno: 'Tecno',
  infinix: 'Infinix',
  itel: 'itel',
  lenovo: 'Lenovo',
  acer: 'Acer',
  asus: 'Asus',
  dell: 'Dell',
  hp: 'HP',
  msi: 'MSI',
  microsoft: 'Microsoft',
  surface: 'Surface',
  galaxy: 'Galaxy',
  find: 'Find',
  reno: 'Reno',
  note: 'Note',
  pro: 'Pro',
  max: 'Max',
  plus: 'Plus',
  ultra: 'Ultra',
  mini: 'Mini',
  air: 'Air',
  lite: 'Lite',
  fold: 'Fold',
  flip: 'Flip',
  pad: 'Pad',
  tab: 'Tab',
};

const MODEL_GENERIC_WORDS = new Set([
  'price',
  'prices',
  'pakistan',
  'official',
  'officially',
  'pta',
  'approved',
  'warranty',
  'new',
  'used',
  'refurbished',
  'mobile',
  'mobiles',
  'phone',
  'phones',
  'smartphone',
  'smartphones',
  'tablet',
  'tablets',
  'tab',
  'laptop',
  'laptops',
  'notebook',
  'notebooks',
  'spec',
  'specs',
  'specification',
  'specifications',
  'buy',
  'online',
  'with',
  'for',
  'and',
  'series',
  'model',
  'models',
  'search',
  'searching',
  'compare',
  'seller',
  'store',
  'stores',
  'sale',
  'sales',
  'stock',
  'available',
  'availability',
  'status',
  'listing',
  'listings',
  'deal',
  'deals',
  'item',
  'items',
  'shop',
  'in',
  'out',
  'for',
  'regular',
  'region',
  'china',
  'global',
  'india',
  'usa',
  'uk',
  'eu',
  'europe',
  'international',
  'intl',
  'variant',
  'version',
  'edition',
]);

function formatModelToken(token = '') {
  const value = compact(token, 80);
  if (!value) return '';
  const lower = value.toLowerCase();
  if (MODEL_TOKEN_MAP[lower]) return MODEL_TOKEN_MAP[lower];
  if (/^\d+[a-z]*$/i.test(value)) return value.toUpperCase();
  if (/^[a-z]\d+[a-z0-9+.-]*$/i.test(value)) return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  if (/^[a-z0-9+.-]+$/i.test(value)) return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  return value;
}

function isGenericModelLabel(value = '', brand = '') {
  const label = compact(value, 120).toLowerCase();
  const brandLabel = compact(brand, 80).toLowerCase();
  if (!label) return true;
  if (brandLabel && label === brandLabel) return true;
  if (/^\d+(?:\s+\d+)*$/.test(label)) return true;

  const tokens = label.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  if (tokens.every(token => MODEL_GENERIC_WORDS.has(token))) return true;
  if (!/\d/.test(label) && tokens.length <= 1) return true;
  if (MODEL_GENERIC_WORDS.has(tokens[0])) return true;

  return false;
}

function resolveModelLabel(candidates = [], brand = '') {
  let fallback = '';

  for (const candidate of candidates) {
    const cleaned = cleanModelSource(candidate, brand);
    if (!cleaned) continue;
    if (!fallback) fallback = cleaned;
    if (!isGenericModelLabel(cleaned, brand)) return cleaned;
  }

  return isGenericModelLabel(fallback, brand) ? '' : fallback;
}

function prettyModelName(value = '') {
  return compact(value, 120)
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(formatModelToken)
    .join(' ');
}

function extractSlugText(value = '') {
  const text = compact(value, 320);
  if (!text) return '';
  try {
    const url = new URL(text);
    const slug = url.pathname.split('/').filter(Boolean).pop() || '';
    return slug.replace(/[-_]+/g, ' ');
  } catch (err) {
    return text
      .replace(/https?:\/\/[^/]+/i, '')
      .split(/[?#]/)[0]
      .split('/')
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, ' ') || text;
  }
}

function cleanModelSource(text = '', brand = '') {
  let value = compact(text, 260);
  if (!value) return '';
  value = extractSlugText(value);
  value = value.replace(/^(?:specification\s+search|spec search|search results?|search|compare|buy|latest|new)\s+/i, ' ');
  if (brand) {
    value = value.replace(new RegExp(`^${escapeRegExp(brand)}\\s*`, 'i'), '');
    value = value.replace(new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'ig'), ' ');
  }
  const colonParts = value.split(':').map(part => part.trim()).filter(Boolean);
  if (colonParts.length >= 2) {
    const leftSide = colonParts[0];
    if (/\d/.test(leftSide) || /\b(?:mi|redmi|note|pro|max|ultra|lite|neo|galaxy|xperia|moto|reno|find|nova|mate|pad|tab)\b/i.test(leftSide)) {
      value = leftSide;
    }
  }
  value = value
    .replace(/\s+\|\s+.*$/i, ' ')
    .replace(/\s+-\s+(?:price|buy|online|official|pta|approved|with|in\s+pakistan).*$/i, ' ')
    .replace(/\bon\s+[a-z0-9 ._-]+$/i, ' ')
    .replace(/\b(?:seller|seller:|updated|open\s+store\s+for\s+price|live\s+scraper\s+did\s+not\s+return\s+a\s+matching\s+card).*$/i, ' ')
    .replace(/\b(?:price|prices|buy|online|official|pta|approved|warranty|mobile|mobiles|phone|phones?|tablet|tablets|laptop|laptops|notebook|notebooks|new|used|refurbished|spec|specs|specification|specifications)\b.*$/i, ' ')
    .replace(/\b(?:china|global|india|usa|uk|eu|europe(?:an)?|international|intl|variant|version|edition)\b.*$/i, ' ')
    .replace(/(?:china|global)/ig, ' ')
    .replace(/\b(?:china|global|india|usa|uk|eu|europe(?:an)?|international|intl|variant|version|edition)\b/ig, ' ')
    .replace(/\b(?:\d{1,4}\s*(?:gb|tb)\s*(?:ram|rom|storage)?(?:\s*[+\/-]\s*\d{1,4}\s*(?:gb|tb)\s*(?:ram|rom|storage)?)*)\b.*$/i, ' ')
    .replace(/\b(?:\d{1,2}\s*gen|\d{4,5}m?ah|core\s*i[3579]|ryzen\s*[3579]|snapdragon\s*\d+|dimensity\s*\d+|exynos\s*\d+|helio\s*\w+|sm[- ]?[a-z0-9]{3,8}|[a-z]{1,2}\d{3,5})\b.*$/i, ' ')
    .replace(/\b(?:\d{1,2}(?:\.\d+)?\s*(?:inches?|inch|in\.?|")|display|screen|amoled|oled|lcd|fhd|full\s*hd|uhd|hd\+?|camera|battery|dual\s*sim|single\s*sim)\b.*$/i, ' ')
    .replace(/[|()[\]{}:,-]+/g, ' ')
    .replace(/^[^a-z0-9]+/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = value
    .split(' ')
    .map(token => token.trim())
    .filter(token => Boolean(token) && /^[a-z0-9]/i.test(token))
    .filter(token => !MODEL_NAME_STOPWORDS.has(token.toLowerCase()));

  const isBareNumeric = token => /^\d{1,4}$/.test(token);
  const isLikelyModelCode = token => /^(?:sm[- ]?[a-z0-9]{3,8}|[a-z]{1,2}\d{3,5}|x\d{3,4})$/i.test(token);

  while (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    const prev = tokens[tokens.length - 2];
    if (isBareNumeric(last) && (isBareNumeric(prev) || isLikelyModelCode(prev))) {
      tokens.pop();
      continue;
    }
    break;
  }

  if (!tokens.length) return '';
  const joined = prettyModelName(tokens.join(' ')).trim();
  if (!joined) return '';
  if (brand && joined.toLowerCase() === brand.toLowerCase()) return '';
  return joined;
}

function inferModelName(product = {}, normalized = {}, category = '', brand = '') {
  const candidates = [
    product.modelName,
    normalized && normalized.title,
    product.title,
    product.searchQuery,
    product.keyword,
    product.link,
    product.displayLink,
  ].filter(Boolean);

  return resolveModelLabel(candidates, brand);
}

function buildModelDisplayName(doc = {}) {
  const brand = compact(doc.brand, 80);
  const candidates = [
    doc.modelName,
    doc.sampleTitle,
    doc.sampleLink,
    ...(doc.searchQueries || []),
    ...(doc.aliases || []),
    doc.modelKey,
  ].filter(Boolean);

  const resolved = resolveModelLabel(candidates, brand);
  if (resolved) return resolved;

  return prettyModelName(doc.modelName || doc.sampleTitle || brand || 'Unknown Model');
}

function buildModelFamilyKey(doc = {}) {
  const brand = compact(doc.brand, 80).toLowerCase();
  const display = buildModelDisplayName(doc).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [brand || 'unknown', display || compact(doc.modelKey || doc.sampleTitle || doc.catalogKey || '', 120).toLowerCase()].join('|');
}

function buildVariantLabel(doc = {}) {
  const parts = [doc.ram, doc.storage, doc.core, doc.generation].filter(Boolean);
  if (parts.length) return parts.join(' / ');
  return 'Standard';
}

function buildCatalogEntry(product = {}, options = {}) {
  const normalized = product.normalized ? product : normalizeProduct(product);
  const category = normalizeCategory(options.category || product.category || normalized.category);
  const searchableText = [
    product.title,
    product.specs,
    product.snippet,
    product.searchQuery,
    product.keyword,
    normalized.title,
    normalized.specs,
    normalized.snippet,
    normalized.normalized && normalized.normalized.description,
  ].filter(Boolean).join(' ');

  const brand = product.brand || product.company || inferBrand([
    product.modelName,
    normalized.title,
    product.searchQuery,
    product.title,
  ].filter(Boolean).join(' '), category);

  const modelName = inferModelName(product, normalized, category, brand);
  if (!brand || !modelName || isGenericModelLabel(modelName, brand)) return { catalogKey: null };
  const modelKey = buildModelKey({
    modelKey: product.modelKey,
    modelName,
    sampleTitle: normalized.title || product.title || '',
  }) || compact(modelName, 120).toLowerCase();
  const core = product.core || extractCore(searchableText);
  const generation = product.generation || extractGeneration(searchableText);
  const ram = normalized.normalized && normalized.normalized.ram || product.ram || null;
  const storage = normalized.normalized && normalized.normalized.storage || product.storage || null;
  const specKey = buildSpecKey({ ram, storage, core, generation }) || 'nospec';
  const catalogKey = [category, brand || 'unknown', modelKey || modelName || 'unknown', specKey].join('|');
  const sampleTitle = compact(normalized.title || product.title || modelName, 220);
  const familyKey = buildModelFamilyKey({
    brand,
    modelName,
    sampleTitle,
    sampleLink: normalized.link || product.link || null,
    searchQueries: [
      compact(product.searchQuery || '', 220),
      compact(product.keyword || '', 220),
    ].filter(Boolean),
    aliases: [
      compact(product.title || '', 220),
      compact(product.displayLink || '', 220),
    ].filter(Boolean),
    modelKey,
    catalogKey,
  });
  const aliases = [
    compact(product.title || '', 220),
    compact(product.searchQuery || '', 220),
    compact(product.keyword || '', 220),
    compact(product.displayLink || '', 220),
  ].filter(Boolean);

  return {
    catalogKey,
    category,
    brand: brand || null,
    modelName: modelName || sampleTitle,
    modelKey: modelKey || null,
    familyKey,
    familyName: buildModelDisplayName({
      brand,
      modelName,
      sampleTitle,
      sampleLink: normalized.link || product.link || null,
      searchQueries: [
        compact(product.searchQuery || '', 220),
        compact(product.keyword || '', 220),
      ].filter(Boolean),
      aliases,
      modelKey,
      catalogKey,
    }),
    specKey,
    ram,
    storage,
    core,
    generation,
    aliases: [...new Set(aliases)],
    searchQueries: [
      compact(product.searchQuery || '', 220),
      compact(product.keyword || '', 220),
    ].filter(Boolean),
    sampleTitle,
    sampleLink: normalized.link || product.link || null,
    sampleSite: normalized.site || product.site || null,
    sampleSnippet: compact(normalized.snippet || product.snippet || '', 600) || null,
    sampleSpecs: compact(normalized.specs || product.specs || '', 900) || null,
    samplePrice: normalized.price || product.price || null,
    searchText: buildSearchText({
      brand,
      modelName,
      modelKey,
      ram,
      storage,
      core,
      generation,
      aliases,
      searchQueries: [
        compact(product.searchQuery || '', 220),
        compact(product.keyword || '', 220),
      ].filter(Boolean),
      sampleTitle,
      sampleSpecs: compact(normalized.specs || product.specs || '', 900),
      sampleSnippet: compact(normalized.snippet || product.snippet || '', 600),
    }),
    observationCount: 1,
    sourceSites: [normalized.site || product.site || null].filter(Boolean),
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  };
}

async function ensureIndexes() {
  const db = getDB();
  const collection = db.collection(CATALOG_COLLECTION);
  await Promise.all([
    collection.createIndex({ category: 1, brand: 1, modelKey: 1, specKey: 1 }, { unique: true }),
    collection.createIndex({ category: 1, lastSeenAt: -1 }),
    collection.createIndex({ category: 1, brand: 1, observationCount: -1 }),
  ]).catch(() => null);
}

let indexPromise = null;
async function ensureCatalogReady() {
  if (!indexPromise) indexPromise = ensureIndexes().catch(err => {
    indexPromise = null;
    throw err;
  });
  return indexPromise;
}

async function saveCatalogEntriesFromProducts(products = [], options = {}) {
  const db = getDB();
  await ensureCatalogReady();
  const collection = db.collection(CATALOG_COLLECTION);
  const seen = new Map();

  for (const product of products) {
    const entry = buildCatalogEntry(product, options);
    if (!entry.catalogKey) continue;
    const current = seen.get(entry.catalogKey);
    if (!current) {
      seen.set(entry.catalogKey, entry);
      continue;
    }
    current.observationCount += 1;
    current.lastSeenAt = new Date();
    current.sampleTitle = current.sampleTitle || entry.sampleTitle;
    current.sampleLink = current.sampleLink || entry.sampleLink;
    current.sampleSite = current.sampleSite || entry.sampleSite;
    current.samplePrice = current.samplePrice || entry.samplePrice;
    current.sampleSnippet = current.sampleSnippet || entry.sampleSnippet;
    current.sampleSpecs = current.sampleSpecs || entry.sampleSpecs;
    current.brand = current.brand || entry.brand;
    current.modelName = current.modelName || entry.modelName;
    current.modelKey = current.modelKey || entry.modelKey;
    current.familyKey = current.familyKey || entry.familyKey;
    current.familyName = current.familyName || entry.familyName;
    current.ram = current.ram || entry.ram;
    current.storage = current.storage || entry.storage;
    current.core = current.core || entry.core;
    current.generation = current.generation || entry.generation;
    current.searchQueries = [...new Set([...(current.searchQueries || []), ...(entry.searchQueries || [])])];
    current.aliases = [...new Set([...(current.aliases || []), ...(entry.aliases || [])])];
    current.sourceSites = [...new Set([...(current.sourceSites || []), ...(entry.sourceSites || [])])];
    current.searchText = buildSearchText(current);
  }

  const ops = [...seen.values()].map(entry => ({
    updateOne: {
      filter: { catalogKey: entry.catalogKey },
      update: {
        $setOnInsert: {
          catalogKey: entry.catalogKey,
          firstSeenAt: entry.firstSeenAt,
        },
        $set: {
          category: entry.category,
          brand: entry.brand,
          modelName: entry.modelName,
          modelKey: entry.modelKey,
          familyKey: entry.familyKey,
          familyName: entry.familyName,
          specKey: entry.specKey,
          ram: entry.ram,
          storage: entry.storage,
          core: entry.core,
          generation: entry.generation,
          sampleTitle: entry.sampleTitle,
          sampleLink: entry.sampleLink,
          sampleSite: entry.sampleSite,
          sampleSnippet: entry.sampleSnippet,
          sampleSpecs: entry.sampleSpecs,
          samplePrice: entry.samplePrice,
          searchText: entry.searchText,
          lastSeenAt: entry.lastSeenAt,
        },
        $addToSet: {
          aliases: { $each: entry.aliases || [] },
          searchQueries: { $each: entry.searchQueries || [] },
          sourceSites: { $each: entry.sourceSites || [] },
        },
        $inc: { observationCount: entry.observationCount || 1 },
      },
      upsert: true,
    }
  }));

  if (ops.length) await collection.bulkWrite(ops, { ordered: false }).catch(() => null);
  return { count: ops.length };
}

async function findCandidateModels(category, filters = {}, limit = 24) {
  const db = getDB();
  await ensureCatalogReady();
  const normalizedCategory = normalizeCategory(category);
  const company = compact(filters.company || filters.brand || '', 80);
  const ram = compact(filters.ram || '', 40);
  const storage = compact(filters.storage || filters.rom || '', 40);
  const core = compact(filters.core || '', 40);
  const generation = compact(filters.generation || filters.gen || '', 40);
  const specKey = buildSpecKey({ ram, storage, core, generation });
  const queryParts = [company, ram, storage, core, generation].filter(Boolean);
  const docs = await db.collection(CATALOG_COLLECTION)
    .find({ category: normalizedCategory })
    .sort({ observationCount: -1, lastSeenAt: -1 })
    .limit(Math.max(limit * 8, 48))
    .toArray();

  const scored = docs.map(doc => {
    const text = compact(doc.searchText || [
      doc.brand,
      doc.modelName,
      doc.modelKey,
      doc.ram,
      doc.storage,
      doc.core,
      doc.generation,
      ...(doc.aliases || []),
    ].filter(Boolean).join(' '), 1800).toLowerCase();
    let score = 0;
    if (specKey && doc.specKey === specKey) score += 140;
    if (company && new RegExp(`\\b${escapeRegExp(company)}\\b`, 'i').test(text)) score += 120;
    if (ram && new RegExp(`\\b${escapeRegExp(ram)}\\b`, 'i').test(text)) score += 80;
    if (storage && new RegExp(`\\b${escapeRegExp(storage)}\\b`, 'i').test(text)) score += 80;
    if (core && new RegExp(`\\b${escapeRegExp(core)}\\b`, 'i').test(text)) score += 70;
    if (generation && new RegExp(`\\b${escapeRegExp(generation)}\\b`, 'i').test(text)) score += 70;
    if (doc.observationCount) score += Math.min(doc.observationCount, 10);
    if (queryParts.length === 0) score += 1;
    return { doc, score };
  }).filter(item => item.score > 0 || queryParts.length === 0);

  return scored
    .sort((a, b) => b.score - a.score || (b.doc.observationCount || 0) - (a.doc.observationCount || 0))
    .slice(0, limit)
    .map(item => ({
      modelName: item.doc.familyName || item.doc.modelName,
      modelKey: item.doc.modelKey,
      brand: item.doc.brand,
      familyKey: item.doc.familyKey,
      familyName: item.doc.familyName,
      specKey: item.doc.specKey,
      ram: item.doc.ram,
      storage: item.doc.storage,
      core: item.doc.core,
      generation: item.doc.generation,
      catalogKey: item.doc.catalogKey,
    }));
}

async function listCatalogCompanies(category, limit = 6) {
  const db = getDB();
  await ensureCatalogReady();
  const normalizedCategory = normalizeCategory(category);
  const allowedCompanies = new Set(
    getKnownCatalogCompanies(normalizedCategory).map((item) => item.toLowerCase()),
  );
  const docs = await db.collection(CATALOG_COLLECTION).aggregate([
    { $match: { category: normalizedCategory, brand: { $ne: null } } },
    {
      $group: {
        _id: '$brand',
        count: { $sum: 1 },
        latest: { $max: '$lastSeenAt' },
      },
    },
    { $sort: { count: -1, latest: -1, _id: 1 } },
    { $limit: Math.max(1, Math.min(Number(limit) || 6, 6)) },
  ]).toArray();

  return docs.map(doc => ({
    company: doc._id,
    count: doc.count || 0,
  })).filter(item => {
    const name = compact(item.company, 80);
    if (!name) return false;
    const lower = name.toLowerCase();
    return allowedCompanies.has(lower);
  });
}

async function listCatalogModels(category, company = '', limit = 100) {
  const db = getDB();
  await ensureCatalogReady();
  const normalizedCategory = normalizeCategory(category);
  const normalizedCompany = compact(company, 80);
  const query = { category: normalizedCategory };
  if (normalizedCompany) {
    const pattern = new RegExp(`\\b${escapeRegExp(normalizedCompany)}\\b`, 'i');
    query.$or = [
      { brand: pattern },
      { modelName: pattern },
      { modelKey: pattern },
      { searchText: pattern },
    ];
  }

  const docs = await db.collection(CATALOG_COLLECTION)
    .find(query)
    .sort({ observationCount: -1, lastSeenAt: -1 })
    .limit(Math.max(1, Math.min(Number(limit) || 100, 100)))
    .toArray();

  const families = new Map();

  const isGenericLabel = (value = '', brandName = '') => {
    const label = compact(value, 80).toLowerCase();
    const brandLabel = compact(brandName, 80).toLowerCase();
    if (!label) return true;
    if (brandLabel && label === brandLabel) return true;
    return !/\d/.test(label) && label.split(/\s+/).length <= 1;
  };

  for (const doc of docs) {
    const displayName = buildModelDisplayName(doc);
    const familyKey = doc.familyKey || buildModelFamilyKey({ ...doc, modelName: displayName });
    const variantKey = doc.specKey || buildSpecKey(doc) || doc.catalogKey;
    const variantLabel = buildVariantLabel(doc);
    const existingFamily = families.get(familyKey) || {
      catalogKey: familyKey,
      category: doc.category,
      company: doc.brand,
      modelName: displayName,
      modelKey: doc.modelKey,
      familyKey,
      familyName: displayName,
      sampleTitle: doc.sampleTitle,
      sampleSite: doc.sampleSite,
      samplePrice: doc.samplePrice,
      sampleLink: doc.sampleLink,
      observationCount: 0,
      lastSeenAt: doc.lastSeenAt || null,
      variantsMap: new Map(),
    };

    if (doc.brand && !existingFamily.company) existingFamily.company = doc.brand;
    if (!isGenericLabel(displayName, existingFamily.company) || isGenericLabel(existingFamily.modelName, existingFamily.company)) {
      existingFamily.modelName = displayName;
      existingFamily.familyName = displayName;
    }
    if (!existingFamily.modelKey && doc.modelKey) existingFamily.modelKey = doc.modelKey;
    if (!existingFamily.sampleTitle && doc.sampleTitle) existingFamily.sampleTitle = doc.sampleTitle;
    if (!existingFamily.sampleSite && doc.sampleSite) existingFamily.sampleSite = doc.sampleSite;
    if (!existingFamily.samplePrice && doc.samplePrice) existingFamily.samplePrice = doc.samplePrice;
    if (!existingFamily.sampleLink && doc.sampleLink) existingFamily.sampleLink = doc.sampleLink;
    if (!existingFamily.lastSeenAt || (doc.lastSeenAt && new Date(doc.lastSeenAt) > new Date(existingFamily.lastSeenAt))) {
      existingFamily.lastSeenAt = doc.lastSeenAt;
    }
    existingFamily.observationCount += doc.observationCount || 1;

    const currentVariant = existingFamily.variantsMap.get(variantKey) || {
      variantKey,
      specKey: doc.specKey || variantKey,
      label: variantLabel,
      ram: doc.ram,
      storage: doc.storage,
      core: doc.core,
      generation: doc.generation,
      sampleTitle: doc.sampleTitle,
      sampleSite: doc.sampleSite,
      samplePrice: doc.samplePrice,
      sampleLink: doc.sampleLink,
      observationCount: 0,
      lastSeenAt: doc.lastSeenAt || null,
      compareKeyword: compact([displayName, doc.ram, doc.storage, doc.core, doc.generation].filter(Boolean).join(' '), 180),
    };

    if (!currentVariant.ram && doc.ram) currentVariant.ram = doc.ram;
    if (!currentVariant.storage && doc.storage) currentVariant.storage = doc.storage;
    if (!currentVariant.core && doc.core) currentVariant.core = doc.core;
    if (!currentVariant.generation && doc.generation) currentVariant.generation = doc.generation;
    if (!currentVariant.sampleTitle && doc.sampleTitle) currentVariant.sampleTitle = doc.sampleTitle;
    if (!currentVariant.sampleSite && doc.sampleSite) currentVariant.sampleSite = doc.sampleSite;
    if (!currentVariant.samplePrice && doc.samplePrice) currentVariant.samplePrice = doc.samplePrice;
    if (!currentVariant.sampleLink && doc.sampleLink) currentVariant.sampleLink = doc.sampleLink;
    if (!currentVariant.lastSeenAt || (doc.lastSeenAt && new Date(doc.lastSeenAt) > new Date(currentVariant.lastSeenAt))) {
      currentVariant.lastSeenAt = doc.lastSeenAt;
    }
    currentVariant.observationCount += doc.observationCount || 1;
    currentVariant.compareKeyword = compact([displayName, currentVariant.ram, currentVariant.storage, currentVariant.core, currentVariant.generation].filter(Boolean).join(' '), 180);
    existingFamily.variantsMap.set(variantKey, currentVariant);
    families.set(familyKey, existingFamily);
  }

  return [...families.values()]
    .map(family => {
      const variants = [...family.variantsMap.values()]
        .sort((a, b) => (b.observationCount || 0) - (a.observationCount || 0) || String(a.label || '').localeCompare(String(b.label || '')));
      const primaryVariant = variants[0] || null;
      const { variantsMap, ...cleanFamily } = family;
      return {
        ...cleanFamily,
        modelName: cleanFamily.modelName || cleanFamily.familyName,
        sampleTitle: cleanFamily.sampleTitle || primaryVariant?.sampleTitle || null,
        sampleSite: cleanFamily.sampleSite || primaryVariant?.sampleSite || null,
        samplePrice: cleanFamily.samplePrice || primaryVariant?.samplePrice || null,
        sampleLink: cleanFamily.sampleLink || primaryVariant?.sampleLink || null,
        variants,
        variantCount: variants.length,
        ram: primaryVariant?.ram || cleanFamily.ram || null,
        storage: primaryVariant?.storage || cleanFamily.storage || null,
        core: primaryVariant?.core || cleanFamily.core || null,
        generation: primaryVariant?.generation || cleanFamily.generation || null,
      };
    })
    .sort((a, b) => (b.observationCount || 0) - (a.observationCount || 0) || String(a.modelName || '').localeCompare(String(b.modelName || '')))
    .slice(0, limit);
}

module.exports = {
  saveCatalogEntriesFromProducts,
  findCandidateModels,
  listCatalogCompanies,
  listCatalogModels,
  buildCatalogEntry,
};

const axios = require('axios');
const { normalizeProduct } = require('../utils/productNormalizer');

const SERPAPI_KEY = process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY || '';
const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const SERPAPI_TIMEOUT = Number(process.env.SERPAPI_TIMEOUT || 60000);

const COMPANY_ALIASES = {
  mobiles: {
    apple: ['apple', 'iphone'],
    samsung: ['samsung', 'galaxy'],
    xiaomi: ['xiaomi', 'redmi', 'mi'],
    redmi: ['xiaomi', 'redmi', 'mi'],
    oppo: ['oppo'],
    vivo: ['vivo'],
    realme: ['realme'],
    infinix: ['infinix'],
    tecno: ['tecno'],
    itel: ['itel'],
    huawei: ['huawei'],
    honor: ['honor'],
    nokia: ['nokia'],
    oneplus: ['oneplus'],
  },
  tablets: {
    apple: ['apple', 'ipad'],
    samsung: ['samsung', 'galaxy'],
    xiaomi: ['xiaomi', 'redmi', 'mi'],
    redmi: ['xiaomi', 'redmi', 'mi'],
    huawei: ['huawei'],
    honor: ['honor'],
    lenovo: ['lenovo'],
    oneplus: ['oneplus'],
    infinix: ['infinix'],
    tcl: ['tcl'],
  },
  laptops: {
    apple: ['apple', 'macbook'],
    hp: ['hp', 'hewlett packard'],
    dell: ['dell'],
    lenovo: ['lenovo'],
    acer: ['acer'],
    asus: ['asus'],
    msi: ['msi'],
    microsoft: ['microsoft', 'surface'],
    surface: ['microsoft', 'surface'],
  },
};

function cleanText(value, limit = 180) {
  if (!value) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeTypoWords(value = '') {
  return cleanText(value, 120)
    .split(/\s+/)
    .map((word) => word.replace(/^([a-z])\1{1,3}([a-z]+)$/i, '$1$2'))
    .join(' ');
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeNumberToken(value) {
  const text = cleanText(value, 40).toLowerCase();
  const match = text.match(/\b(\d{1,4}(?:\.\d+)?)\b/);
  if (!match) return '';
  return match[1].replace(/\.0+$/, '');
}

function normalizeRam(value) {
  const text = cleanText(value, 40);
  if (!text) return '';
  const match = text.match(/\b(\d{1,4}(?:\.\d+)?)\s*(?:GB)?\s*(?:RAM)?\b/i) || text.match(/\bRAM\s*:?\s*(\d{1,4}(?:\.\d+)?)\s*(?:GB)?\b/i);
  if (!match) return '';
  const num = match[1].replace(/\.0+$/, '');
  return `${num}GB RAM`;
}

function normalizeStorage(value) {
  const text = cleanText(value, 40);
  if (!text) return '';
  const match = text.match(/\b(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\b/i);
  if (match) return `${match[1].replace(/\.0+$/, '')}${match[2].toUpperCase()}`;
  if (/^\d{1,4}$/.test(text)) return `${text}GB`;
  return '';
}

function normalizeCore(value) {
  const text = cleanText(value, 40).toLowerCase();
  const match = text.match(/\b(?:core\s*)?(i[3579]|ryzen\s*[3579])\b/i);
  if (!match) return '';
  return match[1].replace(/\s+/g, ' ').replace(/^i(\d)$/, 'Core i$1').replace(/^ryzen\s*(\d)$/, 'Ryzen $1');
}

function normalizeGeneration(value) {
  const text = cleanText(value, 40).toLowerCase();
  const match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:gen|generation)?\b/i);
  return match ? `${match[1]}th Gen` : '';
}

function normalizeSpecFilters(filters = {}) {
  const company = normalizeTypoWords(filters.company || filters.brand);
  const ram = normalizeRam(filters.ram);
  const storage = normalizeStorage(filters.storage || filters.rom);
  const core = normalizeCore(filters.core || filters.processor);
  const generation = normalizeGeneration(filters.generation || filters.gen);
  return { company, ram, storage, core, generation };
}

function companyTokens(company, category) {
  const normalized = cleanText(company, 80).toLowerCase();
  if (!normalized) return [];
  const aliases = COMPANY_ALIASES[category] || {};
  const known = aliases[normalized];
  return known && known.length ? known : [normalized];
}

function preferredCompanyQuery(company, category) {
  const tokens = companyTokens(company, category);
  if (!tokens.length) return '';
  if (category === 'mobiles') {
    if (tokens.includes('iphone')) return 'iphone';
    if (tokens.includes('galaxy')) return 'galaxy';
    if (tokens.includes('redmi')) return 'redmi';
  }
  if (category === 'tablets') {
    if (tokens.includes('ipad')) return 'ipad';
    if (tokens.includes('galaxy')) return 'galaxy tab';
  }
  return tokens[0];
}

function buildSearchQueries(category, filters = {}) {
  const normalized = normalizeSpecFilters(filters);
  const company = normalized.company;
  if (!company) return [];

  const ram = normalized.ram;
  const storage = normalized.storage;
  const core = normalized.core;
  const generation = normalized.generation;
  const ramNum = normalizeNumberToken(ram);
  const storageNum = normalizeNumberToken(storage);
  const companyQuery = preferredCompanyQuery(company, category) || company;
  const baseParts = [companyQuery];
  const categoryTerm =
    category === 'laptops' ? 'laptop' : category === 'tablets' ? 'tablet' : 'mobile';
  const storageBare = storageNum ? `${storageNum}GB` : storage;
  const ramBare = ramNum ? `${ramNum}GB` : ram;
  const queries = [];
  const push = (...parts) => {
    const term = cleanText(parts.filter(Boolean).join(' '), 180);
    if (term) queries.push(term);
  };

  if (category === 'laptops') {
    push(...baseParts, categoryTerm, core, generation, ram, storage, 'Pakistan');
    push(...baseParts, 'notebook', core, generation, ramBare, storageBare, 'Pakistan');
    push(...baseParts, categoryTerm, core, generation, ramBare, storageBare, 'Pakistan');
    push(...baseParts, categoryTerm, core, ramBare, storageBare, 'Pakistan');
    push(...baseParts, categoryTerm, ramBare, storageBare, 'Pakistan');
    push(...baseParts, core, generation, ramBare, storageBare);
  } else if (category === 'tablets') {
    push(...baseParts, 'tab', ramBare, storageBare);
    push(...baseParts, 'tablet', ramBare, storageBare);
    push(...baseParts, ram, storage);
    push(...baseParts, 'ipad', ramBare, storageBare);
  } else {
    push(...baseParts, ram, storage);
    push(...baseParts, company, ramBare, storageBare);
    push(...baseParts, company, ram, storageBare);
  }

  return [...new Set(queries.filter(Boolean))].slice(0, 8);
}

function resultText(item = {}) {
  return cleanText(
    [
      item.title,
      item.source,
      item.seller,
      item.snippet,
      item.description,
      item.product_details && Array.isArray(item.product_details)
        ? item.product_details
            .map((detail) => `${detail.name || ''} ${detail.value || ''}`.trim())
            .join(' ')
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    1200,
  );
}

function parseMemoryGb(value) {
  const text = cleanText(value, 40).toUpperCase();
  const match = text.match(/(\d{1,4}(?:\.\d+)?)\s*(TB|GB)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2].toUpperCase() === 'TB' ? amount * 1024 : amount;
}

function textHasRequestedRam(text, requestedRam) {
  const ramGb = parseMemoryGb(requestedRam);
  if (!ramGb) return true;
  const source = cleanText(text, 1200);
  const token = String(Math.round(ramGb));
  return new RegExp(`\\b${escapeRegExp(token)}\\s*GB\\s*RAM\\b|\\bRAM\\s*:?\\s*${escapeRegExp(token)}\\s*GB\\b|\\b${escapeRegExp(token)}\\s*GB\\b`, 'i').test(source);
}

function textHasRequestedStorage(text, requestedStorage) {
  const storageGb = parseMemoryGb(requestedStorage);
  if (!storageGb) return true;
  const source = cleanText(text, 1200);
  const token = String(Math.round(storageGb));
  return new RegExp(`\\b${escapeRegExp(token)}\\s*GB\\b|\\b${escapeRegExp(token)}\\s*TB\\b`, 'i').test(source);
}

function companyMatches(text, company, category) {
  const tokens = companyTokens(company, category);
  if (!tokens.length) return true;
  const source = cleanText(text, 1200).toLowerCase();
  return tokens.some((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(source));
}

function textHasRequestedCore(text, requestedCore) {
  const normalized = cleanText(requestedCore, 40).toLowerCase();
  if (!normalized) return true;
  const source = cleanText(text, 1200).toLowerCase();
  const token = normalized
    .replace(/^core\s*/i, '')
    .replace(/^ryzen\s*/i, 'ryzen ')
    .trim();
  if (!token) return true;
  const patterns = [
    new RegExp(`\\bcore\\s*${escapeRegExp(token)}\\b`, 'i'),
    new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i'),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

function textHasRequestedGeneration(text, requestedGeneration) {
  const normalized = cleanText(requestedGeneration, 40).toLowerCase();
  if (!normalized) return true;
  const source = cleanText(text, 1200).toLowerCase();
  const match = normalized.match(/\b(\d{1,2})\b/);
  if (!match) return true;
  const number = match[1];
  return new RegExp(`\\b${escapeRegExp(number)}(?:st|nd|rd|th)?\\s*(?:gen|generation)?\\b`, 'i').test(source);
}

function isBlockedMerchant(product = {}) {
  const text = cleanText(
    [product.site, product.displayLink, product.link, product.title]
      .filter(Boolean)
      .join(' '),
    300,
  ).toLowerCase();
  return /\bdaraz\b/i.test(text);
}

function productMatchesRequestedSpecs(product, filters = {}, category = 'mobiles') {
  const normalized = normalizeSpecFilters(filters);
  const text = resultText(product);
  if (normalized.company && !companyMatches(text, normalized.company, category)) return false;
  if (normalized.ram && !textHasRequestedRam(text, normalized.ram)) return false;
  if (normalized.storage && !textHasRequestedStorage(text, normalized.storage)) return false;
  if (category === 'laptops') {
    if (normalized.core && !textHasRequestedCore(text, normalized.core)) return false;
    if (normalized.generation && !textHasRequestedGeneration(text, normalized.generation)) return false;
  }
  return true;
}

function buildSiteName(item = {}) {
  return cleanText(item.source || item.seller || item.merchant || '', 80) || 'SerpApi';
}

function buildPriceString(item = {}) {
  if (item.price) return cleanText(item.price, 40);
  if (typeof item.extracted_price === 'number') return `Rs ${item.extracted_price}`;
  if (item.extracted_price) return cleanText(String(item.extracted_price), 40);
  return '';
}

function normalizeShoppingItem(item = {}) {
  const title = cleanText(item.title, 260);
  if (!title) return null;
  const link = item.link || item.product_link || item.url || '';
  const site = buildSiteName(item);
  const price = buildPriceString(item);
  const snippet = cleanText(
    [
      item.snippet,
      item.delivery,
      item.rating ? `Rating ${item.rating}` : '',
      item.reviews ? `${item.reviews} reviews` : '',
    ]
      .filter(Boolean)
      .join(' | '),
    500,
  );

  return normalizeProduct({
    title,
    price,
    image: item.thumbnail || item.thumbnail_url || item.image || null,
    link,
    site,
    displayLink: site,
    snippet,
    specs: snippet,
    sourceType: 'SerpApi shopping',
  });
}

async function runShoppingQuery(query, start = 0) {
  if (!SERPAPI_KEY) {
    const err = new Error('SerpApi key is not configured.');
    err.code = 'SERPAPI_MISSING_KEY';
    throw err;
  }

  const { data } = await axios.get(SERPAPI_ENDPOINT, {
    timeout: SERPAPI_TIMEOUT,
    params: {
      engine: 'google_shopping',
      q: query,
      api_key: SERPAPI_KEY,
      hl: 'en',
      google_domain: 'google.com',
      start,
    },
  });
  return data || {};
}

async function searchSpecificationProducts(category, filters = {}, options = {}) {
  const normalized = normalizeSpecFilters(filters);
  const resultLimit = options.limit || 200;
  const queries = buildSearchQueries(category, normalized);
  if (!queries.length) return [];

  const collected = [];
  const seen = new Set();
  const pageStarts = [0, 10, 20];

  for (const query of queries) {
    for (const start of pageStarts) {
      if (collected.length >= resultLimit) break;
      let data = {};
      try {
        const response = await axios.get(SERPAPI_ENDPOINT, {
          timeout: SERPAPI_TIMEOUT,
          params: {
            engine: 'google_shopping',
            q: query,
            api_key: SERPAPI_KEY,
            hl: 'en',
            google_domain: 'google.com',
            start,
          },
        });
        data = response.data || {};
      } catch (err) {
        if (err.code === 'SERPAPI_MISSING_KEY') throw err;
        console.error('SerpApi spec search failed:', err.message || err);
        continue;
      }

      const items = [
        ...(Array.isArray(data.shopping_results) ? data.shopping_results : []),
        ...(Array.isArray(data.inline_shopping_results) ? data.inline_shopping_results : []),
      ];

      if (!items.length && start > 0) break;

      for (const item of items) {
        const normalizedItem = normalizeShoppingItem(item);
        if (!normalizedItem || !normalizedItem.title) continue;
        if (isBlockedMerchant(normalizedItem)) continue;
        if (!productMatchesRequestedSpecs(normalizedItem, normalized, category)) continue;
        const key = [
          normalizedItem.site || '',
          normalizedItem.title || '',
          normalizedItem.price || '',
        ]
          .join('|')
          .toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push({
          ...normalizedItem,
          category,
          searchQuery: query,
          position: collected.length + 1,
        });
        if (collected.length >= resultLimit) break;
      }
    }
    if (collected.length >= resultLimit) break;
  }

  return collected;
}

module.exports = {
  searchSpecificationProducts,
  normalizeSpecFilters,
};

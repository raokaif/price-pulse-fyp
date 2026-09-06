require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const { connectDB, getDB, client } = require('../config/database');
const { saveCatalogEntriesFromProducts } = require('../models/deviceCatalog');

const WIKI_USER_AGENT = 'PricePulseCatalogSeeder/1.0 (local development; contact: local)';

const WIKI_SOURCES = [
  { kind: 'table', page: 'List_of_Xiaomi_products', brand: 'Xiaomi' },
  { kind: 'table', page: 'List_of_Oppo_products', brand: 'Oppo' },
  { kind: 'table', page: 'List_of_iPad_models', brand: 'Apple', category: 'tablets' },
  { kind: 'category', ctitle: 'Category:Xiaomi smartphones', brand: 'Xiaomi', aliases: ['Mi', 'Redmi', 'Poco'] },
  { kind: 'category', ctitle: 'Category:Xiaomi products', brand: 'Xiaomi', aliases: ['Mi', 'Redmi', 'Poco'], category: 'tablets' },
  { kind: 'category', ctitle: 'Category:Oppo smartphones', brand: 'Oppo' },
  { kind: 'category', ctitle: 'Category:Oppo tablets', brand: 'Oppo', category: 'tablets' },
  { kind: 'category', ctitle: 'Category:Samsung mobile phones', brand: 'Samsung', aliases: ['Galaxy'] },
  { kind: 'category', ctitle: 'Category:Samsung smartphones', brand: 'Samsung', aliases: ['Galaxy'] },
  { kind: 'category', ctitle: 'Category:Samsung Galaxy Tab series', brand: 'Samsung', category: 'tablets', aliases: ['Galaxy', 'Tab'] },
  { kind: 'category', ctitle: 'Category:Huawei smartphones', brand: 'Huawei', aliases: ['Huawei'] },
  { kind: 'section-list', page: 'List_of_Huawei_products', sectionId: 'Tablets', brand: 'Huawei', category: 'tablets', aliases: ['MatePad'] },
  { kind: 'category', ctitle: 'Category:Infinix smartphones', brand: 'Infinix' },
  { kind: 'category', ctitle: 'Category:Sony smartphones', brand: 'Sony' },
  { kind: 'category', ctitle: 'Category:Vivo smartphones', brand: 'Vivo', aliases: ['iQOO', 'IQOO'] },
  { kind: 'category', ctitle: 'Category:Motorola smartphones', brand: 'Motorola', aliases: ['Moto'] },
  { kind: 'category', ctitle: 'Category:Nokia smartphones', brand: 'Nokia' },
];

const MAX_CATEGORY_MEMBERS = 250;
const WIKI_MAX_RETRIES = 3;
const WIKI_REQUEST_DELAY_MS = 750;

function compact(value, limit = 240) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function slugify(value = '') {
  return compact(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCell(value = '') {
  return compact(String(value || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' '), 240);
}

function normalizeModelCandidate(value = '') {
  return normalizeCell(value)
    .replace(/\b(?:mobile|phones?|smartphones?|tablets?|tabs?|devices?|products?|model|models|phone|tablet|smartphone)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHeadingRow(cells = []) {
  return cells.length > 0 && cells.every(cell => /^(?:rom|ram|rear|front|initial|latest)$/i.test(normalizeCell(cell)));
}

function parseMemoryOptions(text = '') {
  const value = normalizeCell(text);
  if (!value) return [];

  const explicitPairs = [];
  const pairPatterns = [
    /(\d{1,2}(?:\.\d+)?)\s*GB\s*(?:RAM)?\s*[,/+\-]\s*(\d{2,4})\s*GB\s*(?:ROM|storage)?/ig,
    /(\d{2,4})\s*GB\s*(?:ROM|storage)?\s*[,/+\-]\s*(\d{1,2}(?:\.\d+)?)\s*GB\s*(?:RAM)?/ig,
    /(\d{1,2}(?:\.\d+)?)\s*GB\s*RAM.*?(\d{2,4})\s*GB\s*(?:ROM|storage)?/ig,
    /(\d{2,4})\s*GB\s*(?:ROM|storage)?.*?(\d{1,2}(?:\.\d+)?)\s*GB\s*RAM/ig,
  ];

  for (const pattern of pairPatterns) {
    let match;
    while ((match = pattern.exec(value)) !== null) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
      const ramValue = first <= second ? first : second;
      const storageValue = first <= second ? second : first;
      explicitPairs.push({
        ram: `${ramValue}GB RAM`,
        storage: storageValue >= 1024 ? `${storageValue / 1024}TB` : `${storageValue}GB`,
      });
    }
  }

  if (explicitPairs.length) return explicitPairs;

  const numericTokens = [...value.matchAll(/\b(\d{1,2}(?:\.\d+)?|\d{2,4})\s*GB\b/ig)]
    .map(match => Number(match[1]))
    .filter(number => Number.isFinite(number));

  if (numericTokens.length >= 2) {
    const sorted = [...new Set(numericTokens)].sort((a, b) => a - b);
    const smallest = sorted[0];
    const largest = sorted[sorted.length - 1];
    if (smallest && largest) {
      return [{
        ram: `${smallest}GB RAM`,
        storage: largest >= 1024 ? `${largest / 1024}TB` : `${largest}GB`,
      }];
    }
  }

  const ramMatch = value.match(/\b(\d{1,2}(?:\.\d+)?)\s*GB\s*RAM\b/i) || value.match(/\bRAM\s*:?\s*(\d{1,2}(?:\.\d+)?)\s*GB\b/i);
  const storageMatch = value.match(/\b(\d{2,4})\s*GB\s*(?:ROM|storage|internal\s+storage|capacity)\b/i) || value.match(/\b(\d{2,4})\s*GB\b/i);
  if (ramMatch || storageMatch) {
    const ramValue = ramMatch ? Number(ramMatch[1]) : null;
    const storageValue = storageMatch ? Number(storageMatch[1]) : null;
    return [{
      ram: ramValue ? `${ramValue}GB RAM` : null,
      storage: storageValue ? (storageValue >= 1024 ? `${storageValue / 1024}TB` : `${storageValue}GB`) : null,
    }].filter(item => item.ram || item.storage);
  }

  return [];
}

function expandMemoryValues(ramValue, storageValue, fallbackText = '') {
  const cleanRam = normalizeCell(ramValue);
  const cleanStorage = normalizeCell(storageValue);
  if (cleanRam || cleanStorage) {
    return [{
      ram: cleanRam || null,
      storage: cleanStorage || null,
    }];
  }
  return parseMemoryOptions(fallbackText);
}

function inferMemoryPairFromCells(firstCell = '', secondCell = '') {
  const combined = normalizeCell([firstCell, secondCell].filter(Boolean).join(' '));
  const parsed = parseMemoryOptions(combined);
  if (parsed.length) return parsed;

  const values = [firstCell, secondCell]
    .map(value => normalizeCell(value))
    .map(value => value.match(/\b(\d{1,4}(?:\.\d+)?)\s*GB\b/i)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter(number => Number.isFinite(number));
  if (values.length >= 2) {
    const sorted = values.sort((a, b) => a - b);
    return [{
      ram: `${sorted[0]}GB RAM`,
      storage: sorted[1] >= 1024 ? `${sorted[1] / 1024}TB` : `${sorted[1]}GB`,
    }];
  }
  return [];
}

function getCategoryFromText(text = '', modelText = '') {
  const combined = `${text} ${modelText}`.toLowerCase();
  if (/\b(?:tablet|tablets|tab|pad|ipad)\b/.test(combined)) return 'tablets';
  return 'mobiles';
}

function getBrandAliasesForSource(source = {}) {
  const aliases = [source.brand, ...(source.aliases || [])]
    .map(value => normalizeCell(value))
    .filter(Boolean);
  return [...new Set(aliases)];
}

function getSearchableBrandPattern(source = {}) {
  const aliases = getBrandAliasesForSource(source);
  if (!aliases.length) return null;
  return new RegExp(`\\b(?:${aliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
}

function isLikelyModelTitle(title = '', source = {}) {
  const value = normalizeCell(title);
  if (!value) return false;
  if (/^(?:list|category|controv|company|products?|smart home|people|accessories|topics?)\b/i.test(value)) return false;
  if (/\b(?:controversies|company|official|history|brand|news|articles?)\b/i.test(value)) return false;
  const pattern = getSearchableBrandPattern(source);
  if (pattern && !pattern.test(value)) return false;
  return /\d/.test(value) || /\b(?:pad|galaxy|redmi|poco|iqoo|mi|moto|iphone|ipad|asha|lumia|reno|find|neo|nord|xperia|pixel|galaxy)\b/i.test(value);
}

function trimModelName(value = '', brand = '') {
  let model = normalizeCell(value);
  if (!model) return '';
  if (brand) {
    model = model.replace(new RegExp(`^${brand}\\s+`, 'i'), '');
    model = model.replace(new RegExp(`\\b${brand}\\b`, 'ig'), ' ');
  }
  model = model
    .replace(/\s*[\[(].*$/, ' ')
    .replace(/\s+\d{1,2}\s*gb.*$/i, ' ')
    .replace(/\s+\|\s+.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return model || normalizeCell(value);
}

function buildSourceId(page, category, model, ram, storage, index) {
  return slugify([page, category, model, ram, storage, index].filter(Boolean).join('-')) || `${page}-${index}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestWikiPage(page) {
  let lastErr = null;
  for (let attempt = 0; attempt < WIKI_MAX_RETRIES; attempt += 1) {
    try {
      const url = `https://en.wikipedia.org/wiki/${encodeURI(page)}`;
      return await axios.get(url, {
        headers: {
          'User-Agent': WIKI_USER_AGENT,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 30000,
      });
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status !== 429 && status < 500) break;
      const retryAfter = Number(err?.response?.headers?.['retry-after'] || 0);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : (attempt + 1) * 2000;
      await sleep(Math.min(waitMs, 15000));
    }
  }
  throw lastErr;
}

async function fetchWikiPage(page) {
  const res = await requestWikiPage(page);
  if (!res.data) {
    throw new Error(`Wikipedia page fetch failed for ${page}`);
  }
  return res.data;
}

async function fetchWikiCategoryMembers(ctitle) {
  const html = await fetchWikiPage(ctitle);
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  const collectLinks = selector => {
    $(selector).find('a[href^="/wiki/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = normalizeCell($(el).text());
      if (!title) return;
      const normalizedTitle = title.toLowerCase();
      if (seen.has(normalizedTitle)) return;
      seen.add(normalizedTitle);
      results.push({
        title,
        pageid: href || title,
      });
    });
  };

  collectLinks('#mw-pages');
  collectLinks('#mw-subcategories');

  return results.slice(0, MAX_CATEGORY_MEMBERS);
}

function extractHeadingForTable($, table) {
  const heading = $(table).prevAll('h2, h3, h4, h5').first().text();
  return normalizeCell(heading.replace(/\[edit\]/i, ''));
}

function buildRowsFromTable($, page, brand, tableIndex, table) {
  const headers = $(table)
    .find('tr')
    .first()
    .find('th,td')
    .map((_, el) => normalizeCell($(el).text()))
    .get();
  if (!headers.length) return [];

  const modelIndex = headers.findIndex(header => /^model$/i.test(header) || /^name$/i.test(header));
  if (modelIndex < 0) return [];

  const ramIndex = headers.findIndex(header => /^ram$/i.test(header));
  const storageIndex = headers.findIndex(header => /^(?:internal\s+storage|storage|rom)$/i.test(header));
  const memoryIndex = headers.findIndex(header => /^memory$/i.test(header));
  const headingText = extractHeadingForTable($, table);
  const rows = [];

  $(table)
    .find('tr')
    .slice(1)
    .each((rowIndex, tr) => {
      const cells = $(tr)
        .find('th,td')
        .map((_, el) => normalizeCell($(el).text()))
        .get()
        .filter(Boolean);

      if (!cells.length || isHeadingRow(cells)) return;
      const modelCell = cells[modelIndex] || cells[0];
      const model = trimModelName(modelCell, brand);
      if (!model || /^(?:rom|ram|rear|front|initial|latest)$/i.test(model)) return;

      const category = getCategoryFromText(headingText, model);
      const title = normalizeCell([brand, model].filter(Boolean).join(' '), 140);

      const memoryPairs = [];
      if (ramIndex >= 0 && storageIndex >= 0 && cells.length > Math.max(ramIndex, storageIndex)) {
        memoryPairs.push(...expandMemoryValues(cells[ramIndex], cells[storageIndex]));
      } else if (memoryIndex >= 0 && cells.length > memoryIndex) {
        const nextCell = cells[memoryIndex + 1] || '';
        memoryPairs.push(...inferMemoryPairFromCells(cells[memoryIndex], nextCell));
      } else if (cells.length > 1) {
        memoryPairs.push(...parseMemoryOptions(cells.join(' ')));
      }

      if (!memoryPairs.length) {
        rows.push({
          _id: buildSourceId(page, category, model, '', '', rowIndex),
          title,
          specs: '',
          brand,
          modelName: model,
          modelKey: `${brand} ${model}`.toLowerCase(),
          category,
          site: 'Wikipedia',
          sourceType: 'Reference dataset',
          searchQuery: `${brand} ${model}`,
          keyword: `${page}:${model}`,
          position: rowIndex + 1,
          scrapedAt: new Date(),
        });
        return;
      }

      for (let i = 0; i < memoryPairs.length; i += 1) {
        const pair = memoryPairs[i];
        const specText = [pair.ram, pair.storage].filter(Boolean).join(' ');
        rows.push({
          _id: buildSourceId(page, category, model, pair.ram, pair.storage, `${rowIndex}-${i}`),
          title: title,
          specs: specText,
          brand,
          modelName: model,
          modelKey: `${brand} ${model}`.toLowerCase(),
          ram: pair.ram || null,
          storage: pair.storage || null,
          category,
          site: 'Wikipedia',
          sourceType: 'Reference dataset',
          searchQuery: `${brand} ${model}`,
          keyword: `${page}:${model}`,
          position: rowIndex + 1,
          scrapedAt: new Date(),
        });
      }
    });

  return rows;
}

async function buildRowsFromCategory(source) {
  const members = await fetchWikiCategoryMembers(source.ctitle);
  const rows = [];
  const brand = source.brand || '';
  const category = source.category || 'mobiles';
  const aliases = getBrandAliasesForSource(source);
  const seenTitles = new Set();

  for (let index = 0; index < members.length; index += 1) {
    const title = normalizeCell(members[index]?.title || '');
    if (!title || seenTitles.has(title.toLowerCase())) continue;
    if (!isLikelyModelTitle(title, source)) continue;
    seenTitles.add(title.toLowerCase());

    let model = normalizeModelCandidate(title);
    for (const alias of aliases) {
      model = model.replace(new RegExp(`^${alias}\\s*`, 'i'), '');
      model = model.replace(new RegExp(`\\b${alias}\\b`, 'ig'), ' ');
    }
    model = model
      .replace(/\s+\|\s+.*$/i, ' ')
      .replace(/\s*[\[(].*$/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!model) continue;

    rows.push({
      _id: buildSourceId(source.ctitle, category, model, '', '', index),
      title: normalizeCell([brand, model].filter(Boolean).join(' '), 140),
      specs: '',
      brand,
      modelName: model,
      modelKey: `${brand} ${model}`.toLowerCase(),
      category,
      site: 'Wikipedia',
      sourceType: 'Reference dataset',
      searchQuery: `${brand} ${model}`,
      keyword: `${source.ctitle}:${model}`,
      position: index + 1,
      scrapedAt: new Date(),
    });
  }

  return rows;
}

async function buildRowsFromSectionList(source) {
  const html = await fetchWikiPage(source.page);
  const $ = cheerio.load(html);
  const section = $(`section[aria-labelledby="${source.sectionId}"]`);
  if (!section.length) return [];

  const rows = [];
  const brand = source.brand || '';
  const category = source.category || 'mobiles';
  const aliases = getBrandAliasesForSource(source);
  const seenTitles = new Set();

  section.find('li').each((index, el) => {
    const title = normalizeCell($(el).text());
    if (!title || seenTitles.has(title.toLowerCase())) return;
    if (!isLikelyModelTitle(title, source)) return;
    seenTitles.add(title.toLowerCase());

    let model = normalizeModelCandidate(title);
    for (const alias of aliases) {
      model = model.replace(new RegExp(`^${alias}\\s*`, 'i'), '');
      model = model.replace(new RegExp(`\\b${alias}\\b`, 'ig'), ' ');
    }
    model = model
      .replace(/\s+\|\s+.*$/i, ' ')
      .replace(/\s*[\[(].*$/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!model) return;

    rows.push({
      _id: buildSourceId(source.page, category, model, '', '', index),
      title: normalizeCell([brand, model].filter(Boolean).join(' '), 140),
      specs: '',
      brand,
      modelName: model,
      modelKey: `${brand} ${model}`.toLowerCase(),
      category,
      site: 'Wikipedia',
      sourceType: 'Reference dataset',
      searchQuery: `${brand} ${model}`,
      keyword: `${source.page}:${model}`,
      position: index + 1,
      scrapedAt: new Date(),
    });
  });

  return rows;
}

async function buildSeedProducts() {
  const allRows = [];
  for (const source of WIKI_SOURCES) {
    console.log(`Seeding reference source: ${source.kind === 'category' ? source.ctitle : source.page}`);
    if (source.kind === 'category') {
      const rows = await buildRowsFromCategory(source);
      allRows.push(...rows);
      await sleep(WIKI_REQUEST_DELAY_MS);
      continue;
    }

    if (source.kind === 'section-list') {
      const rows = await buildRowsFromSectionList(source);
      allRows.push(...rows);
      await sleep(WIKI_REQUEST_DELAY_MS);
      continue;
    }

    const html = await fetchWikiPage(source.page);
    const $ = cheerio.load(html);
    const tables = $('table.wikitable').toArray();
    for (let i = 0; i < tables.length; i += 1) {
      const rows = buildRowsFromTable($, source.page, source.brand, i, tables[i]);
      const normalizedCategory = source.category || rows[0]?.category;
      allRows.push(...rows.map(row => ({ ...row, category: normalizedCategory || row.category })));
    }
    await sleep(WIKI_REQUEST_DELAY_MS);
  }
  return allRows;
}

async function seedReferenceCatalog() {
  await connectDB();
  const db = getDB();
  const products = [...new Map((await buildSeedProducts()).map(product => [product._id, product])).values()];
  if (!products.length) {
    console.log('No reference products found to seed.');
    return;
  }

  const collection = db.collection('products');
  const existingIds = new Set(
    (await collection.find({ _id: { $in: products.map(product => product._id) } }, { projection: { _id: 1 } }).toArray())
      .map(doc => doc._id),
  );
  const freshProducts = products.filter(product => !existingIds.has(product._id));

  if (freshProducts.length) {
    await collection.insertMany(freshProducts, { ordered: false }).catch(err => {
      if (err?.writeErrors?.length) return;
      throw err;
    });
  }

  const productsByCategory = {
    mobiles: products.filter(product => product.category === 'mobiles'),
    tablets: products.filter(product => product.category === 'tablets'),
  };
  if (productsByCategory.mobiles.length) {
    await saveCatalogEntriesFromProducts(productsByCategory.mobiles, { category: 'mobiles' });
  }
  if (productsByCategory.tablets.length) {
    await saveCatalogEntriesFromProducts(productsByCategory.tablets, { category: 'tablets' });
  }

  const mobileCount = products.filter(product => product.category === 'mobiles').length;
  const tabletCount = products.filter(product => product.category === 'tablets').length;
  console.log(`Seeded ${products.length} reference products (${mobileCount} mobiles, ${tabletCount} tablets).`);
}

seedReferenceCatalog()
  .catch(err => {
    console.error('Reference catalog seed failed:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch (err) {}
  });

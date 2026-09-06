require('dotenv').config();

const { connectDB, getDB, client } = require('../config/database');
const { saveProductsForKeyword } = require('../models/product');
const { saveCatalogEntriesFromProducts, listCatalogCompanies, listCatalogModels } = require('../models/deviceCatalog');
const scraper = require('../services/scraper');

const CATEGORY_CONFIG = {
  mobiles: {
    label: 'mobiles',
    scrape: scraper.scrapeMobileStores,
    maxCompanies: 6,
    modelsPerCompany: 5,
  },
  tablets: {
    label: 'tablets',
    scrape: scraper.scrapeTabletStores,
    maxCompanies: 6,
    modelsPerCompany: 5,
  },
};

function compact(value, limit = 180) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function buildKeyword(category, company, model = {}) {
  const parts = [
    company,
    model.modelName || model.familyName || '',
    model.ram || '',
    model.storage || '',
    model.core || '',
    model.generation || '',
  ].filter(Boolean);
  return compact(parts.join(' '), 180);
}

async function scrapeAndSaveCategory(category, config) {
  const companies = await listCatalogCompanies(category, config.maxCompanies);
  let saved = 0;
  let scraped = 0;

  for (const companyDoc of companies) {
    const company = companyDoc.company || companyDoc._id || '';
    if (!company) continue;

    const models = await listCatalogModels(category, company, 100);
    const targets = models.slice(0, config.modelsPerCompany);
    console.log(`[${category}] ${company}: ${targets.length} models`);

    for (const model of targets) {
      const baseKeyword = buildKeyword(category, company, model);
      if (!baseKeyword) continue;

      const keywords = [
        baseKeyword,
        compact([company, model.modelName || model.familyName].filter(Boolean).join(' '), 180),
      ];

      let results = [];
      for (const keyword of [...new Set(keywords)]) {
        results = await config.scrape(keyword).catch(err => {
          console.error(`[${category}] scrape failed for "${keyword}":`, err.message || err);
          return [];
        });
        if (results.length) break;
      }

      if (!results.length) continue;

      const docs = await saveProductsForKeyword(baseKeyword, null, results, { category });
      await saveCatalogEntriesFromProducts(docs, { category });
      saved += docs.length;
      scraped += 1;
      console.log(`[${category}] saved ${docs.length} offers for ${company} ${model.modelName || model.familyName}`);
    }
  }

  return { saved, scraped };
}

async function main() {
  await connectDB();
  const db = getDB();
  const before = {
    mobiles: await db.collection('products').countDocuments({ category: 'mobiles' }),
    tablets: await db.collection('products').countDocuments({ category: 'tablets' }),
  };

  const results = {};
  for (const [category, config] of Object.entries(CATEGORY_CONFIG)) {
    results[category] = await scrapeAndSaveCategory(category, config);
  }

  const after = {
    mobiles: await db.collection('products').countDocuments({ category: 'mobiles' }),
    tablets: await db.collection('products').countDocuments({ category: 'tablets' }),
  };

  console.log(JSON.stringify({ before, after, results }, null, 2));
}

main()
  .catch(err => {
    console.error('Store product backfill failed:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch (err) {}
  });

const express = require('express');
const { getDB } = require('../config/database');
const { getEmailFromRequest } = require('../utils/auth');
const scraper = require('../services/scraper');
const serpSearch = require('../services/serpSearch');
const productModel = require('../models/product');
const deviceCatalog = require('../models/deviceCatalog');
const userModel = require('../models/user');

const router = express.Router();
const categoryLabels = {
  mobiles: 'Mobiles',
  tablets: 'Tablets',
  laptops: 'Laptops',
  electronics: 'Electronics'
};
const activeScraperCategories = new Set(['mobiles', 'tablets', 'laptops']);

// GET / or /home -> return user's recent products (if authenticated)
router.get(['/', '/home'], async (req, res) => {
  try {
    const db = getDB();
    const email = getEmailFromRequest(req);
    let user = null;
    let products = [];

    if (email) {
      user = await db.collection('login').findOne({ email }, { projection: { name: 1, email: 1, createdAt: 1 } });
      products = await db.collection('products')
        .find({ user: email, ...productModel.visibleScrapedFilter })
        .sort({ scrapedAt: -1 })
        .limit(15)
        .toArray();
    }

    return res.json({
      results: products,
      message: products.length === 0 ? (email ? 'You have no saved search results yet.' : null) : null,
      user
    });
  } catch (err) {
    console.error('Error loading home:', err.message || err);
    return res.status(500).json({ results: [], message: 'Error loading products.' });
  }
});

router.get('/catalog/models', async (req, res) => {
  const category = String(req.query.category || 'mobiles').trim().toLowerCase();
  const company = String(req.query.company || '').trim();
  const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 100));
  const currentUserEmail = getEmailFromRequest(req);

  if (!categoryLabels[category]) {
    return res.status(400).json({ error: 'Invalid category.' });
  }
  if (!currentUserEmail) {
    return res.status(401).json({ error: 'Login required for the catalog.' });
  }

  try {
    const companies = await deviceCatalog.listCatalogCompanies(category);
    const models = company
      ? await deviceCatalog.listCatalogModels(category, company, limit)
      : [];
    return res.json({
      category,
      company: company || null,
      companies,
      models,
    });
  } catch (err) {
    console.error('Catalog lookup error:', err.message || err);
    return res.status(500).json({ error: 'Could not load model catalog.' });
  }
});

// POST /scrape - scrapes known Pakistani mobile stores and saves scraped results.
router.post('/scrape', async (req, res) => {
  let keyword = (req.body.keyword || '').trim();
  const category = String(req.body.category || 'mobiles').trim().toLowerCase();
  if (!keyword) return res.status(400).json({ error: 'Keyword required.' });
  if (!categoryLabels[category]) return res.status(400).json({ error: 'Invalid category.' });

  if (!activeScraperCategories.has(category)) {
    return res.json({
      results: [],
      groups: {},
      category,
      message: `${categoryLabels[category]} scrapers are not configured yet.`
    });
  }

  try {
    console.log(`\nScraping ${categoryLabels[category].toLowerCase()} stores for: "${keyword}"`);

    const scrapeByCategory = {
      mobiles: scraper.scrapeMobileStores,
      tablets: scraper.scrapeTabletStores,
      laptops: scraper.scrapeLaptopStores
    };
    const siteListByCategory = {
      mobiles: scraper.mobileStoreSites || [],
      tablets: scraper.tabletStoreSites || [],
      laptops: scraper.laptopStoreSites || []
    };

    const finalProducts = (await scrapeByCategory[category](keyword))
      .map(product => ({ ...product, category, sourceType: product.sourceType || 'Scraped website' }));
    const foundSites = new Set(finalProducts.map(product => product.site).filter(Boolean));
    const unavailableSites = siteListByCategory[category].filter(site => !foundSites.has(site));

    console.log(`Scraped ${finalProducts.length} products from ${categoryLabels[category].toLowerCase()} stores\n`);

    if (finalProducts.length === 0) {
      return res.json({
        results: [],
        groups: {},
        category,
        message: `No products found on the configured ${categoryLabels[category].toLowerCase()} stores for "${keyword}". Try a different search term.`
      });
    }

    const currentUserEmail = req && req.headers ? getEmailFromRequest(req) : null;
    const docs = await productModel.saveProductsForKeyword(keyword, currentUserEmail, finalProducts, { category });
    await deviceCatalog.saveCatalogEntriesFromProducts(docs, { category });
    const groups = docs.reduce((acc, p) => {
      const key = p.site || 'Other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});

    let user = null;
    if (currentUserEmail) user = await userModel.findPublicByEmail(currentUserEmail);

    return res.json({
      results: docs,
      groups,
      category,
      message: `Found ${docs.length} products.`,
      user
    });
  } catch (err) {
    console.error('Scrape route error:', err.message || err);
    return res.status(500).json({ message: `Error: ${err.message || 'Unknown server error'}` });
  }
});

router.post('/scrape/specifications', async (req, res) => {
  const category = String(req.body.category || 'mobiles').trim().toLowerCase();
  const filters = req.body.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
  const currentUserEmail = req && req.headers ? getEmailFromRequest(req) : null;
  const company = String(filters.company || filters.brand || '').trim();

  if (!currentUserEmail) return res.status(401).json({ error: 'Login required for specification search.' });
  if (!['mobiles', 'tablets', 'laptops'].includes(category)) return res.status(400).json({ error: 'Specification search is available for mobiles, tablets, and laptops only.' });
  if (!company) return res.status(400).json({ error: 'Company name required.' });

  try {
    const keyword = [
      company,
      filters.core,
      filters.generation,
      filters.ram,
      filters.storage
    ].filter(Boolean).join(' ');

    console.log(`\nSearching ${categoryLabels[category].toLowerCase()} by specifications via SerpApi for: "${keyword}"`);
    let finalProducts = [];
    let primaryError = null;
    try {
      finalProducts = await serpSearch.searchSpecificationProducts(
        category,
        { ...filters, company },
        { limit: 200 }
      );
    } catch (err) {
      primaryError = err;
      console.error('SerpApi specification search failed:', err.message || err);
    }

    finalProducts = finalProducts
      .map(product => ({ ...product, category, sourceType: product.sourceType || 'Scraped website' }));
    const siteListByCategory = {
      mobiles: scraper.mobileStoreSites || [],
      tablets: scraper.tabletStoreSites || [],
      laptops: scraper.laptopStoreSites || []
    };
    const foundSites = new Set(finalProducts.map(product => product.site).filter(Boolean));
    const unavailableSites = siteListByCategory[category].filter(site => !foundSites.has(site));

    if (finalProducts.length === 0) {
      return res.json({
        results: [],
        groups: {},
        category,
        message: primaryError && primaryError.code === 'SERPAPI_MISSING_KEY'
          ? `SerpApi is not configured. No ${categoryLabels[category].toLowerCase()} found for the selected specifications.`
          : `No ${categoryLabels[category].toLowerCase()} found for the selected specifications. Try fewer filters or a broader company search.`
      });
    }

    const groups = finalProducts.reduce((acc, p) => {
      const key = p.site || 'Other';
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});

    const user = await userModel.findPublicByEmail(currentUserEmail);
    return res.json({
      results: finalProducts,
      groups,
      category,
      message: primaryError && primaryError.code === 'SERPAPI_MISSING_KEY'
        ? `SerpApi is not configured. No ${categoryLabels[category].toLowerCase()} results could be fetched live.`
        : `Found ${finalProducts.length} ${categoryLabels[category].toLowerCase()} matching the selected specifications.`,
      user
    });
  } catch (err) {
    console.error('Specification scrape route error:', err.message || err);
    return res.status(500).json({ message: `Error: ${err.message || 'Unknown server error'}` });
  }
});

module.exports = router;

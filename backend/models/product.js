const { getDB } = require('../config/database');
const { normalizeProduct } = require('../utils/productNormalizer');

const visibleScrapedFilter = {};

async function saveProductsForKeyword(keyword, userEmail, products, options = {}) {
  const db = getDB();
  const collection = db.collection('products');
  const category = options.category || 'mobiles';
  await collection.deleteMany({ keyword, category, user: userEmail || null }).catch(() => null);
  const docs = products.map((product, i) => {
    const p = product && product.normalized ? product : normalizeProduct(product);

    return {
      title: p.title || '',
      price: p.price || '',
      image: p.image || null,
      specs: p.specs || null,
      link: p.link || null,
      site: p.site || '',
      snippet: p.snippet || null,
      displayLink: p.displayLink || p.site || '',
      sourceType: p.sourceType || 'Website',
      position: p.position || i + 1,
      searchQuery: p.searchQuery || keyword,
      specMatch: product.specMatch || null,
      modelName: product.modelName || null,
      modelKey: product.modelKey || null,
      modelBestPrice: product.modelBestPrice || null,
      modelOfferRank: product.modelOfferRank || null,
      isBestModelOffer: Boolean(product.isBestModelOffer),
      variantOptions: Array.isArray(product.variantOptions)
        ? product.variantOptions
        : [],
      selectedVariantIndex:
        Number.isInteger(product.selectedVariantIndex) && product.selectedVariantIndex >= 0
          ? product.selectedVariantIndex
          : 0,
      priceIsVariantSpecific: Boolean(product.priceIsVariantSpecific),
      normalized: p.normalized || null,
      keyword,
      category,
      scrapedAt: new Date(),
      user: userEmail || null,
      _id: `${category}-${keyword}-${p.site}-${i}-${Date.now()}`
    };
  });
  if (docs.length) await collection.insertMany(docs).catch(() => null);
  return docs;
}

async function getProductsByUser(userEmail, limit = 15) {
  const db = getDB();
  if (!userEmail) return [];
  return db.collection('products').find({ user: userEmail, ...visibleScrapedFilter }).sort({ scrapedAt: -1 }).limit(limit).toArray();
}

async function aggregateHistory(userEmail) {
  const db = getDB();
  const pipeline = [ { $match: { user: userEmail, ...visibleScrapedFilter } }, { $group: { _id: '$keyword', count: { $sum: 1 }, last: { $max: '$scrapedAt' } } }, { $sort: { last: -1 } } ];
  return db.collection('products').aggregate(pipeline).toArray();
}

module.exports = { saveProductsForKeyword, getProductsByUser, aggregateHistory, visibleScrapedFilter };

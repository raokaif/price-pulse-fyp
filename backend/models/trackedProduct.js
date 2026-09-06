const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { normalizeProduct } = require('../utils/productNormalizer');

const CHECK_INTERVAL_MINUTES = Number(process.env.TRACK_PRICE_CHECK_MINUTES || 10);
const legacyIntervalDays = Number(process.env.TRACK_PRICE_CHECK_DAYS || 0);
const CHECK_INTERVAL_MS = Number(process.env.TRACK_PRICE_CHECK_MS || 0) ||
  (legacyIntervalDays > 0 ? legacyIntervalDays * 24 * 60 * 60 * 1000 : CHECK_INTERVAL_MINUTES * 60 * 1000);

function getProductIdentity(product = {}) {
  const link = String(product.link || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  if (link) return link;
  return `${product.site || ''}|${product.title || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function toHistoryPoint(product, checkedAt = new Date()) {
  const normalized = product.normalized ? product : normalizeProduct(product);
  const priceValue = normalized.normalized && normalized.normalized.priceValue;
  return {
    checkedAt,
    price: normalized.price || '',
    priceValue: Number.isFinite(priceValue) && priceValue > 0 ? priceValue : null
  };
}

function toTrackedDoc(userEmail, product = {}) {
  const normalized = normalizeProduct(product);
  const now = new Date();
  const description = normalized.normalized && normalized.normalized.description;
  const point = toHistoryPoint(normalized, now);

  return {
    user: userEmail,
    identity: getProductIdentity(normalized),
    title: normalized.title || '',
    price: normalized.price || '',
    image: normalized.image || null,
    specs: normalized.specs || null,
    snippet: normalized.snippet || null,
    description: description || normalized.specs || normalized.snippet || '',
    link: normalized.link || null,
    site: normalized.site || '',
    displayLink: normalized.displayLink || normalized.site || '',
    sourceType: normalized.sourceType || 'Tracked product',
    category: normalized.category || product.category || 'mobiles',
    searchQuery: normalized.searchQuery || product.searchQuery || '',
    normalized: normalized.normalized || null,
    currentPrice: point.price,
    currentPriceValue: point.priceValue,
    history: point.priceValue ? [point] : [],
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: now,
    nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS),
    alertCount: 0
  };
}

async function trackProduct(userEmail, product = {}) {
  const db = getDB();
  const collection = db.collection('trackedProducts');
  const doc = toTrackedDoc(userEmail, product);
  if (!userEmail || !doc.identity || !doc.title) throw new Error('A valid product is required.');

  await collection.updateOne(
    { user: userEmail, identity: doc.identity },
    {
      $setOnInsert: { createdAt: doc.createdAt, history: doc.history },
      $set: {
        title: doc.title,
        price: doc.price,
        image: doc.image,
        specs: doc.specs,
        snippet: doc.snippet,
        description: doc.description,
        link: doc.link,
        site: doc.site,
        displayLink: doc.displayLink,
        sourceType: doc.sourceType,
        category: doc.category,
        searchQuery: doc.searchQuery,
        normalized: doc.normalized,
        currentPrice: doc.currentPrice,
        currentPriceValue: doc.currentPriceValue,
        updatedAt: doc.updatedAt,
        lastCheckedAt: doc.lastCheckedAt,
        nextCheckAt: doc.nextCheckAt
      }
    },
    { upsert: true }
  );

  return collection.findOne({ user: userEmail, identity: doc.identity });
}

async function getTrackedProductsByUser(userEmail) {
  const db = getDB();
  if (!userEmail) return [];
  return db.collection('trackedProducts').find({ user: userEmail }).sort({ updatedAt: -1 }).toArray();
}

async function removeTrackedProduct(userEmail, id) {
  const db = getDB();
  if (!ObjectId.isValid(id)) return false;
  const result = await db.collection('trackedProducts').deleteOne({ _id: new ObjectId(id), user: userEmail });
  return result.deletedCount > 0;
}

async function getDueTrackedProducts(limit = 25) {
  const db = getDB();
  return db.collection('trackedProducts')
    .find({ nextCheckAt: { $lte: new Date() }, link: { $nin: [null, ''] } })
    .sort({ nextCheckAt: 1 })
    .limit(limit)
    .toArray();
}

async function recordPriceCheck(id, product, changed = false) {
  const db = getDB();
  const normalized = normalizeProduct(product);
  const now = new Date();
  const point = toHistoryPoint(normalized, now);
  const update = {
    $set: {
      price: normalized.price || '',
      currentPrice: point.price,
      currentPriceValue: point.priceValue,
      normalized: normalized.normalized || null,
      updatedAt: now,
      lastCheckedAt: now,
      nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS)
    }
  };

  if (point.priceValue) update.$push = { history: { $each: [point], $slice: -40 } };
  if (changed) {
    update.$inc = { alertCount: 1 };
    update.$set.lastAlertAt = now;
  }

  await db.collection('trackedProducts').updateOne({ _id: id }, update);
}

module.exports = {
  trackProduct,
  getTrackedProductsByUser,
  removeTrackedProduct,
  getDueTrackedProducts,
  recordPriceCheck,
  CHECK_INTERVAL_MS
};

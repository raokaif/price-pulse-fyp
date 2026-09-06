const trackedProductModel = require('../models/trackedProduct');
const userModel = require('../models/user');
const mailer = require('./mailer');
const scraper = require('./scraper');

const STARTUP_DELAY_MS = Number(process.env.TRACK_STARTUP_DELAY_MS || 30000);
const SWEEP_INTERVAL_MS = Number(process.env.TRACK_SWEEP_INTERVAL_MS || 10 * 60 * 1000);
const PRICE_CHANGE_THRESHOLD = Number(process.env.TRACK_PRICE_CHANGE_THRESHOLD || 1);

let timer = null;
let running = false;

function getPriceValue(product) {
  const value = product && product.normalized ? product.normalized.priceValue : product && product.currentPriceValue;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function hasChanged(oldValue, newValue) {
  if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) return false;
  return Math.abs(oldValue - newValue) >= PRICE_CHANGE_THRESHOLD;
}

async function checkDueTrackedProducts(limit = 25) {
  if (running) return { checked: 0, changed: 0 };
  running = true;
  let checked = 0;
  let changed = 0;

  try {
    const dueProducts = await trackedProductModel.getDueTrackedProducts(limit);
    for (const tracked of dueProducts) {
      try {
        const refreshed = await scraper.refreshTrackedProduct(tracked);
        const oldValue = tracked.currentPriceValue;
        const newValue = getPriceValue(refreshed);
        const priceChanged = hasChanged(oldValue, newValue);

        await trackedProductModel.recordPriceCheck(tracked._id, refreshed, priceChanged);
        checked += 1;

        if (priceChanged) {
          changed += 1;
          const user = await userModel.findPublicByEmail(tracked.user);
          await mailer.sendPriceChangeEmail({
            to: tracked.user,
            name: user && user.name,
            product: { ...tracked, ...refreshed },
            oldPrice: tracked.currentPrice,
            newPrice: refreshed.price
          }).catch(err => console.error('Price alert email failed:', err.message || err));
        }
      } catch (err) {
        console.error('Tracked product check failed:', err.message || err);
      }
    }
  } finally {
    running = false;
  }

  return { checked, changed };
}

function startPriceTracker() {
  if (timer || process.env.TRACK_PRICE_CHECKS === 'false') return;

  setTimeout(() => {
    checkDueTrackedProducts().catch(err => console.error('Price tracker startup check failed:', err.message || err));
  }, STARTUP_DELAY_MS);

  timer = setInterval(() => {
    checkDueTrackedProducts().catch(err => console.error('Price tracker sweep failed:', err.message || err));
  }, SWEEP_INTERVAL_MS);

  if (timer.unref) timer.unref();
}

module.exports = { startPriceTracker, checkDueTrackedProducts };

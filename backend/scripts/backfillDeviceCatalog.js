require('dotenv').config();

const { connectDB, getDB, client } = require('../config/database');
const { saveCatalogEntriesFromProducts } = require('../models/deviceCatalog');

async function backfill() {
  await connectDB();
  const db = getDB();
  await db.collection('deviceCatalog').deleteMany({});
  const cursor = db.collection('products').find(
    {},
    {
      projection: {
        title: 1,
        price: 1,
        image: 1,
        specs: 1,
        link: 1,
        site: 1,
        snippet: 1,
        displayLink: 1,
        sourceType: 1,
        position: 1,
        searchQuery: 1,
        specMatch: 1,
        modelName: 1,
        modelKey: 1,
        modelBestPrice: 1,
        modelOfferRank: 1,
        isBestModelOffer: 1,
        normalized: 1,
        keyword: 1,
        category: 1,
        scrapedAt: 1,
        user: 1,
      },
    },
  ).sort({ scrapedAt: -1, _id: -1 });

  let batch = [];
  let processed = 0;
  let saved = 0;
  const batchSize = 500;

  for await (const product of cursor) {
    batch.push(product);
    processed += 1;

    if (batch.length >= batchSize) {
      const result = await saveCatalogEntriesFromProducts(batch);
      saved += result.count || 0;
      batch = [];
    }
  }

  if (batch.length) {
    const result = await saveCatalogEntriesFromProducts(batch);
    saved += result.count || 0;
  }

  console.log(`Backfilled ${saved} catalog entries from ${processed} product rows.`);
}

backfill()
  .catch((err) => {
    console.error('Catalog backfill failed:', err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await client.close();
    } catch (err) {}
  });

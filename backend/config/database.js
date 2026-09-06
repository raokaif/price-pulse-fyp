const { MongoClient } = require('mongodb');

const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const dbName = process.env.DB_NAME || 'pricepulse';

const client = new MongoClient(mongoUrl);
let _db = null;

async function connectDB() {
  if (!_db) {
    await client.connect();
    _db = client.db(dbName);
    console.log('✅ Connected to MongoDB');
  }
  return _db;
}

function getDB() {
  if (!_db) throw new Error('DB not initialized. Call connectDB first.');
  return _db;
}

module.exports = { connectDB, getDB, client };

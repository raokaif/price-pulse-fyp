require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const { startPriceTracker } = require('./services/priceTracker');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Allow cross-origin requests for a separate React frontend. Configure via ENV if needed.
const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false); // Deny the request instead of throwing an error
  },
  credentials: true
}));

// mount routes (API only — controllers return JSON)
const routes = require('./routes/router');
app.use('/', routes);

// Error handling middleware
app.use(errorHandler);

async function init() {
  try {
    await connectDB();
    startPriceTracker();
    app.listen(process.env.PORT || 3100, () => console.log(`\n🚀 API server running on port ${process.env.PORT || 3100}`));
  } catch (err) {
    console.error('Init failed:', err);
    process.exit(1);
  }
}

init();

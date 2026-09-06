# PricePulse Backend API

A Node.js + Express.js REST API server for the PricePulse price comparison platform.

## 📁 Project Structure

```
backend/
├── config/              # Configuration files
│   └── database.js      # MongoDB connection
├── controllers/         # Route handlers (business logic)
│   ├── authController.js    # Auth endpoints
│   └── scrapeController.js  # Scraping endpoints
├── middleware/          # Express middleware
│   └── errorHandler.js  # Global error handler
├── models/              # Database models/queries
│   ├── product.js       # Product model
│   └── user.js          # User model
├── routes/              # API routes
│   └── router.js        # Main router
├── services/            # Business services
│   ├── mailer.js        # Email service
│   └── scraper.js       # Web scraping service
├── utils/               # Utility functions
│   └── auth.js          # Auth utility functions
├── index.js             # Server entry point
├── package.json         # Dependencies
├── .env.example         # Environment variables template
└── .gitignore          # Git ignore file
```

## 🚀 Quick Start

### Prerequisites
- Node.js v14+
- MongoDB (local or cloud)
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from `.env.example`:
```bash
cp .env.example .env
```

3. Configure your environment variables in `.env`

### Running the Server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will run on `http://localhost:3100` (or your configured PORT)

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/verify` - Verify email

### Products
- `GET /api/products` - Get all products
- `POST /api/products/search` - Search products
- `GET /api/products/:id` - Get product details

### Scraping
- `POST /api/scrape` - Scrape products

## 🗄️ Database

MongoDB collections:
- `login` - User accounts
- `products` - Product data
- `pending_signups` - Email verification queue

## 📦 Dependencies

- **express** - Web framework
- **mongodb** - Database driver
- **cors** - Cross-origin resource sharing
- **dotenv** - Environment variables
- **jsonwebtoken** - JWT authentication
- **bcryptjs** - Password hashing
- **nodemailer** - Email service
- **axios** - HTTP client
- **cheerio** - Web scraping

## 🛠️ Configuration

All configuration is done via `.env` file. Key variables:

- `MONGO_URL` - MongoDB connection string
- `PORT` - Server port
- `JWT_SECRET` - Secret for JWT tokens
- `CORS_ORIGIN` - Allowed frontend origin
- `SMTP_*` - Email configuration
- `SERPAPI_API_KEY` - SerpApi key used for Google-based specification search

## 🐛 Troubleshooting

### MongoDB Connection Error
- Ensure MongoDB is running
- Check `MONGO_URL` in `.env`

### CORS Issues
- Update `CORS_ORIGIN` to match your frontend URL

### Email Not Sending
- Verify SMTP credentials
- Use App-specific passwords for Gmail


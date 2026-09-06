# PricePulse - MERN Stack Price Comparison Platform

A modern, fully-functional price comparison platform built with the MERN stack (MongoDB, Express, React, Node.js).

## 📋 Overview

PricePulse is a price comparison platform that scrapes product data from multiple Pakistani e-commerce stores and allows users to compare prices across different retailers in real-time.

## 🏗️ Architecture

This is a monorepo with two main directories:

- **`backend/`** - Node.js + Express.js REST API server
- **`client/`** - React + Vite single-page application

## 📁 Project Structure

```
pricepulse/
├── backend/                 # API Server
│   ├── config/             # Configuration (Database)
│   ├── controllers/        # Route handlers
│   ├── middleware/         # Express middleware
│   ├── models/             # Database models
│   ├── routes/             # API routes
│   ├── services/           # Business logic (Mailer, Scraper)
│   ├── utils/              # Utility functions
│   ├── index.js            # Server entry point
│   ├── package.json
│   ├── .env.example
│   ├── .gitignore
│   └── README.md
│
├── client/                  # React Frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   ├── utils/         # Utility functions
│   │   ├── api.js        # API service
│   │   ├── App.jsx       # Main component
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── .env.example
│   ├── .gitignore
│   └── README.md
│
└── README.md        # This file
```

## 🎯 Features

✨ **Core Features**
- Real-time product price comparison
- Web scraping from multiple e-commerce stores
- User authentication with JWT
- Email verification with OTP
- User profile management
- Product search and filtering
- Responsive design

🔐 **Security**
- JWT-based authentication
- Bcrypt password hashing
- Email verification
- CORS protection
- Environment variable configuration

## 📚 Tech Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB
- **Authentication**: JWT + Bcrypt
- **Email**: Nodemailer
- **Scraping**: Axios + Cheerio

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite
- **Routing**: React Router v6
- **HTTP Client**: Axios
- **Styling**: CSS

## 🚀 Quick Start

### Prerequisites
- Node.js v14 or higher
- npm or yarn
- MongoDB instance (local or cloud)

### Installation

1. **Clone and navigate to project**
```bash
cd pricepulse
```

2. **Install backend dependencies**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
```

3. **Install frontend dependencies**
```bash
cd ../client
npm install
cp .env.example .env
# Edit .env if needed
```

4. **Go back to root**
```bash
cd ..
```

### Running the Project

**Terminal 1 - Start Backend:**
```bash
cd backend
npm run dev
```
Backend will run on `http://localhost:3100`

**Terminal 2 - Start Frontend:**
```bash
cd client
npm run dev
```
Frontend will run on `http://localhost:5173`

### Running Both Concurrently (from root)

If you have `concurrently` installed globally:
```bash
npm install -g concurrently
concurrently "cd backend && npm run dev" "cd client && npm run dev"
```

## 📖 Documentation

- **[Backend README](./backend/README.md)** - API documentation, configuration, and setup
- **[Client README](./client/README.md)** - Frontend setup, component structure, and development guide

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/verify` - Verify email

### Products & Search
- `GET /api/products` - Get all products
- `POST /api/products/search` - Search products by keyword
- `GET /api/products/:id` - Get product details

### Scraping
- `POST /api/scrape` - Trigger product scraping

## 🗄️ Database Schema

### Collections

**login** - User accounts
```javascript
{
  email: String (unique),
  name: String,
  password: String (hashed),
  isVerified: Boolean,
  otp: String,
  otpExpiresAt: Date,
  createdAt: Date
}
```

**products** - Product information
```javascript
{
  title: String,
  price: String,
  image: String (URL),
  link: String (URL),
  site: String,
  keyword: String,
  scrapedAt: Date,
  user: String (email)
}
```

## ⚙️ Environment Configuration

### Backend (.env)
```
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=pricepulse
PORT=3100
JWT_SECRET=your_secret_key
CORS_ORIGIN=http://localhost:5173
SMTP_USER=your_email@gmail.com
SMTP_PASS=app_password
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:3100
```

## 🛠️ Development

### Backend Development
- HTTP requests tested with Postman/Thunder Client
- MongoDB GUI: MongoDB Compass
- Live reload with Nodemon

### Frontend Development
- Hot Module Replacement (HMR) with Vite
- React DevTools browser extension
- Network requests in browser DevTools

## 🐛 Troubleshooting

### Backend Won't Start
- Check MongoDB is running
- Verify port 3100 is not in use
- Check .env configuration

### Frontend Can't Connect to Backend
- Ensure backend is running on port 3100
- Check VITE_API_URL in frontend .env
- Verify CORS_ORIGIN in backend .env

### Email Not Sending
- Use Gmail App Password (not regular password)
- Enable "Less secure apps" if using Gmail

## 📝 Contributing

1. Create feature branches from `main`
2. Follow existing code structure
3. Test thoroughly before submitting PR
4. Update documentation if needed

## 📄 License

ISC

## 👤 Author

Hamza Shamshad

## 🤝 Support

For issues and questions, please check the individual README files in backend and client directories.

---

**Happy Coding! 🚀**

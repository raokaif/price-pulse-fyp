# PricePulse Frontend

A modern React + Vite SPA for the PricePulse price comparison platform.

## 📁 Project Structure

```
client/
├── src/
│   ├── components/      # Reusable React components
│   │   ├── NavBar.jsx      # Navigation component
│   │   ├── ProductCard.jsx # Product display card
│   │   └── ProtectedRoute.jsx # Route protection
│   ├── pages/           # Page components
│   │   ├── Home.jsx     # Homepage
│   │   ├── Login.jsx    # Login page
│   │   ├── Signup.jsx   # Registration page
│   │   ├── Verify.jsx   # Email verification
│   │   ├── Profile.jsx  # User profile
│   │   └── About.jsx    # About page
│   ├── utils/           # Utility functions
│   ├── api.js          # API service
│   ├── App.jsx         # Main app component
│   ├── main.jsx        # React entry point
│   └── index.css       # Global styles
├── index.html          # HTML template
├── package.json        # Dependencies
├── .env.example        # Environment template
└── .gitignore         # Git ignore file
```

## 🚀 Quick Start

### Prerequisites
- Node.js v14+
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

3. Configure `VITE_API_URL` to match your backend

### Running Development Server

```bash
npm run dev
```

Frontend will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

Output will be in `dist/` folder

### Preview Production Build

```bash
npm run preview
```

## 🎨 Features

- **User Authentication** - Signup, login, email verification
- **Product Search** - Search and filter products
- **Price Comparison** - Compare prices across stores
- **User Profile** - Manage user information
- **Responsive Design** - Works on all devices

## 🔌 API Integration

The `api.js` file handles all API calls to the backend:
- Authentication endpoints
- Product search
- User data

Configuration via `VITE_API_URL` environment variable

## 📦 Dependencies

- **react** - UI library
- **react-dom** - React DOM rendering
- **react-router-dom** - Routing
- **axios** - HTTP client
- **vite** - Build tool

## 🛠️ Development

### Code Organization

- Components in `/src/components` (reusable)
- Pages in `/src/pages` (full page components)
- Utils in `/src/utils` (helper functions)
- API calls in `/src/api.js`

### Styling

Global styles in `index.css`, component-specific styles can be added inline or in separate CSS files.

### Adding New Pages

1. Create component in `/src/pages/`
2. Import in `App.jsx`
3. Add route to App component
4. Add navigation link in NavBar


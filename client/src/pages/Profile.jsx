import React, { useEffect, useState } from 'react';
import api from '../api';
import ProductCard from '../components/ProductCard';

export default function Profile() {
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState([]);
  const [products, setProducts] = useState([]);
  const [trackedProducts, setTrackedProducts] = useState([]);
  const [err, setErr] = useState(null);
  const bestSavedKeys = getBestProductKeysByCategory(products);
  const sortedProducts = sortProductsByCategoryAndPrice(products);

  useEffect(() => {
    load();

    const handleLogout = () => {
      setUser(null);
      setHistory([]);
      setProducts([]);
      setTrackedProducts([]);
      setErr(null);
    };

    window.addEventListener('logout', handleLogout);
    return () => window.removeEventListener('logout', handleLogout);
  }, []);

  async function load() {
    try {
      const res = await api.get('/profile');
      setUser(res.data.user || null);
      setHistory(res.data.history || []);
      setProducts(res.data.products || []);
      setTrackedProducts(res.data.trackedProducts || []);
    } catch (e) {
      if (e?.response?.status === 401) {
        setUser(null);
        setHistory([]);
        setProducts([]);
        setTrackedProducts([]);
      }
      setErr('Could not load profile');
    }
  }

  async function removeTrackedProduct(product) {
    try {
      await api.delete(`/tracked-products/${product._id}`);
      setTrackedProducts(current => current.filter(item => item._id !== product._id));
    } catch (e) {
      setErr('Could not remove tracked product');
    }
  }

  return (
    <div className="container" style={{ marginTop: 20 }}>
      <div className="card" style={{ marginBottom: 18, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#7f8c8d', marginBottom: 8 }}>
              Account
            </div>
            <h2 style={{ margin: 0 }}>{user?.name || 'Profile'}</h2>
            <div style={{ color: '#667085', marginTop: 6 }}>{user?.email || 'No email loaded'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#999' }}>
              {user?.createdAt ? `Joined ${new Date(user.createdAt).toLocaleString()}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }} className="card">
        <h3>Search history</h3>
        {history && history.length ? (
          <ul className="history-list">
            {history.map(h => (
              <li key={h._id}>
                {h._id} - {h.count} items - last: {new Date(h.last).toLocaleString()}
              </li>
            ))}
          </ul>
        ) : <div style={{ padding: 20 }}>No history yet.</div>}
      </div>

      <div style={{ marginTop: 20 }} className="card">
        <h3>Tracked products</h3>
        {trackedProducts && trackedProducts.length ? (
          <div className="tracked-products-list">
            {trackedProducts.map(product => (
              <div className="tracked-product-row" key={product._id}>
                <ProductCard p={toProductCardProduct(product)} onRemoveTrack={removeTrackedProduct} />
                <PriceHistoryGraph product={product} />
              </div>
            ))}
          </div>
        ) : <div style={{ padding: 20 }}>No tracked products yet. Open a search result and press Track price.</div>}
      </div>

      <div style={{ marginTop: 20 }} className="card">
        <h3>Saved products</h3>
        {products && products.length ? (
          <div className="results saved-products-grid">
            {sortedProducts.map((product, index) => (
              <ProductCard
                key={product._id || product.link || index}
                p={product}
                isBest={bestSavedKeys.has(getProductKey(product))}
              />
            ))}
          </div>
        ) : <div style={{ padding: 20 }}>Search while logged in to save products here.</div>}
      </div>
      {err && <div className="client-error">{err}</div>}
    </div>
  );
}

function toProductCardProduct(product) {
  return {
    ...product,
    price: product.currentPrice || product.price,
    normalized: {
      ...(product.normalized || {}),
      price: product.currentPrice || product.normalized?.price,
      priceValue: product.currentPriceValue || product.normalized?.priceValue
    }
  };
}

function PriceHistoryGraph({ product }) {
  const history = (product.history || []).filter(point => Number.isFinite(point.priceValue) && point.priceValue > 0);
  const width = 420;
  const height = 180;
  const padding = { top: 34, right: 16, bottom: 26, left: 16 };

  if (history.length === 0) {
    return (
      <div className="price-graph">
        <div className="price-graph-head">
          <strong>Price history</strong>
          <span>Waiting for first price point</span>
        </div>
      </div>
    );
  }

  const values = history.map(point => point.priceValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - Math.min(0, min));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const slotWidth = chartWidth / history.length;
  const barWidth = Math.max(4, Math.min(8, slotWidth * 0.18));
  const bars = history.map((point, index) => {
    const barHeight = Math.max(6, (point.priceValue / range) * chartHeight);
    const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
    const y = height - padding.bottom - barHeight;
    return { x, y, width: barWidth, height: barHeight };
  });
  const latest = history[history.length - 1];

  return (
    <div className="price-graph">
      <div className="price-graph-head">
        <strong>Price history</strong>
        <span>{latest.price || `Rs ${latest.priceValue.toLocaleString('en-PK')}`}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${product.title} price history`}>
        {history.map((point, index) => (
          <g key={`${point.checkedAt}-${index}`}>
            <text
              x={bars[index].x + bars[index].width / 2}
              y={Math.max(12, bars[index].y - 8)}
              textAnchor="middle"
              className="price-bar-label"
            >
              {formatGraphPrice(point.priceValue)}
            </text>
            <rect
              x={bars[index].x}
              y={bars[index].y}
              width={bars[index].width}
              height={bars[index].height}
              rx="3"
              className={`price-bar price-bar-${index % 6}`}
            />
          </g>
        ))}
      </svg>
      <div className="price-graph-meta">
        <span>{history[0]?.checkedAt ? new Date(history[0].checkedAt).toLocaleDateString() : ''}</span>
        <span>Next check: {product.nextCheckAt ? new Date(product.nextCheckAt).toLocaleString() : 'Scheduled'}</span>
      </div>
    </div>
  );
}

function formatGraphPrice(value) {
  if (value >= 100000) return `Rs ${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L`;
  if (value >= 1000) return `Rs ${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `Rs ${value.toLocaleString('en-PK')}`;
}

function getProductKey(product) {
  return product?._id || product?.link || `${product?.category || 'unknown'}-${product?.title || ''}-${product?.site || ''}`;
}

function getPriceValue(product) {
  const value = product?.normalized?.priceValue;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getBestProductKeysByCategory(products) {
  const cheapestByCategory = new Map();

  products.forEach(product => {
    const category = product?.category || 'other';
    const price = getPriceValue(product);
    if (price === null) return;
    const current = cheapestByCategory.get(category);
    if (!current || price < current) cheapestByCategory.set(category, price);
  });

  return new Set(products
    .filter(product => {
      const category = product?.category || 'other';
      const price = getPriceValue(product);
      return price !== null && price === cheapestByCategory.get(category);
    })
    .map(product => getProductKey(product)));
}

function sortProductsByCategoryAndPrice(products) {
  return [...products].sort((a, b) => {
    const categoryCompare = String(a?.category || '').localeCompare(String(b?.category || ''));
    if (categoryCompare !== 0) return categoryCompare;

    const priceA = getPriceValue(a);
    const priceB = getPriceValue(b);
    if (priceA === null && priceB === null) return 0;
    if (priceA === null) return 1;
    if (priceB === null) return -1;
    return priceA - priceB;
  });
}

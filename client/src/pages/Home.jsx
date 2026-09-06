import React from 'react';
import { Link } from 'react-router-dom';
import { categories } from './CategoryPage';

export default function Home() {
  return (
    <div className="container">
      <div className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">Pakistani price comparison</span>
          <h1>PricePulse</h1>
          <p>Compare Pakistani store prices across mobiles, tablets, and laptops with saved searches, specification filters, and clean ranked results.</p>
        </div>
        <div className="hero-stage" aria-hidden="true">
          <div className="market-slab slab-a">
            <span>PriceOye</span>
            <strong>Rs. 128,999</strong>
          </div>
          <div className="market-slab slab-b">
            <span>Paklap</span>
            <strong>Core i7</strong>
          </div>
          <div className="market-slab slab-c">
            <span>Best Match</span>
            <strong>Saved</strong>
          </div>
        </div>
        <div className="category-tabs category-links" aria-label="Product categories">
          {categories.map(category => (
            <Link key={category.id} to={`/${category.id}`} className="category-tab">
              <strong>{category.label}</strong>
              <span>{category.description}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

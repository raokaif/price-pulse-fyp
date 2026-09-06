import React, { useEffect, useState } from 'react';

export default function ProductCard({ p, isBest = false, onTrack = null, trackLabel = 'Track price', trackDisabled = false, onRemoveTrack = null, onCompare = null, compareLabel = 'Compare prices', compareDisabled = false, compactCompareView = false }) {
  const variantOptions = Array.isArray(p.variantOptions) ? p.variantOptions : [];
  const [activeVariantIndex, setActiveVariantIndex] = useState(
    Number.isInteger(p.selectedVariantIndex) ? p.selectedVariantIndex : 0,
  );
  useEffect(() => {
    setActiveVariantIndex(Number.isInteger(p.selectedVariantIndex) ? p.selectedVariantIndex : 0);
  }, [p._id, p.selectedVariantIndex, variantOptions.length]);
  const activeVariant = variantOptions[activeVariantIndex] || null;

  const description = compactCompareView
    ? ''
    : cleanOneLine(activeVariant?.label || p.normalized?.description || p.specs || p.snippet);
  const sharedPrice = p.normalized?.price || p.price;
  const exactVariantPrice = activeVariant?.price || '';
  const hasVariantPricing = Boolean(p.priceIsVariantSpecific || exactVariantPrice);
  const variantLabel = cleanOneLine(activeVariant?.label || '');
  const compactTitle = compactCompareView ? buildCompactCompareTitle(p, activeVariant) : '';
  const titleText = compactCompareView ? compactTitle : p.title;
  const tags = compactCompareView ? [] : [
    activeVariant?.storage || p.normalized?.storage,
    activeVariant?.ram || p.normalized?.ram,
    p.normalized?.ptaStatus,
    p.normalized?.simType,
    p.normalized?.color,
    p.normalized?.condition,
    p.normalized?.warranty,
    p.normalized?.batteryHealth,
    p.normalized?.boxStatus,
    p.normalized?.chargerStatus,
    p.normalized?.region,
    p.normalized?.networkStatus,
    p.normalized?.offerType,
    p.normalized?.modelNumber
  ].filter(Boolean);
  const rawSpecs = cleanOneLine(p.specs || p.snippet);
  const visibleRawSpecs = compactCompareView ? '' : looksLikeSpecs(rawSpecs) ? rawSpecs : '';
  const modelBestPrice = Number.isFinite(p.modelBestPrice) && p.modelBestPrice > 0
    ? `Best model price: Rs ${Math.round(p.modelBestPrice).toLocaleString()}`
    : '';
  const priceLabel = exactVariantPrice
    ? exactVariantPrice
    : variantOptions.length > 1 && !hasVariantPricing && sharedPrice
      ? `Starting from ${sharedPrice}`
      : sharedPrice || 'View listing for price';

  return (
    <div className={`product-card ${isBest ? 'best-product-card' : ''}`}>
      {isBest ? <div className="best-product-badge">{p.isBestModelOffer ? 'Best for model' : 'Best'}</div> : null}
      {p.image ? (
        <div className="product-image compact">
          <img src={p.image} alt={p.title} />
        </div>
      ) : null}
      <div className="product-info">
        {!compactCompareView && p.modelName ? <div className="product-model-name">{p.modelName}</div> : null}
        <div className="product-title"><a href={p.link || '#'} target="_blank" rel="noreferrer">{titleText || p.title}</a></div>
        <div className="product-summary-line">
          <strong className={priceLabel ? '' : 'price-missing'}>{priceLabel}</strong>
          {compactCompareView ? null : (modelBestPrice ? <span>{modelBestPrice}</span> : (description ? <span>{description}</span> : <span>Description not found</span>))}
        </div>
        {variantOptions.length > 1 ? (
          <div className="product-variants">
            {variantOptions.map((variant, index) => (
              <button
                key={variant.key || `${variant.label}-${index}`}
                type="button"
                className={`variant-chip ${index === activeVariantIndex ? 'active' : ''}`}
                onClick={() => setActiveVariantIndex(index)}
                aria-pressed={index === activeVariantIndex}
              >
                {cleanOneLine(variant.label || variantLabel || `Variant ${index + 1}`)}
              </button>
            ))}
          </div>
        ) : null}
        {(onCompare || onTrack || onRemoveTrack) ? (
          <div className="product-actions">
            {onCompare ? (
              <button type="button" className="track-btn" disabled={compareDisabled} onClick={() => onCompare(p)}>
                {compareLabel}
              </button>
            ) : null}
            {onTrack ? (
              <button type="button" className="track-btn" disabled={trackDisabled} onClick={() => onTrack(p)}>
                {trackLabel}
              </button>
            ) : null}
            {onRemoveTrack ? (
              <button type="button" className="track-btn danger" onClick={() => onRemoveTrack(p)}>
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
        {tags.length ? (
          <div className="product-tags">
            {[...new Set(tags)].map(tag => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
        {visibleRawSpecs ? <div className="product-specs-line">{visibleRawSpecs}</div> : null}
        <div className="scraped-at">{p.scrapedAt ? new Date(p.scrapedAt).toLocaleString() : ''}</div>
      </div>
    </div>
  );
}

function cleanOneLine(value) {
  return value ? String(value).replace(/\s+/g, ' ').trim() : '';
}

function buildCompactCompareTitle(product = {}, activeVariant = null) {
  const titleSource = cleanOneLine(
    product.modelName || product.familyName || product.sampleTitle || product.title || product.name || ''
  );
  const memory = buildCompactMemoryPair(
    activeVariant?.ram || product.normalized?.ram || product.ram,
    activeVariant?.storage || product.normalized?.storage || product.storage,
  );
  const colors = [product.normalized?.color, product.color].filter(Boolean);
  const cleaned = stripDisplayNoise(titleSource, colors);
  return cleanOneLine([cleaned, memory].filter(Boolean).join(' ')) || titleSource;
}

function buildCompactMemoryPair(ram, storage) {
  const ramNum = extractNumber(ram);
  const storageNum = extractNumber(storage);
  return [ramNum, storageNum].filter(Boolean).join(' ');
}

function stripDisplayNoise(value, extraRemovals = []) {
  let text = cleanOneLine(value);
  if (!text) return '';
  const removals = [
    /\b\d{1,4}(?:\.\d+)?\s*(?:gb|tb)\s*ram\b/gi,
    /\b(?:ram|storage|rom)\s*:?\s*\d{1,4}(?:\.\d+)?\s*(?:gb|tb)?\b/gi,
    /\b\d{1,4}(?:\.\d+)?\s*(?:gb|tb)\s*(?:ram|storage|rom)?\b/gi,
    /\b(?:color|colour|colors|colours)\b/gi,
    /\b(?:official\s+warranty|warranty|dual\s+sim|single\s+sim|sim|pta\s+approved|non\s*pta|available|in\s*stock|new|used|brand\s+new|open\s+box|condition|model|variant|storage|rom|memory|mobile|phone|tablet|buy|price|pakistan|with|for|on|and|android|ios|lte|5g|4g|edition|series|original|store|smartphone|device)\b/gi,
    /\b(?:black|white|blue|green|red|gold|silver|gray|grey|purple|pink|orange|yellow|graphite|midnight|starlight|space gray|space grey|midnight black|aurora gold|ocean blue|mist purple|lime green|sapphire blue|lavender)\b/gi,
  ];
  for (const extra of extraRemovals) {
    const cleaned = cleanOneLine(extra);
    if (cleaned) {
      removals.push(new RegExp(`\\b${escapeRegExp(cleaned)}\\b`, 'gi'));
    }
  }
  for (const pattern of removals) {
    text = text.replace(pattern, ' ');
  }
  return cleanOneLine(text);
}

function extractNumber(value) {
  const match = cleanOneLine(value).match(/(\d{1,4}(?:\.\d+)?)/);
  if (!match) return '';
  return match[1].replace(/\.0+$/, '');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeSpecs(value) {
  if (!value) return false;
  return /\b(?:ram|rom|storage|gb|tb|mah|mp|camera|display|processor|chipset|battery|screen|pixels|resolution|sim|ios|android|color|variant|dimensions)\b/i.test(value);
}

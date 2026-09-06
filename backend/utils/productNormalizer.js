function compact(value, limit = 240) {
  if (!value) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function getUsdToPkrRate() {
  const rate = Number(process.env.USD_TO_PKR_RATE || process.env.USD_TO_PKR || 280);
  return Number.isFinite(rate) && rate > 0 ? rate : 280;
}

function normalizePrice(rawPrice, fallbackText = '') {
  const text = compact(`${rawPrice || ''} ${fallbackText || ''}`, 1200);
  const usdMatch = text.match(/(?:US\$|USD|\$)\s*\.?\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:US\$|USD|\$)/i);
  if (usdMatch && !/\b(?:Rs\.?|PKR)\b/i.test(text)) {
    const numberText = usdMatch[0].match(/[\d,]+(?:\.\d+)?/);
    const rawValue = numberText ? Number(numberText[0].replace(/,/g, '')) : null;
    const priceValue = Number.isFinite(rawValue) ? Math.round(rawValue * getUsdToPkrRate()) : null;
    return { price: priceValue ? `Rs ${priceValue.toLocaleString('en-PK')}` : compact(usdMatch[0], 80), priceValue, currency: priceValue ? 'PKR' : null };
  }
  const match = text.match(/(?:Rs\.?|PKR|₨)\s*\.?\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:Rs\.?|PKR|₨)/i) || compact(rawPrice, 80).match(/\b\d{4,9}\b/);
  if (!match) return { price: /\d/.test(compact(rawPrice, 80)) ? compact(rawPrice, 80) : '', priceValue: null, currency: null };

  const numberText = match[0].match(/[\d,]+(?:\.\d+)?/);
  const priceValue = numberText ? Number(numberText[0].replace(/,/g, '')) : null;

  return {
    price: priceValue ? `Rs ${priceValue.toLocaleString('en-PK')}` : compact(match[0], 80),
    priceValue,
    currency: 'PKR'
  };
}

function extractStorage(text) {
  const source = compact(text, 1600);
  const combined = source.match(/\b(?:\d{1,2})\s*(?:gb)?\s*[+\/]\s*((?:32|64|128|256|512|1024|2048))\s*(?:gb)?\b/i);
  if (combined) {
    const value = Number(combined[1]);
    return value >= 1024 ? `${value / 1024}TB` : `${value}GB`;
  }

  const explicit = source.match(/\b(?:storage|rom|capacity|internal\s+memory|built[-\s]?in\s+memory|hard\s+drive)\s*:?\s*((?:32|64|128|256|512)\s*-?\s*GB|1\s?TB|2\s?TB)\b/i);
  if (explicit) return explicit[1].replace(/[\s-]+/g, '').toUpperCase();

  const storagePair = source.match(/\b\d{1,2}\s*-?\s*GB\s*(?:RAM|DDR\d?)?\s*(?:[,|/&+]|and|with)?\s*((?:32|64|128|256|512)\s*-?\s*GB|1\s?TB|2\s?TB)\s*(?:ROM|storage|internal|SSD|HDD|eMMC)?\b/i);
  if (storagePair) return storagePair[1].replace(/[\s-]+/g, '').toUpperCase();

  const matches = [...source.matchAll(/\b(?:32|64|128|256|512)\s*-?\s*GB\b|\b1\s?TB\b|\b2\s?TB\b/ig)];
  for (const match of matches) {
    const before = source.slice(Math.max(0, match.index - 18), match.index);
    const after = source.slice(match.index + match[0].length, match.index + match[0].length + 18);
    if (/\b(?:ram|ddr\d?)\s*:?$/i.test(before) || /^\s*(?:ram|ddr\d?)\b/i.test(after)) continue;
    return match[0].replace(/[\s-]+/g, '').toUpperCase();
  }

  return null;
}

function extractRam(text) {
  const source = compact(text, 1600);
  const combined = source.match(/\b(\d{1,2})\s*(?:gb)?\s*[+\/]\s*(?:32|64|128|256|512|1024|2048)\s*(?:gb)?\b/i);
  if (combined) return `${combined[1]}GB RAM`;
  const laptopPair = source.match(/\b(\d{1,2})\s*-?\s*GB\s+(?:(?:to|-)\s*\d{1,2}\s*-?\s*GB\s+)?(?:32|64|128|256|512|1024|2048)\s*-?\s*GB\s*(?:SSD|HDD|eMMC|storage)?\b/i);
  if (laptopPair) return `${laptopPair[1]}GB RAM`;

  const match = source.match(/\b\d{1,2}\s*-?\s*GB\s?RAM\b|\bRAM\s*:?\s*\d{1,2}\s*-?\s*GB\b/i);
  if (!match) return null;
  const size = match[0].match(/\d{1,2}\s*-?\s*GB/i);
  return size ? `${size[0].replace(/[\s-]+/g, '').toUpperCase()} RAM` : compact(match[0], 20).toUpperCase();
}

function extractMemoryVariantSummary(text) {
  const source = compact(text, 2000);
  if (!source) return { ambiguous: false, variantCount: 0 };

  const storageValues = new Set();
  const ramValues = new Set();
  const parseCandidateGb = (value) => {
    const match = compact(value, 20).match(/^(\d{1,4}(?:\.\d+)?)\s*(TB|GB)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return match[2].toUpperCase() === 'TB' ? amount * 1024 : amount;
  };

  const memoryPairPattern =
    /(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\s*(?:[,/+\-&]|and|with|\s){0,20}(\d{1,2})\s*GB\s*RAM/gi;
  for (const match of source.matchAll(memoryPairPattern)) {
    const storage = `${match[1].replace(/\.0+$/, '')}${match[2].toUpperCase()}`;
    const ram = `${match[3].replace(/\.0+$/, '')}GB RAM`;
    storageValues.add(storage);
    ramValues.add(ram);
  }

  const storagePattern =
    /\b(\d{1,4}(?:\.\d+)?)\s*(TB|GB)\b/gi;
  for (const match of source.matchAll(storagePattern)) {
    const before = source.slice(Math.max(0, match.index - 18), match.index);
    const after = source.slice(
      match.index + match[0].length,
      match.index + match[0].length + 18,
    );
    if (/\b(?:ram|ddr\d?)\s*:?$/i.test(before) || /^\s*(?:ram|ddr\d?)\b/i.test(after)) {
      continue;
    }
    storageValues.add(
      `${match[1].replace(/\.0+$/, '')}${match[2].toUpperCase()}`,
    );
  }

  const ramPattern = /\b(\d{1,2})\s*GB\s*RAM\b/gi;
  for (const match of source.matchAll(ramPattern)) {
    ramValues.add(`${match[1].replace(/\.0+$/, '')}GB RAM`);
  }

  const storageCandidateValues = [...storageValues]
    .map(parseCandidateGb)
    .filter((value) => Number.isFinite(value) && value > 0);
  const preferredStorageGb = storageCandidateValues.length
    ? storageCandidateValues.find((value) => value > 16) ||
      Math.min(...storageCandidateValues)
    : null;

  const variantCount = Math.max(storageValues.size, ramValues.size);
  return {
    ambiguous: storageValues.size > 1 || ramValues.size > 1,
    variantCount,
    preferredStorage: preferredStorageGb ? `${preferredStorageGb}GB` : null,
  };
}

function extractPtaStatus(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\bnon[\s-]?pta\b|\bnot\s+pta\b|\bwithout\s+pta\b/.test(normalized)) return 'Non PTA';
  if (/\bpta\b.*\bapproved\b|\bapproved\b.*\bpta\b|\bpta\s+approved\b/.test(normalized)) return 'PTA approved';
  if (/\bpta\b/.test(normalized)) return 'PTA mentioned';
  if (/\biphone\b|\bapple\s+iphone\b/.test(normalized)) return 'PTA not listed';
  return null;
}

function extractModelNumber(text) {
  const match = compact(text, 1200).match(/\b[A-Z]{1,4}\d{3,5}[A-Z]{0,3}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function extractSimType(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\bdual\s+(?:physical\s+)?sim\b|\bdual[-\s]?sim\b|\b2\s*sim\b|\btwo\s+sim\b/.test(normalized)) return 'Dual SIM';
  if (/\bsingle\s+sim\b|\b1\s*sim\b|\bone\s+sim\b/.test(normalized)) return 'Single SIM';
  if (/\besim\b|\be-sim\b/.test(normalized)) return 'eSIM';
  if (/\bsim\b/.test(normalized)) return 'SIM mentioned';
  return null;
}

function extractColor(text) {
  const normalized = compact(text, 1200).toLowerCase();
  const colors = [
    ['Natural Titanium', /\bnatural\s+titanium\b/],
    ['Desert Titanium', /\bdesert\s+titanium\b/],
    ['Blue Titanium', /\bblue\s+titanium\b/],
    ['Black Titanium', /\bblack\s+titanium\b/],
    ['White Titanium', /\bwhite\s+titanium\b/],
    ['Space Black', /\bspace\s+black\b/],
    ['Jet Black', /\bjet\s+black\b/],
    ['Midnight', /\bmidnight\b/],
    ['Starlight', /\bstarlight\b/],
    ['Sierra Blue', /\bsierra\s+blue\b/],
    ['Pacific Blue', /\bpacific\s+blue\b/],
    ['Rose Gold', /\brose\s+gold\b/],
    ['Space Gray', /\bspace\s+gr[ae]y\b/],
    ['Graphite', /\bgraphite\b/],
    ['Silver', /\bsilver\b/],
    ['Gold', /\bgold\b/],
    ['Black', /\bblack\b/],
    ['White', /\bwhite\b/],
    ['Blue', /\bblue\b/],
    ['Green', /\bgreen\b/],
    ['Pink', /\bpink\b/],
    ['Purple', /\bpurple\b/],
    ['Yellow', /\byellow\b/],
    ['Red', /\bred\b/],
    ['Gray', /\bgr[ae]y\b/],
    ['Titanium', /\btitanium\b/]
  ];

  const found = colors.find(([, pattern]) => pattern.test(normalized));
  return found ? found[0] : null;
}

function extractCondition(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\bbrand\s+new\b|\bnew\s+box\s+pack\b|\bbox\s+pack\b|\bsealed\b|\bpin\s+pack\b/.test(normalized)) return 'Brand new';
  if (/\bopen\s+box\b|\bopenbox\b/.test(normalized)) return 'Open box';
  if (/\bused\b|\bpre[-\s]?owned\b|\bsecond\s+hand\b/.test(normalized)) return 'Used';
  if (/\brefurbished\b|\brenewed\b/.test(normalized)) return 'Refurbished';
  if (/\blike\s+new\b|\bexcellent\s+condition\b/.test(normalized)) return 'Like new';
  return null;
}

function extractWarranty(text) {
  const normalized = compact(text, 1200).toLowerCase();
  const duration = normalized.match(/\b\d{1,2}\s*(?:months?|yrs?|years?)\s+warranty\b|\bwarranty\s*(?:of)?\s*\d{1,2}\s*(?:months?|yrs?|years?)\b/);
  if (duration) return compact(duration[0], 40).replace(/\b\w/g, letter => letter.toUpperCase());
  if (/\bofficial\s+warranty\b|\bcompany\s+warranty\b|\bbrand\s+warranty\b/.test(normalized)) return 'Official warranty';
  if (/\bshop\s+warranty\b|\bseller\s+warranty\b/.test(normalized)) return 'Shop warranty';
  if (/\bno\s+warranty\b|\bwithout\s+warranty\b/.test(normalized)) return 'No warranty';
  if (/\bwarranty\b/.test(normalized)) return 'Warranty mentioned';
  return null;
}

function extractBatteryHealth(text) {
  const match = compact(text, 1200).match(/\b(?:battery\s+health|bh|battery)\s*:?\s*(?:is\s*)?(\d{2,3})\s?%/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 1 || value > 100) return null;
  return `Battery ${value}%`;
}

function extractBoxStatus(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\bwith\s+(?:original\s+)?box\b|\bbox\s+included\b|\bfull\s+box\b|\bcomplete\s+box\b/.test(normalized)) return 'Box included';
  if (/\bwithout\s+box\b|\bno\s+box\b|\bbox\s+not\s+included\b/.test(normalized)) return 'No box';
  if (/\bbox\s+pack\b|\bsealed\s+box\b/.test(normalized)) return 'Sealed box';
  return null;
}

function extractChargerStatus(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\bwith\s+(?:original\s+)?charger\b|\bcharger\s+included\b/.test(normalized)) return 'Charger included';
  if (/\bwithout\s+charger\b|\bno\s+charger\b|\bcharger\s+not\s+included\b/.test(normalized)) return 'No charger';
  return null;
}

function extractRegion(text) {
  const normalized = compact(text, 1200).toLowerCase();
  const regions = [
    ['JV', /\bjv\b|\bjapan\s+variant\b/],
    ['LLA', /\bll\/?a\b|\blla\b|\busa\s+variant\b|\bus\s+variant\b/],
    ['ZPA', /\bzp\/?a\b|\bzpa\b|\bhk\s+variant\b|\bhong\s+kong\b/],
    ['CHA', /\bch\/?a\b|\bcha\b|\bchina\s+variant\b/],
    ['MENA', /\bmena\b|\bmiddle\s+east\b/],
    ['UK', /\buk\s+variant\b|\bza\/?a\b/]
  ];
  const found = regions.find(([, pattern]) => pattern.test(normalized));
  return found ? found[0] : null;
}

function extractNetworkStatus(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\bfactory\s+unlocked\b|\bofficially\s+unlocked\b|\bcarrier\s+unlocked\b/.test(normalized)) return 'Factory unlocked';
  if (/\bnetwork\s+locked\b|\bcarrier\s+locked\b|\bsim\s+locked\b/.test(normalized)) return 'Network locked';
  if (/\bunlocked\b/.test(normalized)) return 'Unlocked';
  return null;
}

function extractOfferType(text) {
  const normalized = compact(text, 1200).toLowerCase();
  if (/\binstallments?\b|\bemi\b|\bmonthly\s+payment\b/.test(normalized)) return 'Installments';
  if (/\bdiscount\b|\bsale\b|\boffer\b|\bdeal\b/.test(normalized)) return 'Offer';
  return null;
}

function normalizeDescription(product, extracted) {
  const parts = [
    extracted.storage,
    extracted.ram,
    extracted.ptaStatus,
    extracted.simType,
    extracted.color,
    extracted.condition,
    extracted.warranty,
    extracted.batteryHealth,
    extracted.boxStatus,
    extracted.chargerStatus,
    extracted.region,
    extracted.networkStatus,
    compact(product.specs || product.snippet, 180)
  ].filter(Boolean);

  return compact([...new Set(parts)].join(' | '), 260);
}

function normalizeProduct(product = {}) {
  const searchableText = [
    product.title,
    product.price,
    product.specs,
    product.snippet,
    product.site
  ].filter(Boolean).join(' ');
  const memorySummary = extractMemoryVariantSummary(searchableText);

  const priceData = normalizePrice(product.price, searchableText);
  const extractedStorage = product.storage || extractStorage(searchableText);
  const extractedStorageGb = extractedStorage
    ? Number(String(extractedStorage).match(/\d{1,4}(?:\.\d+)?/)?.[0])
    : null;
  const extracted = {
    storage:
      extractedStorage &&
      Number.isFinite(extractedStorageGb) &&
      extractedStorageGb > 16
        ? extractedStorage
        : memorySummary.preferredStorage || extractedStorage,
    ram: product.ram || extractRam(searchableText),
    ptaStatus: product.hidePtaStatus ? null : (product.ptaStatus || extractPtaStatus(searchableText) || 'PTA not listed'),
    modelNumber: extractModelNumber(searchableText),
    simType: extractSimType(searchableText),
    color: product.color || extractColor(searchableText),
    condition: product.condition || extractCondition(searchableText) || (product.defaultConditionNew ? 'New' : null),
    warranty: extractWarranty(searchableText),
    batteryHealth: extractBatteryHealth(searchableText),
    boxStatus: extractBoxStatus(searchableText),
    chargerStatus: extractChargerStatus(searchableText),
    region: extractRegion(searchableText),
    networkStatus: extractNetworkStatus(searchableText),
    offerType: extractOfferType(searchableText)
  };

  return {
    ...product,
    price: priceData.price || compact(product.price, 80),
    normalized: {
      price: priceData.price || null,
      priceValue: priceData.priceValue,
      currency: priceData.currency,
      storage: extracted.storage,
      ram: extracted.ram,
      ptaStatus: extracted.ptaStatus,
      modelNumber: extracted.modelNumber,
      simType: extracted.simType,
      color: extracted.color,
      condition: extracted.condition,
      warranty: extracted.warranty,
      batteryHealth: extracted.batteryHealth,
      boxStatus: extracted.boxStatus,
      chargerStatus: extracted.chargerStatus,
      region: extracted.region,
      networkStatus: extracted.networkStatus,
      offerType: extracted.offerType,
      memoryVariantAmbiguous: memorySummary.ambiguous,
      memoryVariantCount: memorySummary.variantCount,
      description: normalizeDescription(product, extracted)
    }
  };
}

module.exports = { normalizeProduct };

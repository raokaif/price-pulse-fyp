import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import api from '../api';
import ProductCard from '../components/ProductCard';
import { isAuthenticated } from '../utils/auth';

export const categories = [
  {
    id: 'mobiles',
    label: 'Mobiles',
    description: 'Live price comparisons',
    placeholder: 'Search e.g. iPhone 14'
  },
  {
    id: 'tablets',
    label: 'Tablets',
    description: 'Live price comparisons',
    placeholder: 'Search e.g. Samsung Galaxy Tab A11'
  },
  {
    id: 'laptops',
    label: 'Laptops',
    description: 'Live price comparisons',
    placeholder: 'Search e.g. Acer Nitro 5 Core i5 RTX 3050'
  },
  {
    id: 'electronics',
    label: 'Electronics',
    description: 'Search coming soon',
    placeholder: 'Search e.g. AirPods Pro'
  }
];

export function getCategory(categoryId) {
  return categories.find(category => category.id === categoryId);
}

const catalogBrowseCategories = new Set(['mobiles', 'tablets', 'laptops']);
const mobileCompanyOptions = [
  'Apple',
  'Huawei',
  'Nokia',
  'Oppo',
  'Samsung',
  'Xiaomi'
];
const tabletCompanyOptions = [
  'Apple',
  'Huawei',
  'Lenovo',
  'Samsung',
  'Xiaomi'
];
const laptopCompanyOptions = [
  'Apple',
  'HP',
  'Dell',
  'Lenovo',
  'Acer',
  'Asus',
  'MSI',
  'Microsoft',
  'Razer'
];
const mobileRamOptions = ['4GB RAM', '6GB RAM', '8GB RAM', '12GB RAM', '16GB RAM'];
const mobileStorageOptions = ['64GB', '128GB', '256GB', '512GB', '1TB'];
const laptopRamOptions = ['4GB RAM', '8GB RAM', '16GB RAM', '32GB RAM', '64GB RAM'];
const laptopStorageOptions = ['256GB SSD', '512GB SSD', '1TB SSD', '2TB SSD'];
const laptopCoreOptions = ['Core i3', 'Core i5', 'Core i7', 'Core i9', 'Ryzen 3', 'Ryzen 5', 'Ryzen 7', 'Ryzen 9'];
const laptopGenerationOptions = ['8th Gen', '9th Gen', '10th Gen', '11th Gen', '12th Gen', '13th Gen', '14th Gen'];

const categorySearchCache = new Map();

function getDefaultSearchState() {
  return {
    keyword: '',
    results: [],
    message: null,
    loading: false,
    searchMode: null,
    controller: null
  };
}

function sanitizeSearchMessage(message) {
  if (!message || typeof message !== 'object') return message || null;
  if (message.type !== 'success' || !message.text) return message;
  const text = String(message.text).replace(/\s*Not available on:.*$/i, '').trim();
  if (!text) return null;
  return { ...message, text };
}

function getDefaultSpecFilters(categoryId) {
  return {
    company: '',
    ram: '',
    storage: '',
    core: '',
    generation: ''
  };
}

function getSpecCompanyOptions(categoryId) {
  if (categoryId === 'laptops') return laptopCompanyOptions;
  if (categoryId === 'tablets') return tabletCompanyOptions;
  return mobileCompanyOptions;
}

function getSpecRamOptions(categoryId) {
  return categoryId === 'laptops' ? laptopRamOptions : mobileRamOptions;
}

function getSpecStorageOptions(categoryId) {
  return categoryId === 'laptops' ? laptopStorageOptions : mobileStorageOptions;
}

function buildCatalogCompanyOptions(categoryId, catalogCompanies = []) {
  const allowed = new Set(getSpecCompanyOptions(categoryId));
  const merged = new Map();
  for (const company of getSpecCompanyOptions(categoryId)) {
    if (company) merged.set(company, company);
  }
  for (const item of catalogCompanies) {
    const company = typeof item === 'string' ? item : item?.company;
    if (company && allowed.has(company)) merged.set(company, company);
  }
  return [...merged.values()].slice(0, getSpecCompanyOptions(categoryId).length);
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapseWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function extractFirstNumber(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)/);
  return match ? match[1].replace(/\.0+$/, '') : '';
}

function formatCompactSpecValue(value) {
  const text = collapseWhitespace(value).toLowerCase();
  if (!text) return '';
  const number = extractFirstNumber(text);
  if (!number) return '';
  return /tb\b/i.test(text) ? `${number}tb` : number;
}

function stripCompareNoise(text = '', company = '') {
  let cleaned = collapseWhitespace(text).toLowerCase();
  if (!cleaned) return '';

  const noisePatterns = [
    /\b\d+(?:\.\d+)?\s*(?:gb|tb)\s*ram\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:gb|tb)\b/gi,
    /\b\d{1,2}(?:st|nd|rd|th)\s*gen\b/gi,
    /\bcore\s*i?\d\b/gi,
    /\bryzen\s*\d\b/gi,
    /\b(?:ddr3|ddr4|ddr5|lpddr4|lpddr5|ufs|ssd|hdd)\b/gi,
    /\b(?:ram|storage|memory|processor|chipset|variant|model|phone|tablet|mobile|laptop|notebook|tab|ipad|macbook|color|colour|colors|colours)\b/gi,
    /\b(?:black|white|blue|green|red|gold|silver|gray|grey|purple|pink|orange|yellow|graphite|midnight|starlight|space gray|space grey|midnight black|aurora gold|ocean blue|mist purple|lime green|sapphire blue|lavender)\b/gi,
    /\b(?:official\s+warranty|warranty|dual\s+sim|single\s+sim|sim|pta\s+approved|non\s*pta|available|in\s*stock|new|used|brand\s+new|open\s+box|condition|buy|price|pakistan|with|for|on|and|android|ios|lte|5g|4g|edition|series|original|store|smartphone|device)\b/gi
  ];

  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  if (company) {
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegExp(company)}\\b`, 'ig'), ' ');
  }

  cleaned = cleaned.replace(/[^a-z0-9]+/gi, ' ');
  return collapseWhitespace(cleaned);
}

function deriveCompareModelName(product = {}, company = '') {
  const preferredSources = [
    product.modelName,
    product.familyName,
    product.sampleTitle,
    product.title,
    product.name,
    product.variant?.label
  ];
  for (const source of preferredSources) {
    const cleaned = stripCompareNoise(source, company);
    if (cleaned) {
      return stripCompareModelTail(cleaned);
    }
  }

  const fallback = stripCompareNoise(
    [product.modelName, product.sampleTitle, product.title, product.name].filter(Boolean).join(' '),
    company
  );
  if (fallback) return stripCompareModelTail(fallback);
  return '';
}

function stripCompareModelTail(value = '') {
  const tokens = String(value || '')
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean);
  if (!tokens.length) return '';
  while (tokens.length && compareNoiseToken(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  if (tokens.length >= 2) {
    const tail = tokens.slice(-2);
    if (tail.every(token => /^\d+$/.test(token))) {
      return tokens.slice(0, -2).join(' ');
    }
  }
  return tokens.join(' ');
}

function compareNoiseToken(token = '') {
  return /^(?:mobile|mobiles|phone|phones|tablet|tablets|tab|laptop|laptops|notebook|notebooks|ram|rom|storage|memory|color|colour|colors|colours|new|used|brand|box|condition|price|pakistan|with|for|on|and|android|ios|lte|5g|4g|official|warranty|store|smartphone|device|series|edition|available|in|stock|dual|single|sim|pta|approved|nonpta|pro|plus|max|mini|ultra)$/i.test(token);
}

function deriveCompareCompany(product = {}, categoryId = 'mobiles') {
  const sources = [
    product.company,
    product.brand,
    product.manufacturer,
    product.vendor,
    product.sampleSite
  ].filter(Boolean).map(value => String(value).trim());
  const haystack = collapseWhitespace([
    ...sources,
    product.modelName,
    product.sampleTitle,
    product.title,
    product.name
  ].filter(Boolean).join(' ')).toLowerCase();
  const option = getSpecCompanyOptions(categoryId).find(item => haystack.includes(String(item).toLowerCase()));
  return option || sources[0] || '';
}

function parseSpecificationQuery(categoryId, query = '') {
  if (!['mobiles', 'tablets', 'laptops'].includes(categoryId)) return null;
  const text = String(query || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const lowerText = text.toLowerCase();
  const company = getSpecCompanyOptions(categoryId).find(option => lowerText.includes(String(option).toLowerCase()));
  const numbers = [...text.matchAll(/\b(\d{1,4})\b/g)]
    .map(match => Number(match[1]))
    .filter(number => Number.isFinite(number));
  const uniqueNumbers = [...new Set(numbers)];
  const ramLimit = categoryId === 'laptops' ? 64 : 16;
  const ramNumber = uniqueNumbers.find(number => number <= ramLimit);
  const storageNumber = [...uniqueNumbers].reverse().find(number => number >= 32) || (uniqueNumbers.length >= 2 ? uniqueNumbers[uniqueNumbers.length - 1] : null);

  const parsed = {
    company: company || '',
    ram: ramNumber ? `${ramNumber}GB RAM` : '',
    storage: storageNumber ? `${storageNumber}GB` : '',
  };

  if (categoryId === 'laptops') {
    const coreMatch = lowerText.match(/\b(?:core\s*)?(i[3579]|ryzen\s*[3579])\b/i);
    const generationMatch = lowerText.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:gen|generation)\b/i);
    parsed.core = coreMatch
      ? coreMatch[1].replace(/\s+/g, ' ').replace(/^i(\d)$/, 'Core i$1').replace(/^ryzen\s*(\d)$/, 'Ryzen $1')
      : '';
    parsed.generation = generationMatch ? `${generationMatch[1]}th Gen` : '';
  }

  return parsed.company && (parsed.ram || parsed.storage || parsed.core || parsed.generation) ? parsed : null;
}

function getCachedSearchState(categoryId) {
  return { ...getDefaultSearchState(), ...(categorySearchCache.get(categoryId) || {}) };
}

function setCachedSearchState(categoryId, patch) {
  const current = getCachedSearchState(categoryId);
  categorySearchCache.set(categoryId, { ...current, ...patch });
  window.dispatchEvent(new CustomEvent('category-search-cache', { detail: { categoryId } }));
}

export default function CategoryPage() {
  const { categoryId } = useParams();
  const category = getCategory(categoryId);
  const activeRequest = useRef(null);
  const mountedRef = useRef(false);
  const categoryRef = useRef(categoryId);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [trackedKeys, setTrackedKeys] = useState(new Set());
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchMode, setSearchMode] = useState(null);
  const [specFilters, setSpecFilters] = useState(getDefaultSpecFilters(categoryId));
  const [specResults, setSpecResults] = useState([]);
  const [specCatalogResults, setSpecCatalogResults] = useState([]);
  const [specUnavailableSites, setSpecUnavailableSites] = useState([]);
  const [specMessage, setSpecMessage] = useState(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specSearchDone, setSpecSearchDone] = useState(false);
  const [specResultSource, setSpecResultSource] = useState(null);
  const [catalogCompanies, setCatalogCompanies] = useState([]);
  const [catalogCompany, setCatalogCompany] = useState('');
  const [catalogModels, setCatalogModels] = useState([]);
  const [catalogRamOptions, setCatalogRamOptions] = useState([]);
  const [catalogStorageOptions, setCatalogStorageOptions] = useState([]);
  const [selectedRam, setSelectedRam] = useState('');
  const [selectedStorage, setSelectedStorage] = useState('');
  const [filteredCatalogResults, setFilteredCatalogResults] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const visibleResults = sortProductsByPrice(results);
  const cheapestPrice = getCheapestPrice(visibleResults);
  const visibleSpecResults = sortProductsByPrice(specResults);
  const specCheapestPrice = getCheapestPrice(visibleSpecResults);
  const supportsModelCatalog = catalogBrowseCategories.has(categoryId);
  const supportsSpecSearch = ['mobiles', 'tablets', 'laptops'].includes(categoryId);
  const canUseModelCatalog = supportsModelCatalog && isAuthenticated();
  const mergedCompanyOptions = buildCatalogCompanyOptions(categoryId, catalogCompanies);
  const specCompanyListId = `spec-company-options-${categoryId}`;
  const specRamListId = `spec-ram-options-${categoryId}`;
  const specStorageListId = `spec-storage-options-${categoryId}`;
  const specCoreListId = `spec-core-options-${categoryId}`;
  const specGenerationListId = `spec-generation-options-${categoryId}`;

  useEffect(() => {
    categoryRef.current = categoryId;
    const cached = getCachedSearchState(categoryId);
    setSpecFilters(getDefaultSpecFilters(categoryId));
    setSpecResults([]);
    setSpecCatalogResults([]);
    setSpecUnavailableSites([]);
    setSpecMessage(null);
    setSpecLoading(false);
    setSpecSearchDone(false);
    setSpecResultSource(null);
    setCatalogCompanies([]);
    setCatalogCompany('');
    setCatalogModels([]);
    setCatalogLoading(false);
    setCatalogMessage(null);
    setCatalogLoaded(false);
    setKeyword(cached.keyword);
    setResults(cached.results);
    setTrackedKeys(new Set());
    setMessage(sanitizeSearchMessage(cached.message));
    setLoading(cached.loading);
    setSearchMode(cached.searchMode);
    if (isAuthenticated()) syncTrackedKeys();
    const handleCacheUpdate = event => {
      if (event.detail?.categoryId !== categoryId) return;
      const next = getCachedSearchState(categoryId);
      setKeyword(next.keyword);
      setResults(next.results);
      setMessage(sanitizeSearchMessage(next.message));
      setLoading(next.loading);
      setSearchMode(next.searchMode);
    };
    window.addEventListener('category-search-cache', handleCacheUpdate);
    return () => window.removeEventListener('category-search-cache', handleCacheUpdate);
  }, [categoryId]);

  useEffect(() => {
    mountedRef.current = true;
    const handleLogout = () => {
      for (const cached of categorySearchCache.values()) {
        if (cached.controller) cached.controller.abort();
      }
      categorySearchCache.clear();
      setResults([]);
      setKeyword('');
      setTrackedKeys(new Set());
      setMessage(null);
      setUnavailableSites([]);
      setSearchMode(null);
      setLoading(false);
      setSpecResults([]);
      setSpecCatalogResults([]);
      setSpecUnavailableSites([]);
      setSpecMessage(null);
      setSpecLoading(false);
      setSpecSearchDone(false);
      setSpecResultSource(null);
      setSpecFilters(getDefaultSpecFilters(categoryRef.current));
      setCatalogCompanies([]);
      setCatalogCompany('');
      setCatalogModels([]);
      setCatalogLoading(false);
      setCatalogMessage(null);
      setCatalogLoaded(false);
    };

    window.addEventListener('logout', handleLogout);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('logout', handleLogout);
    };
  }, []);

  if (!category) return <Navigate to="/" replace />;

  function cancelSearch() {
    const cached = getCachedSearchState(category.id);
    if (cached.controller) cached.controller.abort();
    activeRequest.current = null;
    setCachedSearchState(category.id, { controller: null, loading: false, searchMode: null, message: { type: 'success', text: 'Search cancelled.' } });
    setLoading(false);
    setSearchMode(null);
    setMessage({ type: 'success', text: 'Search cancelled.' });
  }

  async function doSearch(event) {
    event.preventDefault();
    setMessage(null);

    const searchKeyword = keyword.trim();
    if (!searchKeyword) {
      return setMessage({ type: 'error', text: 'Keyword required.' });
    }
    await executeKeywordSearch(searchKeyword, 'keyword');
  }

  async function executeSpecificationSearchFromKeyword(filters, searchKeyword) {
    if (!isAuthenticated()) {
      setMessage({ type: 'error', text: 'Login required for specification search.' });
      return;
    }

    const cached = getCachedSearchState(category.id);
    if (cached.controller) cached.controller.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestCategoryId = category.id;

    try {
      setLoading(true);
      setSearchMode('spec');
      setCachedSearchState(requestCategoryId, {
        keyword: searchKeyword,
        controller,
        loading: true,
        searchMode: 'spec',
        message: null
      });

      const res = await api.post('/scrape/specifications', {
        category: category.id,
        filters,
      }, { signal: controller.signal });

      const nextResults = res.data.results || [];
      const nextMessage = sanitizeSearchMessage(
        res.data.message ? { type: 'success', text: res.data.message } : null
      );

      setCachedSearchState(requestCategoryId, {
        controller: null,
        loading: false,
        searchMode: null,
        message: nextMessage
      });
      if (mountedRef.current && categoryRef.current === requestCategoryId) {
        setResults(nextResults);
        setMessage(sanitizeSearchMessage(nextMessage));
        setLoading(false);
        setSearchMode(null);
      }
      if (mountedRef.current && categoryRef.current === requestCategoryId) syncTrackedKeys();
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return;
      }
      console.error('Specification search error:', err);
      const errorMsg = getSearchErrorMessage(err, 'Could not search by specifications');
      setCachedSearchState(requestCategoryId, {
        controller: null,
        loading: false,
        searchMode: null,
        message: { type: 'error', text: errorMsg }
      });
      setMessage({ type: 'error', text: errorMsg });
      setLoading(false);
      setSearchMode(null);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  async function syncTrackedKeys() {
    if (!isAuthenticated()) return;
    try {
      const res = await api.get('/profile');
      setTrackedKeys(new Set((res.data.trackedProducts || []).map(getTrackKey)));
    } catch (err) {
      setTrackedKeys(new Set());
    }
  }

  async function trackProduct(product) {
    if (!isAuthenticated()) {
      return setMessage({ type: 'error', text: 'Login required to track products.' });
    }
    try {
      const res = await api.post('/tracked-products', { product });
      const trackedProduct = res.data.trackedProduct || product;
      updateResultWithTrackedProduct(category.id, product, trackedProduct);
      setTrackedKeys(current => new Set([...current, getTrackKey(trackedProduct)]));
      setMessage({
        type: 'success',
        text: res.data.refreshedPrice
          ? 'Product added to tracking with the latest listing price.'
          : 'Product added to tracking. Price will be checked every 10 minutes.'
      });
    } catch (err) {
      setMessage({ type: 'error', text: getSearchErrorMessage(err, 'Could not track product') });
    }
  }

  async function compareCatalogModel(model, variant = null) {
    if (!isAuthenticated()) {
      setCatalogMessage({ type: 'error', text: 'Login required to compare prices.' });
      return;
    }
    const compareKeyword = buildCompareKeyword({
      company: model.company || model.brand,
      brand: model.brand || model.company,
      modelName: variant?.compareKeyword || model.modelName || model.familyName,
      sampleTitle: variant?.sampleTitle || model.sampleTitle,
      title: variant?.sampleTitle || model.sampleTitle,
      name: variant?.sampleTitle || model.sampleTitle,
      ram: variant?.ram || model.ram,
      storage: variant?.storage || model.storage,
      core: variant?.core || model.core,
      generation: variant?.generation || model.generation,
      normalized: {
        ram: variant?.ram || model.ram,
        storage: variant?.storage || model.storage
      }
    });
    await executeKeywordSearch(compareKeyword || model.modelName || model.sampleTitle || '', 'compare');
  }

  function updateSpecFilter(field, value) {
    setSpecFilters(current => ({ ...current, [field]: value }));
  }

  function clearSpecSearch() {
    const cached = getCachedSearchState(category.id);
    if (cached.controller) cached.controller.abort();
    activeRequest.current = null;
    setSpecFilters(getDefaultSpecFilters(category.id));
    setSpecResults([]);
    setSpecUnavailableSites([]);
    setSpecMessage(null);
    setSpecLoading(false);
    setSpecSearchDone(false);
    setSpecResultSource(null);
    setCachedSearchState(category.id, {
      controller: null,
      loading: false,
      searchMode: null,
      message: null,
    });
  }

  function cancelSpecSearch() {
    const cached = getCachedSearchState(category.id);
    if (cached.controller) cached.controller.abort();
    activeRequest.current = null;
    setSpecLoading(false);
    setSpecSearchDone(false);
    setSpecResults([]);
    setSpecUnavailableSites([]);
    setSpecMessage({ type: 'success', text: 'Specification search cancelled.' });
    setSpecResultSource(null);
    setCachedSearchState(category.id, {
      controller: null,
      loading: false,
      searchMode: null,
      message: { type: 'success', text: 'Specification search cancelled.' },
    });
  }

  async function loadCatalog(companyOverride = '') {
    if (!isAuthenticated()) return;
    setCatalogLoading(true);
    setCatalogMessage(null);
    try {
      const listRes = await api.get('/catalog/models', {
        params: {
          category: category.id,
          limit: 100,
        }
      });
      const companies = listRes.data.companies || [];
      const initialCompany = companyOverride || catalogCompany || companies[0]?.company || '';
      setCatalogCompanies(companies);
      setCatalogCompany(initialCompany);
      setCatalogLoaded(true);

      if (initialCompany) {
        const modelsRes = await api.get('/catalog/models', {
          params: {
            category: category.id,
            company: initialCompany,
            limit: 100,
          }
        });
        setCatalogModels(modelsRes.data.models || []);
        deriveCatalogSpecOptions(modelsRes.data.models || []);
      } else {
        setCatalogModels([]);
      }
    } catch (err) {
      console.error('Catalog load error:', err);
      setCatalogCompanies([]);
      setCatalogModels([]);
      setCatalogLoaded(true);
      setCatalogMessage({ type: 'error', text: getSearchErrorMessage(err, 'Could not load available models') });
    } finally {
      setCatalogLoading(false);
    }
  }

  async function selectCatalogCompany(nextCompany) {
    setCatalogCompany(nextCompany);
    setCatalogMessage(null);
    // reset filters when company changes
    setSelectedRam('');
    setSelectedStorage('');
    setCatalogRamOptions([]);
    setCatalogStorageOptions([]);
    setFilteredCatalogResults([]);
    if (!nextCompany || !isAuthenticated()) {
      setCatalogModels([]);
      return;
    }

    setCatalogLoading(true);
    try {
      const res = await api.get('/catalog/models', {
        params: {
          category: category.id,
          company: nextCompany,
          limit: 100,
        }
      });
      setCatalogModels(res.data.models || []);
      setCatalogLoaded(true);
      // derive RAM/storage options from returned models
      deriveCatalogSpecOptions(res.data.models || []);
    } catch (err) {
      console.error('Company catalog error:', err);
      setCatalogModels([]);
      setCatalogRamOptions([]);
      setCatalogStorageOptions([]);
      setCatalogMessage({ type: 'error', text: getSearchErrorMessage(err, 'Could not load models for this company') });
      setCatalogLoaded(true);
    } finally {
      setCatalogLoading(false);
    }
  }

  function extractNumber(value) {
    if (!value) return null;
    const m = String(value).match(/(\d+)\s*(gb|tb)?/i);
    if (!m) return null;
    return Number(m[1]);
  }

  function normalizeRamToken(value) {
    const number = extractNumber(value);
    return number ? String(number) : '';
  }

  function normalizeStorageToken(value) {
    if (!value) return '';
    const text = String(value).toLowerCase();
    const number = extractNumber(text);
    if (!number) return '';
    return /\btb\b/i.test(text) ? `${number}tb` : String(number);
  }

  function extractVariantSpecs(model, variant) {
    const ramSource = variant?.ram || model.ram || '';
    const storageSource = variant?.storage || model.storage || '';
    if (ramSource || storageSource) {
      return {
        ram: normalizeRamToken(ramSource),
        storage: normalizeStorageToken(storageSource),
      };
    }

    const label = collapseWhitespace(variant?.label || '');
    if (!label) {
      return { ram: '', storage: '' };
    }

    const segments = label.split(/\+|\/|\\|\|/).map(part => part.trim()).filter(Boolean);
    if (segments.length >= 2) {
      return {
        ram: normalizeRamToken(segments[0]),
        storage: normalizeStorageToken(segments[1]),
      };
    }

    const specs = [...label.matchAll(/\b(\d{1,4})\s*(gb|tb)?\b/gi)].map(match => ({
      value: match[1],
      unit: String(match[2] || '').toLowerCase(),
    }));

    return {
      ram: normalizeRamToken(specs[0] ? `${specs[0].value}${specs[0].unit}` : ''),
      storage: normalizeStorageToken(specs[1] ? `${specs[1].value}${specs[1].unit}` : ''),
    };
  }

  function buildSpecCatalogMatches(models = [], filters = {}) {
    const targetRam = normalizeRamToken(filters.ram);
    const targetStorage = normalizeStorageToken(filters.storage);
    const matches = [];

    for (const model of models) {
      const variants = Array.isArray(model.variants) && model.variants.length ? model.variants : [model];
      for (const variant of variants) {
        const specs = extractVariantSpecs(model, variant);
        const modelText = collapseWhitespace([
          variant?.sampleTitle,
          model.sampleTitle,
          variant?.label,
          model.modelName,
          model.familyName
        ].filter(Boolean).join(' ')).toLowerCase();
        if (targetRam && specs.ram !== targetRam) continue;
        if (targetStorage && specs.storage !== targetStorage) continue;
        matches.push({
          model,
          variant,
          product: buildCatalogDisplayProduct(model, variant)
        });
      }
    }

    return matches;
  }

  function deriveCatalogSpecOptions(models = []) {
    const ramSet = new Set();
    const storageSet = new Set();
    for (const model of models) {
      // model-level fields
      if (model.ram) ramSet.add(String(model.ram).trim());
      if (model.storage) storageSet.add(String(model.storage).trim());
      // variants
      if (Array.isArray(model.variants)) {
        for (const v of model.variants) {
          if (v.ram) ramSet.add(String(v.ram).trim());
          if (v.storage) storageSet.add(String(v.storage).trim());
          if (v.label) {
            // try to parse labels like '4GB / 64GB' or '4GB RAM + 64GB'
            const parts = String(v.label).split(/\+|\/|\\|\|/).map(s => s.trim());
            for (const p of parts) {
              if (/gb/i.test(p) || /tb/i.test(p)) {
                if (/ram/i.test(p)) ramSet.add(p);
                else storageSet.add(p);
              }
            }
          }
        }
      }
    }
    const ramOptions = [...ramSet].filter(Boolean).sort((a,b)=> extractNumber(a) - extractNumber(b));
    const storageOptions = [...storageSet].filter(Boolean).sort((a,b)=> extractNumber(a) - extractNumber(b));
    setCatalogRamOptions(ramOptions);
    setCatalogStorageOptions(storageOptions);
  }

  function buildDisplayKey(model, variant) {
    const brand = (model.company || catalogCompany || '').toString().toLowerCase();
    const name = (model.modelName || '').toString().toLowerCase();
    const ramVal = variant?.ram || model.ram || variant?.label || '';
    const storageVal = variant?.storage || model.storage || variant?.label || '';
    const ramNum = extractNumber(ramVal) || '';
    const storageNum = extractNumber(storageVal) || '';
    return [brand, name, ramNum, storageNum].filter(Boolean).join(' ');
  }

  function buildCatalogDisplayProduct(model, variant) {
    const company = model.company || catalogCompany || '';
    const modelName = model.modelName || model.familyName || 'Model';
    const label = variant?.label || [variant?.ram || model.ram, variant?.storage || model.storage].filter(Boolean).join(' / ');
    const title = variant?.sampleTitle || model.sampleTitle || [company, modelName, label].filter(Boolean).join(' ');
    const specs = [variant?.ram || model.ram, variant?.storage || model.storage, variant?.core || model.core, variant?.generation || model.generation]
      .filter(Boolean)
      .join(' | ');
    return {
      _id: variant?.variantKey || model.familyKey || model.modelKey || `${modelName}-${label || 'default'}`,
      title: title || modelName,
      price: variant?.samplePrice || model.samplePrice || '',
      image: model.sampleImage || '',
      link: variant?.sampleLink || model.sampleLink || '#',
      site: variant?.sampleSite || model.sampleSite || company || 'Catalog',
      displayLink: variant?.sampleSite || model.sampleSite || company || 'Catalog',
      snippet: specs,
      specs,
      modelName,
      normalized: {
        price: variant?.samplePrice || model.samplePrice || '',
        priceValue: null,
        description: specs,
        storage: variant?.storage || model.storage || null,
        ram: variant?.ram || model.ram || null,
      },
      sampleTitle: title || modelName,
    };
  }

  function buildCompareKeyword(product = {}) {
    const modelName = deriveCompareModelName(product, '');
    const ram = formatCompactSpecValue(product.normalized?.ram || product.ram);
    const storage = formatCompactSpecValue(product.normalized?.storage || product.storage);
    const core = category.id === 'laptops'
      ? collapseWhitespace(String(product.core || '').toLowerCase())
          .match(/\b(?:core\s*)?(i[3579]|[3579]|ryzen\s*[3579])\b/i)?.[1]?.replace(/\s+/g, ' ')
        || ''
      : '';
    const generation = category.id === 'laptops'
      ? collapseWhitespace(String(product.generation || '').toLowerCase())
          .match(/\b(\d{1,2}(?:st|nd|rd|th))(?:\s*gen)?\b/i)?.[1] || ''
      : '';
    const parts = [modelName, ram, storage, core, generation]
      .filter(Boolean)
      .map(value => collapseWhitespace(value).toLowerCase());
    const keyword = [];
    const seen = new Set();
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      keyword.push(part);
    }
    return keyword.join(' ').trim();
  }

  function applyCatalogFilters() {
    const results = [];
    const selectedRamToken = normalizeRamToken(selectedRam);
    const selectedStorageToken = normalizeStorageToken(selectedStorage);
    for (const model of catalogModels) {
      if (Array.isArray(model.variants) && model.variants.length) {
        for (const v of model.variants) {
          const specs = extractVariantSpecs(model, v);
          const matchesRam = !selectedRamToken || specs.ram === selectedRamToken;
          const matchesStorage = !selectedStorageToken || specs.storage === selectedStorageToken;
          if (matchesRam && matchesStorage) results.push({ model, variant: v, score: 1 });
        }
      } else {
        const specs = extractVariantSpecs(model, model);
        const matchesRam = !selectedRamToken || specs.ram === selectedRamToken;
        const matchesStorage = !selectedStorageToken || specs.storage === selectedStorageToken;
        if (matchesRam && matchesStorage) results.push({ model, variant: model, score: 1 });
      }
    }
    setFilteredCatalogResults(results);
  }

  async function executeKeywordSearch(searchKeyword, searchModeValue = 'keyword') {
    const trimmedKeyword = String(searchKeyword || '').trim();
    if (!trimmedKeyword) {
      setMessage({ type: 'error', text: 'Keyword required.' });
      return;
    }

    const cached = getCachedSearchState(category.id);
    if (cached.controller) cached.controller.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestCategoryId = category.id;

    try {
      setSpecSearchDone(false);
      setSpecResults([]);
      setSpecUnavailableSites([]);
      setSpecMessage(null);
      setSpecLoading(false);
      setSpecResultSource(null);
      setKeyword(trimmedKeyword);
      setCachedSearchState(requestCategoryId, {
        keyword: trimmedKeyword,
        controller,
        loading: true,
        searchMode: searchModeValue,
        results: [],
        message: null
      });
      const res = await api.post('/scrape', {
        keyword: trimmedKeyword,
        category: category.id
      }, { signal: controller.signal });

      const nextResults = res.data.results || [];
      const nextMessage = sanitizeSearchMessage(
        res.data.message ? { type: 'success', text: res.data.message } : null
      );

      setCachedSearchState(requestCategoryId, {
        controller: null,
        loading: false,
        searchMode: null,
        results: nextResults,
        message: nextMessage
      });
      if (mountedRef.current && categoryRef.current === requestCategoryId) {
        setResults(nextResults);
        setMessage(sanitizeSearchMessage(nextMessage));
        setLoading(false);
        setSearchMode(null);
      }
      if (mountedRef.current && categoryRef.current === requestCategoryId) syncTrackedKeys();
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return;
      }
      console.error('Search error:', err);
      const errorMsg = getSearchErrorMessage(err);
      setCachedSearchState(requestCategoryId, {
        controller: null,
        loading: false,
        searchMode: null,
        message: { type: 'error', text: errorMsg }
      });
      setMessage({ type: 'error', text: errorMsg });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  async function doSpecSearch(event) {
    event.preventDefault();
    if (!isAuthenticated()) {
      setSpecMessage({ type: 'error', text: 'Login required for specification search.' });
      return;
    }
    if (!specFilters.company.trim()) {
      setSpecMessage({ type: 'error', text: 'Choose a company first.' });
      return;
    }
    if (!specFilters.ram.trim() && !specFilters.storage.trim() && !specFilters.core.trim() && !specFilters.generation.trim()) {
      setSpecMessage({ type: 'error', text: 'Enter at least one spec value to search.' });
      return;
    }

    const cached = getCachedSearchState(category.id);
    if (cached.controller) cached.controller.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestCategoryId = category.id;

    try {
      setSpecLoading(true);
      setSpecSearchDone(true);
      setSpecResultSource(null);
      setSpecMessage(null);
      setCachedSearchState(requestCategoryId, {
        controller,
        loading: true,
        searchMode: 'spec',
        results: [],
        message: null
      });

      const res = await api.post('/scrape/specifications', {
        category: category.id,
        filters: specFilters,
      }, { signal: controller.signal });

      const nextResults = res.data.results || [];
      const nextMessage = sanitizeSearchMessage(
        res.data.message ? { type: 'success', text: res.data.message } : null
      );

      setSpecResults(nextResults);
      setSpecResultSource('internet');
      setSpecMessage(sanitizeSearchMessage(nextMessage));
      setCachedSearchState(requestCategoryId, {
        controller: null,
        loading: false,
        searchMode: null,
        results: nextResults,
        message: nextMessage
      });
    } catch (err) {
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return;
      }
      console.error('Specification search error:', err);
      const errorMsg = getSearchErrorMessage(err, 'Could not search by specifications');
      setSpecResultSource(null);
      setSpecMessage({ type: 'error', text: errorMsg });
      setCachedSearchState(requestCategoryId, {
        controller: null,
        loading: false,
        searchMode: null,
        message: { type: 'error', text: errorMsg }
      });
    } finally {
      setSpecLoading(false);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  function updateResultWithTrackedProduct(categoryId, originalProduct, trackedProduct) {
    const cached = getCachedSearchState(categoryId);
    const originalKey = getTrackKey(originalProduct);
    const trackedKey = getTrackKey(trackedProduct);
    const nextResults = cached.results.map(item => {
      const itemKey = getTrackKey(item);
      if (itemKey !== originalKey && itemKey !== trackedKey) return item;
      return toSearchResultProduct(item, trackedProduct);
    });

    setCachedSearchState(categoryId, { results: nextResults });
  }

  return (
    <div className="container">
      <div className="category-page-header">
        <div>
          <Link to="/" className="back-link">Back to categories</Link>
          <h1>{category.label}</h1>
          <p>{category.description}</p>
        </div>
        <div className="category-depth-panel" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <section className="catalog-section active search-workspace">
        <div className="catalog-section-header">
          <div>
            <h3>Search {category.label}</h3>
            <p>Results from this page are saved to Profile when you are logged in.</p>
          </div>
          <span>{specSearchDone ? visibleSpecResults.length : visibleResults.length} results</span>
        </div>

        <form onSubmit={doSearch} className="search-form category-search-form search-hero-form">
          <input
            value={keyword}
            onChange={event => {
              const nextKeyword = event.target.value;
              setKeyword(nextKeyword);
              setCachedSearchState(category.id, { keyword: nextKeyword });
            }}
            placeholder={category.placeholder}
            disabled={loading}
          />
          <button className="login-btn" style={{ width: 120 }} type="submit" disabled={loading}>
            {loading && searchMode === 'keyword' ? 'Searching...' : 'Search'}
          </button>
          {loading && searchMode === 'keyword' && (
            <button type="button" className="cancel-search-btn inline" onClick={cancelSearch}>
              Cancel
            </button>
          )}
        </form>

        {loading && (
          <div className="category-loading">
            <div className="loading-bar"></div>
          </div>
        )}

        {message && <div className={`message ${message.type === 'error' ? 'error' : 'success'}`}>{message.text}</div>}
        {specSearchDone ? (
          <div className="model-browser-note spec-search-note">
            <strong>Spec results are shown below</strong>
            <span>Only one result list is visible at a time. Use the spec search controls to cancel or clear this search.</span>
          </div>
        ) : results.length > 0 ? (
          <div className="results category-results">
            {visibleResults.map((product, index) => (
              <ProductCard
                key={product._id || product.link || index}
                p={product}
                isBest={cheapestPrice !== null && getPriceValue(product) === cheapestPrice}
                onTrack={isAuthenticated() ? trackProduct : null}
                trackLabel={trackedKeys.has(getTrackKey(product)) ? 'Tracking' : 'Track price'}
                trackDisabled={trackedKeys.has(getTrackKey(product))}
                compactCompareView={searchMode === 'compare'}
              />
            ))}
          </div>
        ) : (
          <div className="empty category-empty">
            <h2>No results yet</h2>
            <p>Search this category to compare product prices.</p>
          </div>
        )}
      </section>

      {supportsSpecSearch && (
        <section className="catalog-section spec-search-section">
          <div className="catalog-section-header">
            <div>
              <h3>Search by Specs</h3>
              <p>Type any company name, then add RAM or storage. The suggestions are optional.</p>
            </div>
          </div>

          {!isAuthenticated() ? (
            <div className="spec-lock-card">
              <h4>Login required</h4>
              <p>Specification search is available to logged-in members only.</p>
              <Link to="/login" className="login-btn spec-login-link">Log in</Link>
            </div>
          ) : (
            <>
              <form onSubmit={doSpecSearch} className="spec-search-form">
                <div className="spec-search-grid">
                  <label className="spec-field model-company-field">
                    <span>Company</span>
                    <input
                      list={specCompanyListId}
                      value={specFilters.company}
                      onChange={event => updateSpecFilter('company', event.target.value)}
                      placeholder="Type any company name"
                      disabled={specLoading}
                    />
                    <datalist id={specCompanyListId}>
                      {getSpecCompanyOptions(categoryId).map(option => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </label>

                  <label className="spec-field">
                    <span>RAM</span>
                    <input
                      list={specRamListId}
                      value={specFilters.ram}
                      onChange={event => updateSpecFilter('ram', event.target.value)}
                      placeholder="e.g. 6GB RAM or 24GB RAM"
                      disabled={specLoading}
                    />
                    <datalist id={specRamListId}>
                      {getSpecRamOptions(categoryId).map(option => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </label>

                  <label className="spec-field">
                    <span>Storage / ROM</span>
                    <input
                      list={specStorageListId}
                      value={specFilters.storage}
                      onChange={event => updateSpecFilter('storage', event.target.value)}
                      placeholder="e.g. 128GB or 1024GB"
                      disabled={specLoading}
                    />
                    <datalist id={specStorageListId}>
                      {getSpecStorageOptions(categoryId).map(option => (
                        <option key={option} value={option} />
                      ))}
                      </datalist>
                  </label>

                  {categoryId === 'laptops' && (
                    <>
                      <label className="spec-field">
                        <span>Core</span>
                        <input
                          list={specCoreListId}
                          value={specFilters.core}
                          onChange={event => updateSpecFilter('core', event.target.value)}
                          placeholder="e.g. Core i5 or Ryzen 5"
                          disabled={specLoading}
                        />
                        <datalist id={specCoreListId}>
                          {laptopCoreOptions.map(option => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      </label>

                      <label className="spec-field">
                        <span>Generation</span>
                        <input
                          list={specGenerationListId}
                          value={specFilters.generation}
                          onChange={event => updateSpecFilter('generation', event.target.value)}
                          placeholder="e.g. 12th Gen"
                          disabled={specLoading}
                        />
                        <datalist id={specGenerationListId}>
                          {laptopGenerationOptions.map(option => (
                            <option key={option} value={option} />
                          ))}
                        </datalist>
                      </label>
                    </>
                  )}
                </div>

                <div className="spec-search-actions">
                  <button className="login-btn" style={{ width: 160 }} type="submit" disabled={specLoading}>
                    {specLoading ? 'Searching...' : 'Search models'}
                  </button>
                  <button
                    type="button"
                    className="cancel-search-btn inline"
                    onClick={specLoading ? cancelSpecSearch : clearSpecSearch}
                  >
                    {specLoading ? 'Cancel search' : 'Clear search'}
                  </button>
                </div>
              </form>

              {specLoading && (
                <div className="category-loading">
                  <div className="loading-bar"></div>
                </div>
              )}

              {specMessage && <div className={`message ${specMessage.type === 'error' ? 'error' : 'success'}`}>{specMessage.text}</div>}
              {specSearchDone ? (
                visibleSpecResults.length > 0 ? (
                  <div className="results category-results">
                    {visibleSpecResults.map((product, index) => (
                      <ProductCard
                        key={product._id || product.link || index}
                        p={product}
                        isBest={specCheapestPrice !== null && getPriceValue(product) === specCheapestPrice}
                        onCompare={() => executeKeywordSearch(buildCompareKeyword(product) || product.title || '', 'compare')}
                        compareLabel="Compare prices"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty category-empty">
                    <h2>No spec matches yet</h2>
                    <p>Try a different RAM or storage value, or choose a broader company.</p>
                  </div>
                )
              ) : null}
            </>
          )}
        </section>
      )}

    </div>
  );
}

function getPriceValue(product) {
  const value = product?.normalized?.priceValue;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function toSearchResultProduct(originalProduct, trackedProduct) {
  const price = trackedProduct.currentPrice || trackedProduct.price || originalProduct.price;
  const priceValue = trackedProduct.currentPriceValue || trackedProduct.normalized?.priceValue || originalProduct.normalized?.priceValue;
  return {
    ...originalProduct,
    ...trackedProduct,
    _id: originalProduct._id,
    position: originalProduct.position,
    modelKey: originalProduct.modelKey,
    modelName: originalProduct.modelName,
    modelBestPrice: originalProduct.modelBestPrice,
    modelOfferRank: originalProduct.modelOfferRank,
    isBestModelOffer: originalProduct.isBestModelOffer,
    price,
    normalized: {
      ...(originalProduct.normalized || {}),
      ...(trackedProduct.normalized || {}),
      price,
      priceValue
    }
  };
}

function getTrackKey(product) {
  const link = product?.link ? String(product.link).replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase() : '';
  if (link) return link;
  return `${product?.site || ''}|${product?.title || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getCheapestPrice(products) {
  const prices = products.map(getPriceValue).filter(value => value !== null);
  return prices.length ? Math.min(...prices) : null;
}

function sortProductsByPrice(products) {
  if (products.some(product => product.modelKey)) {
    return [...products].sort((a, b) => {
      const bestA = Number.isFinite(a.modelBestPrice) && a.modelBestPrice > 0 ? a.modelBestPrice : Number.POSITIVE_INFINITY;
      const bestB = Number.isFinite(b.modelBestPrice) && b.modelBestPrice > 0 ? b.modelBestPrice : Number.POSITIVE_INFINITY;
      if (bestA !== bestB) return bestA - bestB;
      const modelCompare = String(a.modelName || '').localeCompare(String(b.modelName || ''));
      if (modelCompare) return modelCompare;
      const rankA = Number.isFinite(a.modelOfferRank) ? a.modelOfferRank : Number.POSITIVE_INFINITY;
      const rankB = Number.isFinite(b.modelOfferRank) ? b.modelOfferRank : Number.POSITIVE_INFINITY;
      if (rankA !== rankB) return rankA - rankB;
      return (getPriceValue(a) || Number.POSITIVE_INFINITY) - (getPriceValue(b) || Number.POSITIVE_INFINITY);
    });
  }
  return [...products].sort((a, b) => {
    const priceA = getPriceValue(a);
    const priceB = getPriceValue(b);
    if (priceA === null && priceB === null) return 0;
    if (priceA === null) return 1;
    if (priceB === null) return -1;
    return priceA - priceB;
  });
}

function getSearchErrorMessage(err, fallback = 'Search failed') {
  const serverMessage = err?.response?.data?.message || err?.response?.data?.error;
  if (serverMessage) return serverMessage;
  if (err?.code === 'ECONNABORTED') return 'Search took too long. I extended the timeout, but this result group may still be slow. Try a narrower keyword.';
  if (err?.message === 'Network Error') return 'Cannot reach the backend API. Make sure the backend is running on http://localhost:3100 and refresh the page.';
  return err?.message || fallback;
}

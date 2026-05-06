require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const fetch = global.fetch || require('node-fetch');
const { NseIndia } = require('stock-nse-india-secure');

const app = express();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminSetupToken = process.env.ADMIN_SETUP_TOKEN;
const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const nseIndia = new NseIndia();

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  })
  : null;

const symbolsPath = path.join(__dirname, 'data', 'nifty500.json');
let niftySymbols = [];
try {
  const raw = fs.readFileSync(symbolsPath, 'utf8');
  niftySymbols = JSON.parse(raw);
} catch (error) {
  console.warn('Failed to load nifty500 symbols list.', error.message);
}

const MOMENTUM_TTL_MS = 6 * 60 * 60 * 1000;
const MOMENTUM_FETCH_LIMIT = 10;
const MOMENTUM_DEFAULT_LIMIT = 15;
const momentumCache = new Map();
let momentumCursor = 0;
let lastMomentumSnapshot = null;
const YAHOO_TTL_MS = 30 * 60 * 1000;
const GEMINI_TTL_MS = 30 * 60 * 1000;
const AI_BATCH_SIZE = 50;
const AI_RESULT_LIMIT = 10;
const yahooSeriesCache = new Map();
const yahooFundamentalsCache = new Map();
const geminiIntentCache = new Map();
const geminiSummaryCache = new Map();
let aiCursor = 0;

app.use(cors()); // ⭐ IMPORTANT
app.use(express.json());

const getUserIdFromRequest = (req) => {
  const raw = req.headers['x-user-id'];
  if (!raw) return null;
  return Number(raw);
};

const getUserById = async (userId) => {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const requireSupabase = (req, res, next) => {
  if (!supabase) {
    return res.status(500).json({
      error: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    });
  }
  return next();
};

const requireUser = async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: 'Missing x-user-id header.' });
    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: 'Invalid user.' });
    req.user = user;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const requireAdmin = async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: 'Missing x-user-id header.' });
    const user = await getUserById(userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const parseDailySeries = (series) => {
  if (Array.isArray(series)) {
    return series
      .map((row) => ({
        date: row.datetime || row.CH_TIMESTAMP || row.date,
        close: Number(row.close || row.CH_CLOSING_PRICE || row.closePrice),
        high: Number(row.high || row.CH_TRADE_HIGH_PRICE || row.highPrice),
        volume: Number(row.volume || row.CH_TOT_TRADED_QTY || row.volumeTraded),
      }))
      .filter((row) => Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.volume))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  return Object.entries(series)
    .map(([date, row]) => ({
      date,
      close: Number(row['5. adjusted close'] || row['4. close']),
      high: Number(row['2. high']),
      volume: Number(row['6. volume'] || row['5. volume']),
    }))
    .filter((row) => Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.volume))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
};

const toYahooSymbol = (symbol) => {
  if (!symbol) return '';
  const trimmed = symbol.trim();
  if (trimmed.startsWith('^')) return trimmed;
  if (trimmed.endsWith('.NS') || trimmed.endsWith('.BO')) return trimmed;
  const cleanSymbol = trimmed.split('.')[0].trim();
  return `${cleanSymbol}.NS`;
};

const normalizeQuery = (query) => query.trim().toLowerCase().replace(/\s+/g, ' ');

const getCachedGemini = (cache, key) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < GEMINI_TTL_MS) {
    return cached.value;
  }
  return null;
};

const setCachedGemini = (cache, key, value) => {
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
};

const normalizeGeminiSymbol = (symbol) => {
  if (!symbol) return null;
  const cleaned = String(symbol).toUpperCase().replace(/\s+/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('^')) return cleaned;
  if (cleaned.endsWith('.NS')) return `${cleaned.slice(0, -3)}.NSE`;
  if (cleaned.endsWith('.BO')) return `${cleaned.slice(0, -3)}.BSE`;
  if (cleaned.endsWith('.NSE') || cleaned.endsWith('.BSE')) return cleaned;
  if (/^[A-Z0-9]{1,12}$/.test(cleaned)) return `${cleaned}.NSE`;
  return null;
};

const extractJsonObject = (text) => {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const chunk = text.slice(start, end + 1);
  try {
    return JSON.parse(chunk);
  } catch (error) {
    return null;
  }
};

const callGemini = async (prompt) => {
  if (!GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256,
      },
    }),
  });

  if (!res.ok) return null;
  const payload = await res.json();
  const parts = payload && payload.candidates && payload.candidates[0]
    && payload.candidates[0].content && Array.isArray(payload.candidates[0].content.parts)
    ? payload.candidates[0].content.parts
    : [];
  const text = parts.map((part) => part.text || '').join('').trim();
  return text || null;
};

const GEMINI_INTENTS = new Set([
  'price', 'high_low', 'high_low_month', 'high_52w', 'low_52w', 'volume', 'volume_chart',
  'chart', 'historical', 'news', 'sector', 'compare', 'market_cap', 'pe', 'fundamentals',
  'gainers', 'losers', 'cheap', 'index', 'all_time_high', 'return_1m', 'investment',
  'missing_symbol', 'unsupported',
]);

const getGeminiIntent = async (query) => {
  const cacheKey = normalizeQuery(query);
  const cached = getCachedGemini(geminiIntentCache, cacheKey);
  if (cached) return cached;

  const prompt = [
    'You detect stock intent and symbols for an Indian market finance assistant.',
    'Return ONLY valid JSON with keys: intent, symbols, confidence, language.',
    'intent must be one of:',
    Array.from(GEMINI_INTENTS).join(', '),
    'symbols should be Yahoo/NSE-style tickers like RELIANCE.NSE, TCS.NSE, ^NSEI.',
    'If no symbol is present, return symbols as an empty array.',
    'language should be en, hi, or mixed.',
    `User query: ${query}`,
  ].join('\n');

  const text = await callGemini(prompt);
  const parsed = extractJsonObject(text);
  if (!parsed || !parsed.intent || !GEMINI_INTENTS.has(String(parsed.intent).toLowerCase())) {
    return null;
  }

  const symbols = Array.isArray(parsed.symbols)
    ? parsed.symbols.map(normalizeGeminiSymbol).filter(Boolean)
    : [];

  const result = {
    intent: String(parsed.intent).toLowerCase(),
    symbols,
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
    language: parsed.language ? String(parsed.language).toLowerCase() : null,
  };

  return setCachedGemini(geminiIntentCache, cacheKey, result);
};

const trimGeminiPayload = (payload) => {
  const trimmed = { ...payload };
  if (Array.isArray(trimmed.series)) trimmed.series = trimmed.series.slice(-3);
  if (Array.isArray(trimmed.chart)) trimmed.chart = trimmed.chart.slice(-3);
  if (Array.isArray(trimmed.results)) trimmed.results = trimmed.results.slice(0, 5);
  if (Array.isArray(trimmed.rows)) trimmed.rows = trimmed.rows.slice(0, 2);
  return trimmed;
};

const getGeminiSummary = async (query, payload) => {
  if (!GEMINI_API_KEY) return null;
  const cacheKey = `${normalizeQuery(query)}|${payload.intent || ''}|${payload.symbol || ''}`;
  const cached = getCachedGemini(geminiSummaryCache, cacheKey);
  if (cached) return cached;

  const safePayload = trimGeminiPayload(payload);
  const prompt = [
    'You are a finance assistant. Summarize the data for the user in 1-3 short sentences.',
    'Do not give investment advice. Keep it factual and concise.',
    `User query: ${query}`,
    `Data (JSON): ${JSON.stringify(safePayload)}`,
  ].join('\n');

  const text = await callGemini(prompt);
  if (!text) return null;
  return setCachedGemini(geminiSummaryCache, cacheKey, text.trim());
};

const resolveYahooTicker = async (query) => {
  const params = new URLSearchParams({
    q: query,
    quotesCount: '1',
    newsCount: '0',
    enableFuzzyQuery: 'true',
    region: 'IN',
    lang: 'en-IN',
  });
  const url = `https://query2.finance.yahoo.com/v1/finance/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  const payload = await res.json();

  if (!res.ok) {
    return null;
  }

  const quote = payload && Array.isArray(payload.quotes) ? payload.quotes[0] : null;
  if (!quote || !quote.symbol) return null;
  return quote.symbol;
};

const fetchYahooSeries = async (symbol, range = '2y') => {
  const yahooSymbol = toYahooSymbol(symbol);
  const params = new URLSearchParams({
    interval: '1d',
    range,
    includePrePost: 'false',
    events: 'div,splits',
  });
  const fetchSeries = async (ticker) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const payload = await res.json();
    return { res, payload };
  };

  let { res, payload } = await fetchSeries(yahooSymbol);

  if (!res.ok && res.status === 404 && yahooSymbol.endsWith('.NS')) {
    const fallbackSymbol = yahooSymbol.replace(/\.NS$/, '.BO');
    ({ res, payload } = await fetchSeries(fallbackSymbol));
  }

  if (!res.ok && res.status === 404) {
    const baseQuery = symbol.split('.')[0].trim();
    const resolved = await resolveYahooTicker(baseQuery || symbol);
    if (resolved) {
      ({ res, payload } = await fetchSeries(resolved));
    }
  }

  if (!res.ok) {
    throw new Error(`Yahoo request failed with status ${res.status}`);
  }

  const result = payload && payload.chart && Array.isArray(payload.chart.result)
    ? payload.chart.result[0]
    : null;
  if (!result || !Array.isArray(result.timestamp)) {
    throw new Error('Yahoo response missing series data.');
  }

  const quote = result.indicators && Array.isArray(result.indicators.quote)
    ? result.indicators.quote[0]
    : null;
  if (!quote || !Array.isArray(quote.close)) {
    throw new Error('Yahoo response missing quote data.');
  }

  const entries = result.timestamp.map((ts, idx) => ({
    date: new Date(ts * 1000).toISOString(),
    close: Number(quote.close[idx]),
    high: Number(quote.high && quote.high[idx]),
    low: Number(quote.low && quote.low[idx]),
    volume: Number(quote.volume && quote.volume[idx]),
  }));

  return entries
    .filter((row) => Number.isFinite(row.close) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.volume))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
};

const getRawValue = (value) => {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'raw')) {
    return value.raw;
  }
  return value;
};

const fetchYahooFundamentals = async (symbol) => {
  const yahooSymbol = toYahooSymbol(symbol);
  const modules = 'summaryDetail,financialData,defaultKeyStatistics,calendarEvents';
  const fetchFundamentals = async (ticker) => {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}`;
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    const payload = await res.json();
    return { res, payload };
  };

  let { res, payload } = await fetchFundamentals(yahooSymbol);

  if (!res.ok && res.status === 404 && yahooSymbol.endsWith('.NS')) {
    const fallbackSymbol = yahooSymbol.replace(/\.NS$/, '.BO');
    ({ res, payload } = await fetchFundamentals(fallbackSymbol));
  }

  if (!res.ok && res.status === 404) {
    const baseQuery = symbol.split('.')[0].trim();
    const resolved = await resolveYahooTicker(baseQuery || symbol);
    if (resolved) {
      ({ res, payload } = await fetchFundamentals(resolved));
    }
  }

  if (!res.ok) {
    throw new Error(`Yahoo fundamentals failed with status ${res.status}`);
  }

  const result = payload && payload.quoteSummary && Array.isArray(payload.quoteSummary.result)
    ? payload.quoteSummary.result[0]
    : null;
  if (!result) {
    throw new Error('Yahoo fundamentals missing data.');
  }

  const summary = result.summaryDetail || {};
  const financial = result.financialData || {};
  const stats = result.defaultKeyStatistics || {};
  const calendar = result.calendarEvents || {};
  const dividend = calendar.dividendDate || {};

  return {
    price: getRawValue(summary.regularMarketPrice),
    pe: getRawValue(summary.trailingPE) ?? getRawValue(stats.trailingPE),
    debtToEquity: getRawValue(financial.debtToEquity),
    marketCap: getRawValue(summary.marketCap) ?? getRawValue(stats.marketCap),
    dividendRate: getRawValue(summary.dividendRate),
    dividendYield: getRawValue(summary.dividendYield),
    exDividendDate: getRawValue(summary.exDividendDate) ?? getRawValue(dividend),
  };
};

const getYahooSeries = async (symbol) => {
  const cached = yahooSeriesCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < YAHOO_TTL_MS) {
    return cached.entries;
  }
  const entries = await fetchYahooSeries(symbol);
  yahooSeriesCache.set(symbol, { entries, fetchedAt: Date.now() });
  return entries;
};

const getYahooFundamentals = async (symbol) => {
  const cached = yahooFundamentalsCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < YAHOO_TTL_MS) {
    return cached.data;
  }
  const data = await fetchYahooFundamentals(symbol);
  yahooFundamentalsCache.set(symbol, { data, fetchedAt: Date.now() });
  return data;
};

const fetchYahooMovers = async (type) => {
  const scrId = type === 'gainers' ? 'day_gainers' : 'day_losers';
  const params = new URLSearchParams({
    count: '10',
    region: 'IN',
    lang: 'en-IN',
    scrIds: scrId,
  });
  const url = `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  const payload = await res.json();

  if (!res.ok) {
    throw new Error(`Yahoo movers failed with status ${res.status}`);
  }

  const quotes = payload && payload.finance && payload.finance.result
    && Array.isArray(payload.finance.result) && payload.finance.result[0]
    ? payload.finance.result[0].quotes
    : null;
  if (!Array.isArray(quotes)) {
    throw new Error('Yahoo movers missing data.');
  }

  return quotes.map((row) => ({
    symbol: row.symbol,
    name: row.shortName || row.longName || row.symbol,
    price: row.regularMarketPrice,
    changePercent: row.regularMarketChangePercent,
  }));
};

const fetchYahooMostActive = async () => {
  const params = new URLSearchParams({
    count: '10',
    region: 'IN',
    lang: 'en-IN',
    scrIds: 'most_actives',
  });
  const url = `https://query2.finance.yahoo.com/v1/finance/screener/predefined/saved?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  const payload = await res.json();

  if (!res.ok) {
    throw new Error(`Yahoo most actives failed with status ${res.status}`);
  }

  const quotes = payload && payload.finance && payload.finance.result
    && Array.isArray(payload.finance.result) && payload.finance.result[0]
    ? payload.finance.result[0].quotes
    : null;
  if (!Array.isArray(quotes)) {
    throw new Error('Yahoo most actives missing data.');
  }

  return quotes.map((row) => ({
    symbol: row.symbol,
    name: row.shortName || row.longName || row.symbol,
    price: row.regularMarketPrice,
    volume: row.regularMarketVolume,
  }));
};

const fetchYahooNews = async (query) => {
  const params = new URLSearchParams({
    q: query,
    newsCount: '6',
    quotesCount: '0',
    enableFuzzyQuery: 'true',
    region: 'IN',
    lang: 'en-IN',
  });
  const url = `https://query2.finance.yahoo.com/v1/finance/search?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  const payload = await res.json();

  if (!res.ok) {
    throw new Error(`Yahoo news failed with status ${res.status}`);
  }

  const news = payload && Array.isArray(payload.news) ? payload.news : [];
  return news.map((item) => ({
    title: item.title,
    publisher: item.publisher,
    link: item.link,
    publishedAt: item.providerPublishTime,
  }));
};

const scanCheapStocks = async (maxFetch = AI_BATCH_SIZE, limit = AI_RESULT_LIMIT) => {
  const symbols = Array.isArray(niftySymbols) ? niftySymbols : [];
  let fetchedCount = 0;
  let scannedCount = 0;
  let errorCount = 0;
  const errorSamples = [];
  const results = [];
  const startedAt = Date.now();
  const maxRuntimeMs = 30000;

  for (let i = 0; i < symbols.length; i += 1) {
    if (Date.now() - startedAt > maxRuntimeMs) break;
    if (fetchedCount >= maxFetch) break;

    const symbol = symbols[(aiCursor + i) % symbols.length];
    scannedCount += 1;

    try {
      const entries = await getYahooSeries(symbol);
      fetchedCount += 1;
      const latest = entries[entries.length - 1];
      if (latest && Number(latest.close) <= 100) {
        results.push({
          symbol,
          price: latest.close,
        });
      }
    } catch (error) {
      errorCount += 1;
      if (errorSamples.length < 5) {
        errorSamples.push({ symbol, error: error.message });
      }
    }
  }

  aiCursor = (aiCursor + scannedCount) % symbols.length;

  return {
    results: results.slice(0, limit),
    fetchedCount,
    scannedCount,
    errorCount,
    errorSamples,
  };
};

const fetchNseSeries = async (symbol) => {
  const cleanSymbol = symbol.split('.')[0];
  const range = {
    start: new Date(Date.now() - 420 * 24 * 60 * 60 * 1000),
    end: new Date(),
  };
  const timeoutMs = 20000;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const data = await Promise.race([
        nseIndia.getEquityHistoricalData(cleanSymbol, range),
        new Promise((_, reject) => setTimeout(() => reject(new Error('NSE request timed out.')), timeoutMs)),
      ]);
      if (!Array.isArray(data)) {
        throw new Error('Missing time series data.');
      }
      return data;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }

  try {
    return await fetchYahooSeries(symbol);
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error('NSE request failed.');
};

const average = (values) => {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
};

const computeMomentumSnapshot = (symbol, entries) => {
  if (entries.length < 210) return null;

  const closes = entries.map((row) => row.close);
  const highs = entries.map((row) => row.high);
  const volumes = entries.map((row) => row.volume);

  const price = closes[0];
  const ma50 = average(closes.slice(0, 50));
  const ma200 = average(closes.slice(0, 200));
  const high52 = Math.max(...highs.slice(0, 252));
  const highestHigh20 = Math.max(...highs.slice(1, 21));
  const avgVolume20 = average(volumes.slice(1, 21));
  const volume = volumes[0];
  const return3m = closes[63] ? (price / closes[63] - 1) : null;
  const volumeRatio = avgVolume20 ? volume / avgVolume20 : 0;

  const passes = price > ma50
    && price >= 0.8 * high52
    && price >= highestHigh20 * 0.95
    && volume > 1.05 * avgVolume20
    && return3m !== null
    && return3m > 0.03;

  return {
    symbol,
    price,
    ma50,
    ma200,
    high_52_week: high52,
    highest_high_20: highestHigh20,
    avg_volume_20: avgVolume20,
    volume,
    volume_ratio: volumeRatio,
    return_3_month: return3m,
    passes,
  };
};

const computeMomentum3mHighSnapshot = (symbol, entries) => {
  if (entries.length < 70) return null;

  const recent = entries.slice(-63);
  const latest = recent[recent.length - 1];
  if (!latest) return null;

  const closes = recent.map((row) => row.close);
  const high3m = Math.max(...closes);
  const price = latest.close;
  const startClose = recent[0] ? recent[0].close : null;
  const return3m = startClose ? (price / startClose - 1) : null;
  const volume = latest.volume;

  if (!Number.isFinite(price) || !Number.isFinite(high3m)) return null;

  const passes = price >= high3m * 0.999;

  return {
    symbol,
    price,
    high_3_month: high3m,
    return_3_month: return3m,
    volume,
    passes,
  };
};

const STOCK_ALIASES = {
  'reliance': 'RELIANCE.NSE',
  'tcs': 'TCS.NSE',
  'infosys': 'INFY.NSE',
  'infy': 'INFY.NSE',
  'sbin': 'SBIN.NSE',
  'sbi': 'SBIN.NSE',
  'hdfc bank': 'HDFCBANK.NSE',
  'hdfcbank': 'HDFCBANK.NSE',
  'adani power': 'ADANIPOWER.NSE',
  'adanipower': 'ADANIPOWER.NSE',
  'tata motors': 'TATAMOTORS.NSE',
  'tatamotors': 'TATAMOTORS.NSE',
  'tata power': 'TATAPOWER.NSE',
  'tatapower': 'TATAPOWER.NSE',
  'tata steel': 'TATASTEEL.NSE',
  'tatasteel': 'TATASTEEL.NSE',
  'icici': 'ICICIBANK.NSE',
  'icici bank': 'ICICIBANK.NSE',
  'wipro': 'WIPRO.NSE',
  'suzlon': 'SUZLON.NSE',
  'yes bank': 'YESBANK.NSE',
  'yesbank': 'YESBANK.NSE',
  'ioc': 'IOC.NSE',
  'irctc': 'IRCTC.NSE',
  'mrf': 'MRF.NSE',
  'nifty 50': '^NSEI',
  'nifty': '^NSEI',
  'bank nifty': '^NSEBANK',
  'nifty bank': '^NSEBANK',
  'sensex': '^BSESN',
  'bse sensex': '^BSESN',
  'jm financial': 'JMFINANCIAL.NSE',
  'jmfinancial': 'JMFINANCIAL.NSE',
  'jm financials': 'JMFINANCIAL.NSE',
};

const STOP_TOKENS = new Set([
  'PE', 'PB', 'ROE', 'EPS', 'NSE', 'BSE', 'TODAY', 'LOW', 'HIGH', 'TOP',
  'BEST', 'STOCK', 'STOCKS', 'PRICE', 'VOLUME', 'DIVIDEND', 'NEWS', 'MARKET',
  'CAP', 'RETURN', 'MONTH', 'WEEK', 'WEEKS', 'CHART', 'COMPARE', 'VS', 'AND',
  'BANK', 'NIFTY', 'SENSEX', 'IT', 'PHARMA', 'SECTOR', 'LIVE', 'DATA',
]);

const findAliasSymbols = (query) => {
  const lower = query.toLowerCase();
  const matches = Object.keys(STOCK_ALIASES)
    .filter((key) => lower.includes(key))
    .sort((a, b) => b.length - a.length);
  return matches.map((key) => STOCK_ALIASES[key]);
};

const extractTickerSymbols = (query) => {
  const tokens = query.toUpperCase().match(/[A-Z]{2,12}/g) || [];
  const cleaned = tokens.filter((token) => !STOP_TOKENS.has(token));
  return cleaned.map((token) => {
    if (token === 'NIFTY') return '^NSEI';
    if (token === 'BANKNIFTY') return '^NSEBANK';
    if (token === 'SENSEX') return '^BSESN';
    return `${token}.NSE`;
  });
};

const extractSymbolsFromQuery = (query) => {
  const symbols = [...findAliasSymbols(query), ...extractTickerSymbols(query)];
  return [...new Set(symbols)].filter(Boolean);
};

const QUERY_INTENTS = [
  {
    intent: 'high_low_month',
    keywords: ['month high', 'month low', 'monthly high', 'monthly low', 'april high', 'april low', 'may high', 'may low',
      'june high', 'june low', 'july high', 'july low', 'august high', 'august low', 'september high', 'september low',
      'october high', 'october low', 'november high', 'november low', 'december high', 'december low',
      'january high', 'january low', 'february high', 'february low', 'march high', 'march low'],
  },
  {
    intent: 'high_52w',
    keywords: ['52 week high', '52-week high', '52w high'],
  },
  {
    intent: 'low_52w',
    keywords: ['52 week low', '52-week low', '52w low'],
  },
  {
    intent: 'index',
    keywords: ['nifty', 'sensex', 'bank nifty', 'index', 'nifty today', 'sensex today'],
  },
  {
    intent: 'compare',
    keywords: ['compare', 'vs', 'versus', 'mukabla', 'compare karo', 'which is better', 'better', 'compare between'],
  },
  {
    intent: 'chart',
    keywords: ['chart', 'graph', 'trend', 'trends', 'chart dikhao', 'trend bata', 'price chart', 'stock graph'],
  },
  {
    intent: 'historical',
    keywords: ['historical', 'past data', 'previous prices', 'history', 'historical data', 'old prices', 'previous data'],
  },
  {
    intent: 'news',
    keywords: ['news', 'latest news', 'company news', 'stock news', 'khabar'],
  },
  {
    intent: 'sector',
    keywords: ['sector', 'pharma stocks', 'it sector', 'banking stocks', 'energy sector'],
  },
  {
    intent: 'investment',
    keywords: ['investment', 'long term', 'intraday', 'swing trading', 'buy', 'sell', 'should i buy'],
  },
  {
    intent: 'cheap',
    keywords: ['under 100', 'penny', 'cheap stocks', 'low price shares', 'stocks under'],
  },
  {
    intent: 'dividend',
    keywords: ['dividend', 'payout', 'bonus', 'dividend kab', 'payout kab', 'dividend date', 'dividend history'],
  },
  {
    intent: 'gainers',
    keywords: ['top gainers', 'gainers', 'best performing', 'highest gaining', 'top performing', 'top gaining',
      'best stocks today', 'top movers', 'top movers in nse', 'nse top gainers'],
  },
  {
    intent: 'losers',
    keywords: ['top losers', 'losers', 'worst performing', 'highest losing', 'top losing', 'bse top losers'],
  },
  {
    intent: 'market_cap',
    keywords: ['market cap', 'company value', 'market value', 'mcap', 'top market cap'],
  },
  {
    intent: 'fundamentals',
    keywords: ['fundamentals', 'financials', 'valuation'],
  },
  {
    intent: 'pe',
    keywords: ['pe ratio', 'pe', 'price earning', 'pe multiple'],
  },
  {
    intent: 'volume',
    keywords: ['volume', 'traded quantity', 'quantity', 'volume kitna', 'most traded', 'highest volume', 'trading volume'],
  },
  {
    intent: 'high_low',
    keywords: ['high low', 'today high', 'today low', 'day range', 'high/low', 'today high low'],
  },
  {
    intent: 'price',
    keywords: ['current price', 'live price', 'stock price', 'price kya hai', 'kitna chal raha', 'share price',
      'share rate', 'current stock value', 'stock value', 'price'],
  },
];

const parseStockQuery = (query) => {
  const lower = query.toLowerCase();
  for (const rule of QUERY_INTENTS) {
    if (rule.keywords.some((key) => lower.includes(key))) {
      return rule.intent;
    }
  }
  return 'unsupported';
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// helper add (MONTHS ke paas):
const isLastMonthQuery = (lowerQuery) => (
  lowerQuery.includes('last month')
  || lowerQuery.includes('last 1 month')
  || lowerQuery.includes('1 month')
  || lowerQuery.includes('one month')
  || lowerQuery.includes('pichle month')
  || lowerQuery.includes('pichle mahine')
);

const getMonthFromQuery = (lowerQuery) => {
  const idx = MONTHS.findIndex((name) => lowerQuery.includes(name));
  if (idx === -1) return null;
  return { monthIndex: idx, monthName: MONTHS[idx] };
};

const SECTOR_MAP = {
  pharma: ['SUNPHARMA.NSE', 'CIPLA.NSE', 'DRREDDY.NSE', 'DIVISLAB.NSE', 'LUPIN.NSE'],
  it: ['TCS.NSE', 'INFY.NSE', 'WIPRO.NSE', 'HCLTECH.NSE', 'TECHM.NSE'],
  banking: ['HDFCBANK.NSE', 'ICICIBANK.NSE', 'SBIN.NSE', 'AXISBANK.NSE', 'KOTAKBANK.NSE'],
  energy: ['RELIANCE.NSE', 'ONGC.NSE', 'IOC.NSE', 'BPCL.NSE', 'NTPC.NSE'],
};

const getSectorFromQuery = (lowerQuery) => {
  if (lowerQuery.includes('pharma')) return 'pharma';
  if (lowerQuery.includes('it') || lowerQuery.includes('tech')) return 'it';
  if (lowerQuery.includes('bank')) return 'banking';
  if (lowerQuery.includes('energy') || lowerQuery.includes('power') || lowerQuery.includes('oil')) return 'energy';
  return null;
};

const normalizeDebtToEquity = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num > 10) return num / 100;
  return num;
};

const computeValueSnapshot = (symbol, fundamentals, lastPrice) => {
  if (!fundamentals) return null;
  const pe = Number(fundamentals.pe);
  const debt = normalizeDebtToEquity(fundamentals.debtToEquity);
  const marketCap = Number(fundamentals.marketCap);
  const price = Number(fundamentals.price) || Number(lastPrice);

  if (!Number.isFinite(pe) || !Number.isFinite(debt)) return null;

  return {
    symbol,
    price: Number.isFinite(price) ? price : null,
    pe,
    debt_to_equity: debt,
    market_cap: Number.isFinite(marketCap) ? marketCap : null,
  };
};

const getFallbackMomentum = () => ([
  {
    symbol: 'RELIANCE.NSE',
    price: 2920,
    ma50: 2765,
    ma200: 2490,
    high_52_week: 3050,
    highest_high_20: 2955,
    avg_volume_20: 4200000,
    volume: 6200000,
    volume_ratio: 1.48,
    return_3_month: 0.18,
    passes: true,
  },
  {
    symbol: 'HDFCBANK.NSE',
    price: 1655,
    ma50: 1580,
    ma200: 1460,
    high_52_week: 1760,
    highest_high_20: 1675,
    avg_volume_20: 3100000,
    volume: 4600000,
    volume_ratio: 1.48,
    return_3_month: 0.14,
    passes: true,
  },
  {
    symbol: 'TCS.NSE',
    price: 4025,
    ma50: 3850,
    ma200: 3580,
    high_52_week: 4150,
    highest_high_20: 4045,
    avg_volume_20: 1800000,
    volume: 2700000,
    volume_ratio: 1.5,
    return_3_month: 0.12,
    passes: true,
  },
  {
    symbol: 'INFY.NSE',
    price: 1710,
    ma50: 1635,
    ma200: 1480,
    high_52_week: 1785,
    highest_high_20: 1720,
    avg_volume_20: 5200000,
    volume: 7800000,
    volume_ratio: 1.5,
    return_3_month: 0.11,
    passes: true,
  },
  {
    symbol: 'ICICIBANK.NSE',
    price: 1225,
    ma50: 1160,
    ma200: 1045,
    high_52_week: 1290,
    highest_high_20: 1235,
    avg_volume_20: 6400000,
    volume: 9800000,
    volume_ratio: 1.53,
    return_3_month: 0.16,
    passes: true,
  },
]);


const getMomentumSnapshot = async (symbol) => {
  const cached = momentumCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < MOMENTUM_TTL_MS) {
    return cached;
  }

  const series = await fetchNseSeries(symbol);
  const entries = parseDailySeries(series);
  const computed = computeMomentumSnapshot(symbol, entries);
  if (!computed) return null;

  const snapshot = {
    ...computed,
    resolved_symbol: symbol,
    fetchedAt: Date.now(),
  };
  momentumCache.set(symbol, snapshot);
  return snapshot;
};

app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});

app.get('/test-nse', async (req, res) => {
  try {
    const data = await fetchNseSeries('RELIANCE');

    console.log("NSE RAW DATA:", data.slice(0, 2));

    res.json({
      success: true,
      length: data.length,
      sample: data.slice(0, 2)
    });
  } catch (err) {
    console.error("NSE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/contact', requireSupabase, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).send('Name, email, and message are required.');
    }

    const { error } = await supabase
      .from('contact_messages')
      .insert({ name, email, message });
    if (error) throw error;

    return res.send('Message received successfully!');
  } catch (error) {
    return res.status(500).send('Failed to save message.');
  }
});

app.post('/auth/admin/setup', requireSupabase, async (req, res) => {
  try {
    const { name, email, password, setupToken } = req.body;
    if (!adminSetupToken) {
      return res.status(500).json({ error: 'ADMIN_SETUP_TOKEN is not configured.' });
    }
    if (!setupToken || setupToken !== adminSetupToken) {
      return res.status(401).json({ error: 'Invalid setup token.' });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required.' });
    }

    const { data: existingAdmin, error: adminError } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin')
      .limit(1);
    if (adminError) throw adminError;
    if (existingAdmin && existingAdmin.length > 0) {
      return res.status(409).json({ error: 'Admin already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert({ name, email, role: 'admin', password_hash: passwordHash })
      .select('id, name, email, role')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', requireSupabase, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, password_hash')
      .eq('email', email)
      .single();
    if (error) return res.status(401).json({ error: 'Invalid credentials.' });

    const ok = await bcrypt.compare(password, data.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    return res.json({ id: data.id, name: data.name, email: data.email, role: data.role });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/expenses', requireSupabase, requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('expenses')
      .select('id, user_id, amount, category, expense_date, payment_method, note, created_at')
      .eq('user_id', userId)
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/expenses', requireSupabase, requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const amount = Number(req.body.amount);
    const category = String(req.body.category || '').trim();
    const expenseDate = String(req.body.expense_date || '').trim();
    const paymentMethod = String(req.body.payment_method || '').trim();
    const note = String(req.body.note || '').trim();

    if (!amount || amount <= 0 || Number.isNaN(amount)) {
      return res.status(400).json({ error: 'amount must be a positive number.' });
    }
    if (!category) return res.status(400).json({ error: 'category is required.' });
    if (!expenseDate) return res.status(400).json({ error: 'expense_date is required.' });
    if (!paymentMethod) return res.status(400).json({ error: 'payment_method is required.' });

    const payload = {
      user_id: userId,
      amount,
      category,
      expense_date: expenseDate,
      payment_method: paymentMethod,
      note: note || null,
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert(payload)
      .select('id, user_id, amount, category, expense_date, payment_method, note, created_at')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/admin/expenses', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = req.query.userId ? Number(req.query.userId) : null;

    let query = supabase
      .from('expenses')
      .select('id, user_id, amount, category, expense_date, payment_method, note, created_at, users (id, name, email)')
      .order('expense_date', { ascending: false })
      .order('id', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/admin/expenses', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id is required.' });

    const amount = Number(req.body.amount);
    const category = String(req.body.category || '').trim();
    const expenseDate = String(req.body.expense_date || '').trim();
    const paymentMethod = String(req.body.payment_method || '').trim();
    const note = String(req.body.note || '').trim();

    if (!amount || amount <= 0 || Number.isNaN(amount)) {
      return res.status(400).json({ error: 'amount must be a positive number.' });
    }
    if (!category) return res.status(400).json({ error: 'category is required.' });
    if (!expenseDate) return res.status(400).json({ error: 'expense_date is required.' });
    if (!paymentMethod) return res.status(400).json({ error: 'payment_method is required.' });

    const payload = {
      user_id: userId,
      amount,
      category,
      expense_date: expenseDate,
      payment_method: paymentMethod,
      note: note || null,
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert(payload)
      .select('id, user_id, amount, category, expense_date, payment_method, note, created_at')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/admin/momentum-stocks', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || MOMENTUM_DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 5), 25) : MOMENTUM_DEFAULT_LIMIT;
    const symbols = Array.isArray(niftySymbols) ? niftySymbols : [];

    let fetchedCount = 0;
    let cacheCount = 0;
    let scannedCount = 0;
    let errorCount = 0;
    const errorSamples = [];
    const matches = [];
    const candidates = [];

    if (!symbols.length) {
      return res.json({
        updatedAt: new Date().toISOString(),
        totalSymbols: 0,
        fetchedCount,
        cacheCount,
        scannedCount,
        errorCount,
        fallbackUsed: false,
        errorSamples,
        runtimeMs: 0,
        results: [],
      });
    }

    const startedAt = Date.now();
    const maxRuntimeMs = 30000;

    for (let i = 0; i < symbols.length; i += 1) {
      if (Date.now() - startedAt > maxRuntimeMs) break;
      if (fetchedCount >= MOMENTUM_FETCH_LIMIT) break;
      const symbol = symbols[(momentumCursor + i) % symbols.length];
      console.log(`[momentum] scanning ${symbol}`);
      scannedCount += 1;

      let snapshot = null;
      const cached = momentumCache.get(symbol);
      const isFresh = cached && Date.now() - cached.fetchedAt < MOMENTUM_TTL_MS;

      if (isFresh) {
        snapshot = cached;
        cacheCount += 1;
      } else {
        try {
          snapshot = await getMomentumSnapshot(symbol);
          fetchedCount += 1;
        } catch (error) {
          if (error.message.includes('rate limit')) break;
          errorCount += 1;
          if (errorSamples.length < 5) {
            errorSamples.push({ symbol, error: error.message });
          }
        }
      }

      if (snapshot && snapshot.passes) {
        matches.push(snapshot);
      } else if (snapshot) {
        candidates.push(snapshot);
      }
    }

    momentumCursor = (momentumCursor + scannedCount) % symbols.length;

    matches.sort((a, b) => {
      if (b.return_3_month !== a.return_3_month) {
        return b.return_3_month - a.return_3_month;
      }
      return b.volume_ratio - a.volume_ratio;
    });

    let results = matches.slice(0, limit);
    const fallbackUsed = false;
    const staleUsed = false;
    let relaxedUsed = false;
    const updatedAt = new Date().toISOString();
    const runtimeMs = Date.now() - startedAt;

    if (!results.length && candidates.length) {
      candidates.sort((a, b) => {
        if (b.return_3_month !== a.return_3_month) {
          return b.return_3_month - a.return_3_month;
        }
        return b.volume_ratio - a.volume_ratio;
      });
      results = candidates.slice(0, limit);
      relaxedUsed = true;
    }

    if (results.length) {
      lastMomentumSnapshot = {
        updatedAt,
        results,
        totalSymbols: symbols.length,
        fetchedCount,
        cacheCount,
        scannedCount,
        errorCount,
        errorSamples,
        runtimeMs,
      };
    }

    if (!results.length && fetchedCount === 0 && cacheCount === 0 && errorCount > 0) {
      if (lastMomentumSnapshot && Array.isArray(lastMomentumSnapshot.results)) {
        return res.json({
          ...lastMomentumSnapshot,
          fallbackUsed,
          staleUsed: true,
        });
      }

      return res.status(503).json({
        error: 'Momentum data unavailable. Try again later.',
        updatedAt,
        totalSymbols: symbols.length,
        fetchedCount,
        cacheCount,
        scannedCount,
        errorCount,
        fallbackUsed,
        staleUsed,
        errorSamples,
        runtimeMs,
        results: [],
      });
    }

    return res.json({
      updatedAt,
      totalSymbols: symbols.length,
      fetchedCount,
      cacheCount,
      scannedCount,
      errorCount,
      fallbackUsed,
      staleUsed,
      relaxedUsed,
      errorSamples,
      runtimeMs,
      results,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/ai/stocks/momentum-3m-high', requireSupabase, requireUser, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || AI_RESULT_LIMIT);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 5), 20) : AI_RESULT_LIMIT;
    const symbols = Array.isArray(niftySymbols) ? niftySymbols : [];

    let fetchedCount = 0;
    let scannedCount = 0;
    let errorCount = 0;
    const errorSamples = [];
    const results = [];

    if (!symbols.length) {
      return res.json({
        updatedAt: new Date().toISOString(),
        totalSymbols: 0,
        fetchedCount,
        scannedCount,
        errorCount,
        results: [],
      });
    }

    const startedAt = Date.now();
    const maxRuntimeMs = 30000;
    const maxFetch = AI_BATCH_SIZE;

    for (let i = 0; i < symbols.length; i += 1) {
      if (Date.now() - startedAt > maxRuntimeMs) break;
      if (fetchedCount >= maxFetch) break;

      const symbol = symbols[(aiCursor + i) % symbols.length];
      scannedCount += 1;

      try {
        const entries = await getYahooSeries(symbol);
        fetchedCount += 1;
        const snapshot = computeMomentum3mHighSnapshot(symbol, entries);
        if (snapshot && snapshot.passes) {
          results.push(snapshot);
        }
      } catch (error) {
        errorCount += 1;
        if (errorSamples.length < 5) {
          errorSamples.push({ symbol, error: error.message });
        }
      }
    }

    aiCursor = (aiCursor + scannedCount) % symbols.length;

    results.sort((a, b) => {
      if (b.return_3_month !== a.return_3_month) {
        return b.return_3_month - a.return_3_month;
      }
      return b.volume - a.volume;
    });

    return res.json({
      updatedAt: new Date().toISOString(),
      totalSymbols: symbols.length,
      fetchedCount,
      scannedCount,
      errorCount,
      errorSamples,
      criteria: 'Price at 3-month high',
      runtimeMs: Date.now() - startedAt,
      results: results.slice(0, limit),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/ai/stocks/value-low-pe-debt', requireSupabase, requireUser, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || AI_RESULT_LIMIT);
    const peMaxRaw = Number(req.query.pe || 15);
    const debtMaxRaw = Number(req.query.de || 0.5);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 5), 20) : AI_RESULT_LIMIT;
    const peMax = Number.isFinite(peMaxRaw) ? peMaxRaw : 15;
    const debtMax = Number.isFinite(debtMaxRaw) ? debtMaxRaw : 0.5;
    const symbols = Array.isArray(niftySymbols) ? niftySymbols : [];

    let fundamentalsFetched = 0;
    let seriesFetched = 0;
    let scannedCount = 0;
    let errorCount = 0;
    const errorSamples = [];
    const results = [];

    if (!symbols.length) {
      return res.json({
        updatedAt: new Date().toISOString(),
        totalSymbols: 0,
        fundamentalsFetched,
        seriesFetched,
        scannedCount,
        errorCount,
        results: [],
      });
    }

    const startedAt = Date.now();
    const maxRuntimeMs = 30000;
    const maxFetch = AI_BATCH_SIZE;

    for (let i = 0; i < symbols.length; i += 1) {
      if (Date.now() - startedAt > maxRuntimeMs) break;
      if (fundamentalsFetched >= maxFetch) break;

      const symbol = symbols[(aiCursor + i) % symbols.length];
      scannedCount += 1;

      try {
        const fundamentals = await getYahooFundamentals(symbol);
        fundamentalsFetched += 1;

        let price = fundamentals.price;
        if (!Number.isFinite(Number(price))) {
          const entries = await getYahooSeries(symbol);
          seriesFetched += 1;
          const latest = entries.length ? entries[entries.length - 1] : null;
          price = latest ? latest.close : null;
        }

        const snapshot = computeValueSnapshot(symbol, fundamentals, price);
        if (!snapshot) continue;

        if (snapshot.pe <= peMax && snapshot.debt_to_equity <= debtMax) {
          results.push(snapshot);
        }
      } catch (error) {
        errorCount += 1;
        if (errorSamples.length < 5) {
          errorSamples.push({ symbol, error: error.message });
        }
      }
    }

    aiCursor = (aiCursor + scannedCount) % symbols.length;

    results.sort((a, b) => {
      if (a.pe !== b.pe) return a.pe - b.pe;
      return a.debt_to_equity - b.debt_to_equity;
    });

    return res.json({
      updatedAt: new Date().toISOString(),
      totalSymbols: symbols.length,
      fundamentalsFetched,
      seriesFetched,
      scannedCount,
      errorCount,
      errorSamples,
      criteria: `PE <= ${peMax}, Debt/Equity <= ${debtMax}`,
      runtimeMs: Date.now() - startedAt,
      results: results.slice(0, limit),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ai/bot/query', requireSupabase, requireUser, async (req, res) => {
  try {
    const query = String(req.body.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Query is required.' });

    const lowerQuery = query.toLowerCase();
    const sendBotResponse = async (payload) => {
      const summary = await getGeminiSummary(query, payload);
      const finalPayload = summary ? { ...payload, ai_summary: summary } : payload;
      return res.json(finalPayload);
    };

    let intent = parseStockQuery(query);
    let symbols = extractSymbolsFromQuery(query);
    let symbol = symbols[0] || null;
    let forceVolumeChart = false;

    const geminiIntent = await getGeminiIntent(query);
    if (geminiIntent) {
      if (geminiIntent.intent) intent = geminiIntent.intent;
      if (Array.isArray(geminiIntent.symbols) && geminiIntent.symbols.length) {
        symbols = geminiIntent.symbols;
        symbol = symbols[0] || null;
      }
      if (intent === 'volume_chart') {
        intent = 'volume';
        forceVolumeChart = true;
      }
    }

    if (!geminiIntent && symbol && (lowerQuery.includes('chart') || lowerQuery.includes('graph') || lowerQuery.includes('trend'))) {
      intent = 'chart';
    }

    if (intent === 'unsupported') {
      return sendBotResponse({
        intent,
        message: 'Please ask stock related queries like:\n- RELIANCE current price\n- Top gainers\n- TCS vs INFY',
      });
    }

    if (!symbol && !['gainers', 'losers', 'sector', 'news', 'cheap', 'investment'].includes(intent)) {
      return sendBotResponse({
        intent: 'missing_symbol',
        message: 'Please mention a stock or index symbol/name (e.g., RELIANCE, TCS, Nifty).',
      });
    }

    if (intent === 'investment') {
      return sendBotResponse({
        intent,
        message: 'I cannot provide investment advice. Ask for data like price, PE, volume, or chart instead.',
      });
    }

    if (intent === 'sector') {
      const sector = getSectorFromQuery(lowerQuery);
      if (!sector || !SECTOR_MAP[sector]) {
        return sendBotResponse({
          intent,
          message: 'Please mention a sector like pharma, IT, banking, or energy.',
        });
      }
      return sendBotResponse({
        intent,
        sector,
        message: `${sector.toUpperCase()} sector stocks.`,
        results: SECTOR_MAP[sector].map((sym) => ({ symbol: sym })),
      });
    }

    if (intent === 'news') {
      const searchTerm = symbol ? symbol.replace('.NSE', '') : query;
      const news = await fetchYahooNews(searchTerm);
      return sendBotResponse({
        intent,
        symbol,
        message: news.length ? 'Latest news.' : 'No recent news found.',
        results: news,
      });
    }

    if (intent === 'dividend') {
      if (!symbol) {
        return sendBotResponse({
          intent,
          message: 'Please mention a stock symbol or name for dividend info.',
        });
      }
      const fundamentals = await getYahooFundamentals(symbol);
      return sendBotResponse({
        intent,
        symbol,
        dividend_rate: fundamentals.dividendRate,
        dividend_yield: fundamentals.dividendYield,
        ex_dividend_date: fundamentals.exDividendDate,
        message: 'Dividend snapshot.',
      });
    }

    if (intent === 'cheap') {
      const scan = await scanCheapStocks(AI_BATCH_SIZE, AI_RESULT_LIMIT);
      return sendBotResponse({
        intent,
        message: scan.results.length ? 'Cheap stocks under 100 (sample).' : 'No cheap stocks found in this scan.',
        results: scan.results,
        fetchedCount: scan.fetchedCount,
        scannedCount: scan.scannedCount,
        errorCount: scan.errorCount,
        errorSamples: scan.errorSamples,
      });
    }

    if (intent === 'gainers' || intent === 'losers') {
      const movers = await fetchYahooMovers(intent);
      return sendBotResponse({
        intent,
        message: intent === 'gainers' ? 'Top gainers.' : 'Top losers.',
        results: movers,
      });
    }

    if (intent === 'compare') {
      if (symbols.length < 2) {
        return sendBotResponse({
          intent: 'compare',
          message: 'Please provide two stock symbols/names to compare.',
        });
      }
      const left = symbols[0];
      const right = symbols[1];

      const [leftFund, rightFund, leftSeries, rightSeries] = await Promise.all([
        getYahooFundamentals(left),
        getYahooFundamentals(right),
        getYahooSeries(left),
        getYahooSeries(right),
      ]);

      const getOneMonthReturn = (entries) => {
        if (!entries || entries.length < 22) return null;
        const latest = entries[entries.length - 1];
        const start = entries[entries.length - 22];
        return latest && start ? (latest.close / start.close - 1) : null;
      };

      const rows = [
        {
          symbol: left,
          price: leftFund.price,
          return_1m: getOneMonthReturn(leftSeries),
          market_cap: leftFund.marketCap,
          pe: leftFund.pe,
        },
        {
          symbol: right,
          price: rightFund.price,
          return_1m: getOneMonthReturn(rightSeries),
          market_cap: rightFund.marketCap,
          pe: rightFund.pe,
        },
      ];

      return sendBotResponse({
        intent: 'compare',
        message: 'Comparison snapshot.',
        rows,
      });
    }

    if (intent === 'chart' || intent === 'historical') {
      const entries = await getYahooSeries(symbol);
      const recent = entries.slice(-63);
      return sendBotResponse({
        intent,
        symbol,
        message: intent === 'chart' ? '3-month chart' : 'Historical data (last 60 sessions)',
        series: entries.slice(-60),
        chart: recent.map((row) => ({
          date: row.date,
          close: row.close,
        })),
      });
    }

    if (intent === 'index') {
      const entries = await getYahooSeries(symbol);
      if (!entries.length) throw new Error('No index data found.');
      const latest = entries[entries.length - 1];
      const prev = entries[entries.length - 2] || latest;
      const change = latest.close - prev.close;
      const changePct = prev.close ? change / prev.close : null;

      return res.json({
        intent: 'index',
        symbol,
        message: 'Index snapshot.',
        price: latest.close,
        change,
        change_pct: changePct,
        chart: entries.slice(-30).map((row) => ({ date: row.date, close: row.close })),
      });
    }

    if (intent === 'all_time_high') {
      const entries = await fetchYahooSeries(symbol, 'max');
      const maxClose = Math.max(...entries.map((row) => row.close));
      return sendBotResponse({
        intent: 'all_time_high',
        symbol,
        message: 'All-time high (based on available data).',
        value: maxClose,
      });
    }

    const entries = await getYahooSeries(symbol);
    if (!entries.length) throw new Error('No price data found.');
    const latest = entries[entries.length - 1];

    if (intent === 'price') {
      return sendBotResponse({
        intent: 'price',
        symbol,
        price: latest.close,
        message: 'Current price.',
      });
    }

    if (intent === 'high_low') {
      return sendBotResponse({
        intent: 'high_low',
        symbol,
        high: latest.high,
        low: latest.low,
        message: 'Today high/low (last session).',
      });
    }

    if (intent === 'high_low_month') {
      const monthInfo = getMonthFromQuery(query.toLowerCase());
      if (!monthInfo) {
        return sendBotResponse({
          intent: 'high_low_month',
          message: 'Please mention a month name (e.g., April).',
        });
      }
      const { monthIndex, monthName } = monthInfo;
      const targetYear = new Date(entries[entries.length - 1].date).getFullYear();
      const monthRows = entries.filter((row) => {
        const dt = new Date(row.date);
        return dt.getMonth() === monthIndex && dt.getFullYear() === targetYear;
      });

      if (!monthRows.length) {
        return sendBotResponse({
          intent: 'high_low_month',
          symbol,
          message: `No data found for ${monthName} ${targetYear}.`,
        });
      }

      const monthHigh = Math.max(...monthRows.map((row) => row.high));
      const monthLow = Math.min(...monthRows.map((row) => row.low));

      return sendBotResponse({
        intent: 'high_low_month',
        symbol,
        month: monthName,
        year: targetYear,
        high: monthHigh,
        low: monthLow,
        message: `${monthName} ${targetYear} high/low.`,
      });
    }

    if (intent === 'return_1m') {
      if (entries.length < 22) throw new Error('Not enough data for 1M return.');
      const start = entries[entries.length - 22];
      const return1m = start ? (latest.close / start.close - 1) : null;
      return sendBotResponse({
        intent: 'return_1m',
        symbol,
        price: latest.close,
        return_1m: return1m,
        message: '1-month return.',
      });
    }

    if (intent === 'volume') {
      if (lowerQuery.includes('most traded') || lowerQuery.includes('highest volume') || lowerQuery.includes('most active')) {
        const actives = await fetchYahooMostActive();
        return sendBotResponse({
          intent: 'volume_list',
          message: 'Most traded stocks.',
          results: actives,
        });
      }
      if (forceVolumeChart || lowerQuery.includes('chart') || lowerQuery.includes('graph') || lowerQuery.includes('trend') || isLastMonthQuery(lowerQuery)) {
        const series = entries.slice(-22);
        return sendBotResponse({
          intent: 'volume_chart',
          symbol,
          message: isLastMonthQuery(lowerQuery) ? 'Last month volume chart.' : 'Volume chart.',
          chart: series.map((row) => ({ date: row.date, volume: row.volume })),
          series,
        });
      }
      return sendBotResponse({
        intent: 'volume',
        symbol,
        volume: latest.volume,
        message: 'Latest volume.',
      });
    }

    if (intent === 'high_52w' || intent === 'low_52w') {
      const window = entries.slice(-252);
      const high52 = Math.max(...window.map((row) => row.high));
      const low52 = Math.min(...window.map((row) => row.low));
      return sendBotResponse({
        intent,
        symbol,
        high_52w: high52,
        low_52w: low52,
        message: '52-week range.',
      });
    }

    if (intent === 'market_cap' || intent === 'pe') {
      const fundamentals = await getYahooFundamentals(symbol);
      return sendBotResponse({
        intent,
        symbol,
        market_cap: fundamentals.marketCap,
        pe: fundamentals.pe,
        message: intent === 'market_cap' ? 'Market cap.' : 'PE ratio.',
      });
    }

    if (intent === 'fundamentals') {
      const fundamentals = await getYahooFundamentals(symbol);
      return sendBotResponse({
        intent,
        symbol,
        market_cap: fundamentals.marketCap,
        pe: fundamentals.pe,
        message: 'Fundamentals snapshot.',
      });
    }

    return sendBotResponse({
      intent: 'unsupported',
      message: 'Unsupported query. Try price, PE, market cap, volume, chart, or historical data.',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/admin/users', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'name, email, password, and role are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = String(role).trim().toLowerCase();
    const allowedRoles = ['admin', 'user'];
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: `Invalid role. Allowed: ${allowedRoles.join(', ')}` });
    }

    const { data: existingUser, error: existingError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .limit(1);
    if (existingError) throw existingError;
    if (existingUser && existingUser.length > 0) {
      return res.status(409).json({ error: 'Email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('users')
      .insert({
        name,
        email: normalizedEmail,
        role: normalizedRole,
        password_hash: passwordHash,
      })
      .select('id, name, email, role')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/permissions', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('permissions')
      .select('id, key, description')
      .order('id', { ascending: true });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/users', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role')
      .order('id', { ascending: true });
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/users/:id/permissions', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { data, error } = await supabase
      .from('user_permissions')
      .select('permission_id, permissions (id, key, description)')
      .eq('user_id', userId)
      .order('permission_id', { ascending: true });
    if (error) throw error;
    return res.json(data.map((row) => row.permissions));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/users/:id/permissions', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { permissionIds } = req.body;
    if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
      return res.status(400).json({ error: 'permissionIds array is required.' });
    }

    const rows = permissionIds.map((permissionId) => ({
      user_id: userId,
      permission_id: permissionId,
    }));

    const { error } = await supabase.from('user_permissions').upsert(rows, {
      onConflict: 'user_id,permission_id',
      ignoreDuplicates: true,
    });
    if (error) throw error;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.delete('/users/:id/permissions/:permId', requireSupabase, requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const permId = Number(req.params.permId);
    const { error } = await supabase
      .from('user_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('permission_id', permId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/me/permissions', requireSupabase, async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: 'Missing x-user-id header.' });
    const { data, error } = await supabase
      .from('user_permissions')
      .select('permission_id, permissions (id, key, description)')
      .eq('user_id', userId)
      .order('permission_id', { ascending: true });
    if (error) throw error;
    return res.json(data.map((row) => row.permissions));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

app.get('/admins', requireSupabase, requireUser, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('role', 'admin')
      .order('id', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/chat/messages', requireSupabase, requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const peerId = Number(req.query.peerId);
    if (!peerId) return res.status(400).json({ error: 'peerId query param is required.' });

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, sender_id, receiver_id, message, created_at')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/chat/messages', requireSupabase, requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { receiverId, message } = req.body;
    if (!receiverId || !message) {
      return res.status(400).json({ error: 'receiverId and message are required.' });
    }

    const payload = {
      sender_id: userId,
      receiver_id: Number(receiverId),
      message: String(message).trim(),
    };

    if (!payload.message) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const { data, error } = await supabase
      .from('chat_messages')
      .insert(payload)
      .select('id, sender_id, receiver_id, message, created_at')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
const fs = require('fs');
const path = require('path');
const { readJson, resolveDataPath, writeJson, writeText } = require('./store');

const PROJECT_STOPWORDS = new Set([
  'A', 'An', 'And', 'Asia', 'At', 'By', 'Crypto', 'For', 'From', 'Fund', 'Funds',
  'Hong', 'In', 'Institutional', 'Into', 'Is', 'Launches', 'New', 'Of', 'On',
  'Protocol', 'Raises', 'Regulated', 'The', 'To', 'Token', 'Tokens', 'Web3', 'With'
]);

const X_LIST_GENERIC_NAME_BLOCKLIST = new Set([
  'agents',
  'agent',
  'earn',
  'skill',
  'skills',
  'kit',
  'update',
  'latest',
  'news',
  'morning',
  'today',
  'just in'
]);

const MAJOR_ASSET_BLOCKLIST = new Set([
  'bitcoin', 'btc', 'ethereum', 'eth', 'xrp', 'ripple', 'solana', 'sol',
  'bnb', 'binance coin', 'dogecoin', 'doge', 'cardano', 'ada', 'tron', 'trx',
  'avalanche', 'avax', 'chainlink', 'link', 'sui', 'toncoin', 'ton',
  'bitcoin network', 'the open network', 'chainlink oracle network'
]);

const DEFAULT_REJECT_SYMBOLS = new Set([
  'btc', 'eth', 'usdt', 'ada', 'ltc', 'doge', 'xrp', 'sol', 'bnb'
]);

const FUNDRAISING_ENTITY_NAME_BLOCKLIST = new Set([
  'stripe',
  'binance labs',
  'yzi labs',
  'mexc ventures',
  'a16z crypto',
  'animoca brands',
  'pantera capital'
]);

const DEX_ENTITY_NAME_BLOCKLIST = new Set([
  'base defi',
  'defi',
  'bnb chain',
  'solana ecosystem',
  'base ecosystem',
  'monad ecosystem',
  'abstract',
  'best'
]);

const ECOSYSTEM_ENTITY_NAME_BLOCKLIST = new Set([
  'base defi',
  'bnb chain',
  'solana ecosystem',
  'base ecosystem',
  'monad ecosystem',
  'abstract',
  'best'
]);

const NON_PROJECT_PRIORITY_KEYWORDS = {
  event: ['consensus', 'summit', 'conference', 'expo', 'forum', 'week'],
  organization: ['foundation', 'capital', 'ventures', 'brokers', 'bank', 'banks', 'hsbc', 'jpmorgan', 'stanchart', 'standard chartered'],
  exchange: ['exchange', 'markets', 'trading venue'],
  person: ['ceo', 'founder', 'president'],
  location: ['hong kong', 'singapore', 'uae', 'dubai'],
  topic: ['price prediction', 'technical analysis', 'bull run', 'market outlook']
};

const SIGNAL_RULES = [
  { key: 'funding', regex: /\b(funding|raised|raises|raise|backed|seed round|series a|series b|strategic round)\b/i },
  { key: 'compliance', regex: /\b(compliance|regulated|regulatory|license|licensed|licensing|legal opinion)\b/i },
  { key: 'hongKong', regex: /\b(hong kong|hksar|sfc)\b/i },
  { key: 'asia', regex: /\b(asia|apac|asian market|regional expansion)\b/i },
  { key: 'institutional', regex: /\b(institutional|custody|prime brokerage|asset manager|family office)\b/i },
  { key: 'listing', regex: /\b(listing|listed|exchange listing|secondary market|liquidity)\b/i },
  { key: 'exchange', regex: /\b(exchange|trading venue|market access)\b/i },
  { key: 'hiring', regex: /\b(hiring|hire|recruiting|job opening|career page)\b/i },
  { key: 'rwa', regex: /\b(rwa|real world asset|tokenized treasury|tokenized fund)\b/i },
  { key: 'stablecoin', regex: /\b(stablecoin|payments rail|settlement layer)\b/i },
  { key: 'custody', regex: /\b(custody|custodian|settlement|qualified custody)\b/i }
];

const EARLY_SIGNAL_RULES = [
  { key: 'funding', regex: /\b(funding|raised|raises|raise|backed|seed round|series a|series b|strategic round|investment)\b/i, weight: 4 },
  { key: 'launch', regex: /\b(launch|launched|mainnet|testnet|go live|rollout|debut)\b/i, weight: 3 },
  { key: 'ecosystem', regex: /\b(ecosystem|foundation support|accelerator|grant program|builder program|integration)\b/i, weight: 3 },
  { key: 'infra', regex: /\b(infra|infrastructure|layer 2|rollup|modular|oracle|interop|wallet infrastructure)\b/i, weight: 2 },
  { key: 'ai', regex: /\b(ai|agentic|inference|model|compute)\b/i, weight: 2 },
  { key: 'github', regex: /\b(open source|github|developer docs|sdk|testnet)\b/i, weight: 2 },
  { key: 'hongKongStrong', regex: /\b(hong kong|hksar|sfc)\b/i, weight: 4 },
  { key: 'hongKongMedium', regex: /\b(asia|apac|regulated markets|licensed exchange|professional investors)\b/i, weight: 2 },
  { key: 'hongKongWeak', regex: /\b(institutional|custody|rwa)\b/i, weight: 1 }
];

function nowIso() {
  return new Date().toISOString();
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchText(url, options = {}) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), Number(options.timeoutMs || 12000));
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 osl-deal-scout',
        ...(options.headers || {})
      },
      method: options.method || 'GET',
      body: options.body
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const cap = Math.max(1, Number(limit || 1));
  let index = 0;

  const runners = Array.from({ length: Math.min(cap, list.length) }, async () => {
    while (index < list.length) {
      const currentIndex = index;
      index += 1;
      await worker(list[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
}

function stripHtml(value) {
  return (value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItems(xml) {
  const items = [];
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  const itemBlocks = xml.match(itemRegex) || [];
  for (const block of itemBlocks) {
    items.push({
      title: extractTag(block, 'title'),
      link: decodeGoogleNewsLink(extractTag(block, 'link')),
      pubDate: extractTag(block, 'pubDate'),
      description: stripHtml(extractTag(block, 'description')),
      source: extractTag(block, 'source'),
      creator: extractTag(block, 'dc:creator')
    });
  }
  return items;
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return stripHtml(match ? match[1] : '');
}

function decodeGoogleNewsLink(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('news.google.com')) {
      return url;
    }
    const target = parsed.searchParams.get('url');
    return target || url;
  } catch {
    return url;
  }
}

function normalizeProjectName(name) {
  return name
    .replace(/\$(\w+)/g, '$1')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(name) {
  return normalizeProjectName(name).toLowerCase();
}

function slugify(name) {
  return normalizeProjectName(name)
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function isBlockedByPattern(value, patterns) {
  return (patterns || []).some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      return false;
    }
  });
}

function countMatches(text, regex) {
  const matches = text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`));
  return matches ? matches.length : 0;
}

function loadProfiles(rootDir) {
  const profileData = readJson(resolveDataPath(rootDir, 'project-profiles.json'), { profiles: [] });
  return new Map((profileData.profiles || []).map((profile) => [normalizeKey(profile.name), profile]));
}

function loadProfileList(rootDir) {
  return readJson(resolveDataPath(rootDir, 'project-profiles.json'), { profiles: [] }).profiles || [];
}

function loadXWatchlist(rootDir) {
  const payload = readJson(resolveDataPath(rootDir, 'x-watchlist.json'), { handles: [] });
  return Array.from(new Set(
    (payload.handles || [])
      .map((handle) => extractTwitterUsername(handle))
      .filter(Boolean)
  ));
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadOslListedAssets(rootDir) {
  const listedData = readJson(resolveDataPath(rootDir, 'osl-global-listed.json'), { assets: [] });
  return listedData.assets || [];
}

function loadInternalRules(rootDir) {
  return readJson(resolveDataPath(rootDir, 'internal-screening-rules.json'), { thresholds: {} });
}

function loadApiCache(rootDir) {
  const cache = readJson(resolveDataPath(rootDir, 'api-cache.json'), {
    updatedAt: '',
    coingecko: {},
    defillama: {},
    website: {},
    rootdata: {},
    cryptorank: {},
    opennews: {},
    opentwitter: {}
  });
  return {
    updatedAt: cache.updatedAt || '',
    coingecko: cache.coingecko || {},
    defillama: cache.defillama || {},
    website: cache.website || {},
    rootdata: cache.rootdata || {},
    cryptorank: cache.cryptorank || {},
    opennews: cache.opennews || {},
    opentwitter: cache.opentwitter || {}
  };
}

function saveApiCache(rootDir, cache) {
  cache.updatedAt = nowIso();
  writeJson(resolveDataPath(rootDir, 'api-cache.json'), cache);
}

function preferCryptoRankEntry(current, next) {
  if (!current) return next;
  const currentRank = Number(current.rank || Number.MAX_SAFE_INTEGER);
  const nextRank = Number(next.rank || Number.MAX_SAFE_INTEGER);
  return nextRank < currentRank ? next : current;
}

function buildCryptoRankCatalog(rows) {
  const byName = {};
  const bySlug = {};
  const symbolCandidates = {};

  for (const row of rows || []) {
    const entry = {
      id: Number(row.id || 0),
      name: row.name || '',
      slug: row.slug || '',
      symbol: row.symbol || '',
      rank: Number(row.rank || 0),
      category: row.category || '',
      type: row.type || '',
      marketCapUsd: Number(row.values?.USD?.marketCap || 0),
      volume24hUsd: Number(row.values?.USD?.volume24h || 0),
      lastUpdated: row.lastUpdated || ''
    };
    const nameKey = normalizeKey(entry.name);
    const slugKey = normalizeKey(entry.slug);
    const symbolKey = normalizeKey(entry.symbol);
    if (nameKey) byName[nameKey] = preferCryptoRankEntry(byName[nameKey], entry);
    if (slugKey) bySlug[slugKey] = preferCryptoRankEntry(bySlug[slugKey], entry);
    if (symbolKey) {
      symbolCandidates[symbolKey] = symbolCandidates[symbolKey] || [];
      symbolCandidates[symbolKey].push(entry);
    }
  }

  const bySymbol = {};
  for (const [symbolKey, candidates] of Object.entries(symbolCandidates)) {
    if (candidates.length === 1) {
      bySymbol[symbolKey] = candidates[0];
    }
  }

  return { byName, bySlug, bySymbol };
}

function extractNextDataJson(html) {
  const match = String(html || '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function flattenCryptoRankInvestors(investors) {
  const groups = investors && typeof investors === 'object' ? Object.values(investors) : [];
  return groups
    .flatMap((group) => Array.isArray(group) ? group : [])
    .map((item) => ({
      name: item?.name || '',
      slug: item?.slug || '',
      category: item?.category || '',
      tier: Number(item?.tier || 0)
    }))
    .filter((item) => item.name);
}

function parseCryptoRankFundingPage(html) {
  const nextData = extractNextDataJson(html);
  const rounds = nextData?.props?.pageProps?.coinTokenSales?.rounds;
  if (!Array.isArray(rounds)) return [];

  return rounds
    .filter((round) => round?.kind === 'FundingRound')
    .map((round) => {
      const investors = flattenCryptoRankInvestors(round.investors);
      return {
        announcedAt: round.date || '',
        roundStage: round.type || '',
        raiseUsd: Number(round.raise || 0),
        valuationUsd: Number(round.valuation || 0),
        investors,
        investorsCount: investors.length,
        linkToAnnouncement: round.linkToAnnouncement || '',
        isHidden: Boolean(round.isHidden),
        isAuthProtected: Boolean(round.isAuthProtected)
      };
    })
    .filter((round) => round.announcedAt || round.roundStage || round.investors.length)
    .sort((a, b) => Date.parse(b.announcedAt || 0) - Date.parse(a.announcedAt || 0));
}

function hoursToMs(hours) {
  return Number(hours || 0) * 3600000;
}

function isCacheFresh(entry, ttlHours) {
  if (!entry || !entry.fetchedAt) return false;
  if (entry.error) return false;
  return Date.now() - Date.parse(entry.fetchedAt) < hoursToMs(ttlHours);
}

function safeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractBetween(value, startTag, endTag) {
  const match = value.match(new RegExp(`${startTag}([\\s\\S]*?)${endTag}`, 'i'));
  return match ? safeText(match[1].replace(/<[^>]+>/g, ' ')) : '';
}

function stripTags(value) {
  return safeText(String(value || '').replace(/<[^>]+>/g, ' '));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

const CMC_LISTING_TTL_MS = 6 * 60 * 60 * 1000;
const CMC_DETAIL_TTL_MS = 30 * 60 * 1000;
const cmcListingCache = {
  fetchedAt: 0,
  items: []
};
const cmcDetailCache = new Map();
const solanaMintDecimalsCache = new Map();
const evmDecimalsCache = new Map();
const tronDecimalsCache = new Map();
const tonJettonDecimalsCache = new Map();
const suiCoinDecimalsCache = new Map();
const aptosExplorerCache = {
  fetchedAt: 0,
  bundleUrl: '',
  bundleText: ''
};
const EVM_DECIMALS_SELECTOR = '0x313ce567';
const EVM_RPC_BY_CHAIN_ID = {
  1: 'https://ethereum-rpc.publicnode.com',
  10: 'https://optimism-rpc.publicnode.com',
  56: 'https://bsc-dataseed.binance.org',
  88: 'https://rpc.viction.xyz',
  100: 'https://rpc.gnosischain.com',
  128: 'https://http-mainnet.hecochain.com',
  137: 'https://polygon-rpc.com',
  250: 'https://rpc.fantom.network',
  196: 'https://rpc.xlayer.tech',
  324: 'https://mainnet.era.zksync.io',
  8453: 'https://base-rpc.publicnode.com',
  42161: 'https://arbitrum-one-rpc.publicnode.com',
  43114: 'https://api.avax.network/ext/bc/C/rpc',
  57073: 'https://rpc-gel.inkonchain.com',
  59144: 'https://rpc.linea.build',
  8217: 'https://public-en.node.kaia.io',
  534352: 'https://rpc.scroll.io',
  81457: 'https://rpc.blast.io'
};

function normalizeSearchKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatTokenPrice(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '—';
  if (num >= 1000) return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (num >= 1) return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
  if (num >= 0.0001) return `$${num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 })}`;
  return `$${num.toExponential(4)}`;
}

function computeDisplayPrecision(usagePrecision) {
  const precision = Number(usagePrecision || 0);
  if (!Number.isFinite(precision) || precision <= 0) return 8;
  return precision < 8 ? precision : 8;
}

function collectContractAddresses(platforms) {
  return Array.from(new Set(
    (platforms || [])
      .map((platform) => String(platform && platform.contractAddress || '').trim())
      .filter(Boolean)
  ));
}

function pickUsagePrecision(platforms) {
  const values = (platforms || [])
    .map((platform) => Number(platform && platform.contractDecimals))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 8;
  return Math.min(...values);
}

function uniqueChainNames(platforms) {
  return Array.from(new Set((platforms || []).map((platform) => String(platform.contractPlatform || '').trim()).filter(Boolean)));
}

function buildRemarkChains(platforms) {
  const seen = new Set();
  return (platforms || []).reduce((list, platform) => {
    const name = String(platform && platform.contractPlatform || '').trim();
    if (!name || seen.has(name)) return list;
    seen.add(name);
    list.push({
      name,
      url: String(platform.contractExplorerUrl || platform.contractBlockExplorerUrl || '').trim()
    });
    return list;
  }, []);
}

function pickUsagePrecisionPlatform(platforms) {
  const candidates = (platforms || [])
    .filter((platform) => Number.isFinite(Number(platform.contractDecimals)) && Number(platform.contractDecimals) > 0)
    .sort((a, b) => {
      const diff = Number(a.contractDecimals) - Number(b.contractDecimals);
      if (diff !== 0) return diff;
      if (a.decimalsVerified !== b.decimalsVerified) return a.decimalsVerified ? -1 : 1;
      return String(a.contractPlatform || '').localeCompare(String(b.contractPlatform || ''));
    });
  return candidates[0] || null;
}

function buildTokenConfigRemark(platforms) {
  const chains = uniqueChainNames(platforms);
  const picked = pickUsagePrecisionPlatform(platforms);
  if (!chains.length || !picked) return '';
  return `该币种分别有${chains.join('/')}几条链，使用精度取自${picked.contractPlatform}链。`;
}

function buildVerificationNote(platforms) {
  const unverified = Array.from(new Set(
    (platforms || [])
      .filter((platform) => !platform.decimalsVerified)
      .map((platform) => String(platform.contractPlatform || '').trim())
      .filter(Boolean)
  ));
  if (!unverified.length) return '';
  return `未校验链：${unverified.join('/')}，当前精度暂取自 CoinMarketCap。`;
}

function buildTokenConfigRow(detail) {
  const usagePrecision = pickUsagePrecision(detail.platforms);
  const pickedPlatform = pickUsagePrecisionPlatform(detail.platforms);
  return {
    tokenName: detail.symbol || '',
    tokenFullName: detail.name || '',
    tokenAttribute: '数币',
    displayPrecision: computeDisplayPrecision(usagePrecision),
    usagePrecision,
    tokenSymbol: detail.symbol || '',
    tokenPrice: formatTokenPrice(detail.priceUsd),
    priceUsd: Number(detail.priceUsd || 0),
    chainNames: uniqueChainNames(detail.platforms),
    remarkChains: buildRemarkChains(detail.platforms),
    precisionSourceChain: pickedPlatform ? pickedPlatform.contractPlatform || '' : '',
    precisionSourceVerified: pickedPlatform ? Boolean(pickedPlatform.decimalsVerified) : false,
    precisionSourceUrl: pickedPlatform ? pickedPlatform.contractExplorerUrl || pickedPlatform.contractBlockExplorerUrl || '' : '',
    remark: buildTokenConfigRemark(detail.platforms),
    verificationNote: buildVerificationNote(detail.platforms)
  };
}

async function fetchCmcListingCatalog(limit = 2000) {
  const safeLimit = Math.max(200, Math.min(5000, Number(limit || 2000)));
  if (cmcListingCache.items.length && (Date.now() - cmcListingCache.fetchedAt) < CMC_LISTING_TTL_MS && cmcListingCache.items.length >= safeLimit) {
    return cmcListingCache.items.slice(0, safeLimit);
  }
  const url = `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=1&limit=${safeLimit}&sortBy=market_cap&sortType=desc&convert=USD`;
  const payload = await fetchJson(url);
  const list = (((payload || {}).data || {}).cryptoCurrencyList || []).map((item) => ({
    id: Number(item.id || 0),
    name: item.name || '',
    symbol: item.symbol || '',
    slug: item.slug || '',
    rank: Number(item.cmcRank || 0),
    priceUsd: Number(item.quotes && item.quotes[0] && item.quotes[0].price || 0),
    marketCapUsd: Number(item.quotes && item.quotes[0] && item.quotes[0].marketCap || 0),
    searchKey: normalizeSearchKey(`${item.name || ''} ${item.symbol || ''} ${item.slug || ''}`)
  })).filter((item) => item.slug && item.name);
  cmcListingCache.fetchedAt = Date.now();
  cmcListingCache.items = list;
  return list;
}

function scoreCatalogMatch(item, queryKey) {
  if (!queryKey) return 0;
  const nameKey = normalizeSearchKey(item.name);
  const symbolKey = normalizeSearchKey(item.symbol);
  const slugKey = normalizeSearchKey(item.slug);
  if (symbolKey === queryKey) return 2000;
  if (nameKey === queryKey) return 1900;
  if (slugKey === queryKey) return 1800;
  if (nameKey.startsWith(queryKey)) return 1600;
  if (symbolKey.startsWith(queryKey)) return 1500;
  if (slugKey.startsWith(queryKey)) return 1400;
  if (item.searchKey.includes(queryKey)) return 1000;
  return 0;
}

async function searchCmcCatalog(query, options = {}) {
  const queryKey = normalizeSearchKey(query);
  if (!queryKey) return [];
  const limit = Math.max(1, Math.min(20, Number(options.limit || 8)));
  const catalog = await fetchCmcListingCatalog(options.catalogLimit || 2000);
  const matches = catalog
    .map((item) => ({ item, score: scoreCatalogMatch(item, queryKey) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aRank = a.item.rank || Number.MAX_SAFE_INTEGER;
      const bRank = b.item.rank || Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, limit);

  const detailed = await Promise.all(matches.map(async ({ item }) => {
    try {
      const detail = await fetchCmcCoinDetail(item.slug);
      return {
        slug: item.slug,
        id: item.id,
        name: item.name,
        symbol: item.symbol,
        rank: item.rank,
        fullName: detail.name || item.name,
        contractAddress: collectContractAddresses(detail.platforms)[0] || '',
        contractAddresses: collectContractAddresses(detail.platforms),
        chainCount: (detail.platforms || []).length
      };
    } catch {
      return {
        slug: item.slug,
        id: item.id,
        name: item.name,
        symbol: item.symbol,
        rank: item.rank,
        fullName: item.name,
        contractAddress: '',
        contractAddresses: [],
        chainCount: 0
      };
    }
  }));

  return detailed;
}

async function fetchSolanaMintDecimals(mintAddress) {
  const mint = String(mintAddress || '').trim();
  if (!mint) return 0;
  if (solanaMintDecimalsCache.has(mint)) return solanaMintDecimalsCache.get(mint);

  const payload = await fetchJson('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenSupply',
      params: [mint]
    })
  });
  const decimals = Number(payload && payload.result && payload.result.value && payload.result.value.decimals || 0);
  solanaMintDecimalsCache.set(mint, decimals);
  return decimals;
}

async function fetchTronTokenDecimals(contractAddress) {
  const address = String(contractAddress || '').trim();
  if (!address) return 0;
  if (tronDecimalsCache.has(address)) return tronDecimalsCache.get(address);
  const payload = await fetchJson('https://api.trongrid.io/wallet/triggerconstantcontract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_address: address,
      contract_address: address,
      function_selector: 'decimals()',
      visible: true
    })
  });
  const raw = String(payload && payload.constant_result && payload.constant_result[0] || '');
  const decimals = raw ? parseInt(raw, 16) : 0;
  tronDecimalsCache.set(address, decimals);
  return decimals;
}

async function fetchTonJettonDecimals(address) {
  const normalized = String(address || '').trim();
  if (!normalized) return 0;
  if (tonJettonDecimalsCache.has(normalized)) return tonJettonDecimalsCache.get(normalized);
  const payload = await fetchJson(`https://tonapi.io/v2/jettons/${encodeURIComponent(normalized)}`);
  const decimals = Number(payload && payload.metadata && payload.metadata.decimals || 0);
  tonJettonDecimalsCache.set(normalized, decimals);
  return decimals;
}

async function fetchSuiCoinDecimals(coinType) {
  const normalized = String(coinType || '').trim();
  if (!normalized) return 0;
  if (suiCoinDecimalsCache.has(normalized)) return suiCoinDecimalsCache.get(normalized);
  const payload = await fetchJson('https://fullnode.mainnet.sui.io:443', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'suix_getCoinMetadata',
      params: [normalized]
    })
  });
  const decimals = Number(payload && payload.result && payload.result.decimals || 0);
  suiCoinDecimalsCache.set(normalized, decimals);
  return decimals;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchAptosExplorerBundleText() {
  if (aptosExplorerCache.bundleText && (Date.now() - aptosExplorerCache.fetchedAt) < CMC_LISTING_TTL_MS) {
    return aptosExplorerCache.bundleText;
  }
  const html = await fetchText('https://explorer.aptoslabs.com/?network=mainnet');
  const match = html.match(/\/assets\/searchUtils-[^"]+\.js/i);
  if (!match) throw new Error('Unable to locate Aptos explorer metadata bundle');
  const bundleUrl = `https://explorer.aptoslabs.com${match[0]}`;
  const bundleText = await fetchText(bundleUrl);
  aptosExplorerCache.fetchedAt = Date.now();
  aptosExplorerCache.bundleUrl = bundleUrl;
  aptosExplorerCache.bundleText = bundleText;
  return bundleText;
}

async function fetchAptosTokenDecimals(address) {
  const normalized = String(address || '').trim().toLowerCase();
  if (!normalized) return 0;
  const bundleText = await fetchAptosExplorerBundleText();
  const regex = new RegExp(`"${escapeRegex(normalized)}":\\{[^}]{0,800}?decimals:(\\d+)`, 'i');
  const match = bundleText.match(regex);
  return match ? Number(match[1]) : 0;
}

function detectChainFamily(platform) {
  const name = String(platform && platform.contractPlatform || '').toLowerCase();
  const address = String(platform && platform.contractAddress || '').trim();
  const explorer = String(platform && platform.contractExplorerUrl || '').toLowerCase();
  const chainId = Number(platform && platform.contractChainId || 0);

  if (/solana/.test(name) || /solscan\.io/.test(explorer)) return 'solana';
  if (/tron/i.test(name) || /tronscan\.org/.test(explorer)) return 'tron';
  if (/\bton\b/.test(name) || /tonviewer\.com/.test(explorer)) return 'ton';
  if (/sui/i.test(name) || /suivision|suiscan/.test(explorer)) return 'sui';
  if (/aptos/i.test(name) || /aptoslabs\.com\/coin\//.test(explorer)) return 'aptos';
  if (/^0x[a-f0-9]{40}$/i.test(address) && chainId > 0) return 'evm';
  if (/etherscan|bscscan|polygonscan|arbiscan|basescan|ftmscan|gnosisscan|lineascan|scrollscan|blastscan|snowscan|hecoinfo|kaiascan|vicscan|okx\.com\/explorer\/xlayer|inkonchain/i.test(explorer)) return 'evm';
  if (/ethereum|base|arbitrum|optimism|polygon|avalanche|bnb|fantom|gnosis|heco|linea|scroll|blast|x layer|ink|kaia|viction|zksync/i.test(name) && /^0x/i.test(address)) return 'evm';
  return 'unknown';
}

function resolveEvmRpcUrl(platform) {
  const chainId = Number(platform && platform.contractChainId || 0);
  if (EVM_RPC_BY_CHAIN_ID[chainId]) return EVM_RPC_BY_CHAIN_ID[chainId];
  const fromPayload = Array.isArray(platform && platform.contractRpcUrls) ? platform.contractRpcUrls.find((url) => /^https?:\/\//i.test(String(url || '').trim())) : '';
  return fromPayload || '';
}

function decodeEvmUint(hexValue) {
  const raw = String(hexValue || '').trim();
  if (!/^0x[0-9a-f]+$/i.test(raw)) return 0;
  return parseInt(raw.slice(2), 16);
}

async function fetchEvmTokenDecimals(platform) {
  const address = String(platform && platform.contractAddress || '').trim();
  const rpcUrl = resolveEvmRpcUrl(platform);
  if (!address || !rpcUrl) return 0;
  const cacheKey = `${rpcUrl}:${address.toLowerCase()}`;
  if (evmDecimalsCache.has(cacheKey)) return evmDecimalsCache.get(cacheKey);
  const payload = await fetchJson(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [
        { to: address, data: EVM_DECIMALS_SELECTOR },
        'latest'
      ]
    })
  });
  const decimals = decodeEvmUint(payload && payload.result);
  evmDecimalsCache.set(cacheKey, decimals);
  return decimals;
}

async function enrichPlatformDecimals(platforms) {
  const list = Array.isArray(platforms) ? platforms : [];
  return Promise.all(list.map(async (platform) => {
    const next = { ...platform };
    next.chainFamily = detectChainFamily(platform);
    next.decimalsVerified = false;
    next.contractDecimalsSource = 'coinmarketcap';

    if (next.chainFamily === 'solana' && platform.contractAddress) {
      try {
        const decimals = await fetchSolanaMintDecimals(platform.contractAddress);
        if (Number.isFinite(decimals) && decimals > 0) {
          next.contractDecimals = decimals;
          next.contractDecimalsSource = 'solana-rpc';
          next.decimalsVerified = true;
        }
      } catch {
        // Keep CoinMarketCap fallback if Solana RPC is unavailable.
      }
    }

    if (next.chainFamily === 'evm' && platform.contractAddress) {
      try {
        const decimals = await fetchEvmTokenDecimals(platform);
        if (Number.isFinite(decimals) && decimals > 0) {
          next.contractDecimals = decimals;
          next.contractDecimalsSource = 'evm-rpc';
          next.decimalsVerified = true;
        }
      } catch {
        // Keep CoinMarketCap fallback if chain RPC is unavailable.
      }
    }

    if (next.chainFamily === 'tron' && platform.contractAddress) {
      try {
        const decimals = await fetchTronTokenDecimals(platform.contractAddress);
        if (Number.isFinite(decimals) && decimals > 0) {
          next.contractDecimals = decimals;
          next.contractDecimalsSource = 'tron-rpc';
          next.decimalsVerified = true;
        }
      } catch {
        // Keep CoinMarketCap fallback if Tron query is unavailable.
      }
    }

    if (next.chainFamily === 'ton' && platform.contractAddress) {
      try {
        const decimals = await fetchTonJettonDecimals(platform.contractAddress);
        if (Number.isFinite(decimals) && decimals > 0) {
          next.contractDecimals = decimals;
          next.contractDecimalsSource = 'ton-api';
          next.decimalsVerified = true;
        }
      } catch {
        // Keep CoinMarketCap fallback if TON query is unavailable.
      }
    }

    if (next.chainFamily === 'sui' && platform.contractAddress) {
      try {
        const decimals = await fetchSuiCoinDecimals(platform.contractAddress);
        if (Number.isFinite(decimals) && decimals > 0) {
          next.contractDecimals = decimals;
          next.contractDecimalsSource = 'sui-rpc';
          next.decimalsVerified = true;
        }
      } catch {
        // Keep CoinMarketCap fallback if Sui query is unavailable.
      }
    }

    if (next.chainFamily === 'aptos' && platform.contractAddress) {
      try {
        const decimals = await fetchAptosTokenDecimals(platform.contractAddress);
        if (Number.isFinite(decimals) && decimals > 0) {
          next.contractDecimals = decimals;
          next.contractDecimalsSource = 'aptos-explorer';
          next.decimalsVerified = true;
        }
      } catch {
        // Keep CoinMarketCap fallback if Aptos metadata lookup is unavailable.
      }
    }

    return next;
  }));
}

async function fetchCmcCoinDetail(slug) {
  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) throw new Error('slug is required');
  const cached = cmcDetailCache.get(normalizedSlug);
  if (cached && (Date.now() - cached.fetchedAt) < CMC_DETAIL_TTL_MS) {
    return cached.data;
  }

  const html = await fetchText(`https://coinmarketcap.com/currencies/${encodeURIComponent(normalizedSlug)}/`);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error(`Unable to parse CoinMarketCap page for ${normalizedSlug}`);
  const nextData = JSON.parse(match[1]);
  const detail = nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.detailRes && nextData.props.pageProps.detailRes.detail;
  if (!detail || !detail.slug) throw new Error(`Missing detail payload for ${normalizedSlug}`);

  const parsedPlatforms = await enrichPlatformDecimals((detail.platforms || []).map((platform) => ({
    contractAddress: platform.contractAddress || '',
    contractPlatform: platform.contractPlatform || '',
    contractChainId: Number(platform.contractChainId || 0),
    contractDecimals: Number(platform.contractDecimals || 0),
    contractRpcUrls: Array.isArray(platform.contractRpcUrl) ? platform.contractRpcUrl : [],
    contractExplorerUrl: platform.contractExplorerUrl || '',
    contractBlockExplorerUrl: platform.contractBlockExplorerUrl || ''
  })));

  const parsed = {
    id: Number(detail.id || 0),
    slug: detail.slug || normalizedSlug,
    name: detail.name || '',
    symbol: detail.symbol || '',
    rank: Number(detail.statistics && detail.statistics.rank || 0),
    category: detail.category || '',
    priceUsd: Number(detail.statistics && detail.statistics.price || 0),
    platforms: parsedPlatforms
  };

  cmcDetailCache.set(normalizedSlug, { fetchedAt: Date.now(), data: parsed });
  return parsed;
}

const WEBSITE_DISCOVERY_RULES = [
  { key: 'blog', regex: /\b(blog|newsroom|announcements?|updates?)\b/i, weight: 1 },
  { key: 'docs', regex: /\b(docs|documentation|developer docs|sdk|api reference)\b/i, weight: 2 },
  { key: 'developer', regex: /\b(builders?|developers?|devnet|testnet|hackathon)\b/i, weight: 2 },
  { key: 'ecosystem', regex: /\b(ecosystem|integrations?|partners?|supported by|wallet support)\b/i, weight: 2 },
  { key: 'grants', regex: /\b(grants?|builder program|accelerator|funding program)\b/i, weight: 2 },
  { key: 'mainnet', regex: /\b(mainnet|launch(ed)?|go live|rollout)\b/i, weight: 2 }
];

const DIRECTORY_HOST_BLOCKLIST = new Set([
  'x.com',
  'twitter.com',
  'discord.com',
  'youtube.com',
  'www.youtube.com',
  'reddit.com',
  'www.reddit.com',
  'lu.ma',
  'docs.zksync.io',
  'aptos.dev',
  'learn.aptoslabs.com',
  'explorer.zksync.io',
  'blog.sei.io',
  'build.avax.network',
  'github.com',
  'www.github.com',
  'link3.to',
  'hackenproof.com',
  'www.hackenproof.com',
  'typeform.com',
  'aptosfoundation.typeform.com'
]);

const DIRECTORY_NAME_STOPWORDS = new Set([
  'new',
  'view',
  'learn',
  'contact',
  'about',
  'explore',
  'launch',
  'join',
  'events',
  'terms',
  'privacy',
  'builder',
  'developers',
  'developer',
  'github',
  'submit'
]);

const DIRECTORY_NAME_VERBS = new Set([
  'create',
  'build',
  'power',
  'powering',
  'enable',
  'enables',
  'making',
  'make',
  'trusted',
  'bring',
  'brings',
  'invest',
  'trade',
  'earn',
  'connects',
  'connect',
  'unleash',
  'empowering',
  'empower'
]);

function toAbsoluteUrl(baseUrl, href) {
  const raw = String(href || '').trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('javascript:')) return '';
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return '';
  }
}

function extractWebsiteScanLinks(html, baseUrl) {
  const baseHost = safeHostname(baseUrl);
  if (!baseHost) return [];
  const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
  const links = [];
  let match = hrefRegex.exec(String(html || ''));
  while (match) {
    const absoluteUrl = toAbsoluteUrl(baseUrl, match[1]);
    const parsedHost = safeHostname(absoluteUrl);
    const lowerUrl = absoluteUrl.toLowerCase();
    if (
      absoluteUrl &&
      parsedHost === baseHost &&
      /\b(blog|news|announcement|updates?|docs|developer|developers|ecosystem|grant|grants|builder|builders|integrations?|partners?)\b/i.test(lowerUrl) &&
      !/\.(png|jpg|jpeg|gif|svg|webp|pdf|zip)$/i.test(lowerUrl)
    ) {
      links.push(absoluteUrl);
    }
    match = hrefRegex.exec(String(html || ''));
  }

  return Array.from(new Set(links)).slice(0, 4);
}

function extractTelegramLinks(html, baseUrl) {
  return Array.from(new Set(
    extractAnchorEntries(html, baseUrl)
      .map((entry) => entry.href)
      .filter((href) => /(?:t\.me|telegram\.me|telegram\.dog)\//i.test(href))
  )).slice(0, 4);
}

function extractEmailAddresses(text) {
  return Array.from(new Set(
    String(text || '')
      .match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || []
  )).slice(0, 4);
}

function extractAnchorEntries(html, baseUrl) {
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const entries = [];
  let match = anchorRegex.exec(String(html || ''));
  while (match) {
    const href = toAbsoluteUrl(baseUrl, match[1]);
    const text = safeText(decodeHtmlEntities(match[2]).replace(/<[^>]+>/g, ' '));
    if (href && text) {
      entries.push({ href, text });
    }
    match = anchorRegex.exec(String(html || ''));
  }
  return entries;
}

function inferDirectoryProjectName(text) {
  const normalized = safeText(decodeHtmlEntities(text || ''));
  if (!normalized) return '';
  const tokens = normalized.split(/\s+/);
  const nameParts = [];
  const connectors = new Set(['and', 'of', '&']);

  for (const token of tokens) {
    const clean = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.+&/-]+$/g, '');
    const lower = clean.toLowerCase();
    if (!clean) continue;
    if (clean.includes('.') || clean.includes('/')) break;
    if (DIRECTORY_NAME_VERBS.has(lower) && nameParts.length) break;
    if (DIRECTORY_NAME_STOPWORDS.has(lower) && !nameParts.length) return '';
    if (
      connectors.has(lower) ||
      /[A-Z]/.test(clean) ||
      /\d/.test(clean) ||
      /^[A-Z0-9]{2,}$/.test(clean)
    ) {
      nameParts.push(clean);
      if (nameParts.length >= 5) break;
      continue;
    }
    break;
  }

  const name = safeText(nameParts.join(' ')).replace(/\s+&$/, '');
  if (name.length < 3 || name.length > 48) return '';
  if (/^(ecosystem|builder resources|media kit|local communities|terms of service|bug bounty|submit project|github)$/i.test(name)) return '';
  return name;
}

function isProjectDirectoryLink(url, sourceHost) {
  const host = safeHostname(url);
  if (!host || host === sourceHost) return false;
  if (DIRECTORY_HOST_BLOCKLIST.has(host)) return false;
  if (/\b(docs|blog|news|media|jobs|careers|support|events|terms|privacy|brand|forum)\b/i.test(url)) return false;
  return true;
}

function extractOfficialEcosystemDirectoryItems(html, directory) {
  const sourceHost = safeHostname(directory?.url || '');
  if (!sourceHost) return [];
  const seen = new Set();

  return extractAnchorEntries(html, directory.url)
    .map((entry) => ({
      ...entry,
      name: inferDirectoryProjectName(entry.text)
    }))
    .filter((entry) => entry.name && isProjectDirectoryLink(entry.href, sourceHost))
    .filter((entry) => !/\b(community|communities|submit project|bug bounty|latest news|events|ambassador program)\b/i.test(entry.text))
    .filter((entry) => {
      const key = `${normalizeKey(entry.name)}::${safeHostname(entry.href)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(directory?.maxItems || 10)))
    .map((entry) => ({
      title: `${entry.name} joins ${directory.network || 'official'} ecosystem`,
      link: entry.href,
      pubDate: nowIso(),
      description: `Official ecosystem directory listing from ${directory.network || directory.name}. ${entry.text}`,
      source: directory.name || 'Official Ecosystem Directory',
      queryName: directory.name || 'Official Ecosystem Directory',
      queryGroup: directory.group || 'ecosystem'
    }));
}

async function fetchOfficialEcosystemDirectoryItems(sources) {
  const directories = Array.isArray(sources?.ecosystemDirectories) ? sources.ecosystemDirectories : [];
  const items = [];

  await Promise.all(directories.map(async (directory) => {
    try {
      const html = await fetchText(directory.url, { timeoutMs: 8000 });
      items.push(...extractOfficialEcosystemDirectoryItems(html, directory));
    } catch {
      // Ignore individual directory failures so the broader pipeline stays resilient.
    }
  }));

  return items;
}

function analyzeWebsiteDiscoverySignals(text) {
  const hits = [];
  let total = 0;
  for (const rule of WEBSITE_DISCOVERY_RULES) {
    if (rule.regex.test(String(text || ''))) {
      hits.push(rule.key);
      total += Number(rule.weight || 0);
    }
  }
  return { hits, total };
}

function inferWebsiteScanKind(url) {
  const value = String(url || '').toLowerCase();
  if (/\bdocs|developer|developers|sdk|api\b/.test(value)) return 'docs';
  if (/\becosystem|grant|builder|partner|integration\b/.test(value)) return 'ecosystem';
  if (/\bblog|news|announcement|update\b/.test(value)) return 'blog';
  return 'page';
}

async function refreshWebsiteTarget(cache, cacheKey, target, ttlHours) {
  if (!target?.website) return;
  if (isCacheFresh(cache.website[cacheKey], ttlHours)) return;

  try {
    const homepage = await fetchText(target.website);
    const homepageTitle = extractBetween(homepage, '<title[^>]*>', '</title>') || target.name || cacheKey;
    const description =
      extractBetween(homepage, 'name="description" content="', '"') ||
      extractBetween(homepage, "property=\"og:description\" content=\"", '"');
    const complianceRegex = /\b(compliant|regulat|institutional|mica|hong kong|singapore|uae|custody|licensed|regulated)\b/ig;
    const complianceHits = Array.from(new Set((homepage.match(complianceRegex) || []).map((item) => item.toLowerCase()))).slice(0, 6);

    const candidateLinks = [
      target.blogUrl || '',
      ...extractWebsiteScanLinks(homepage, target.website)
    ].filter(Boolean);
    const telegramLinks = extractTelegramLinks(homepage, target.website);
    const emailAddresses = extractEmailAddresses(homepage);

    const scanPages = [];
    for (const url of Array.from(new Set(candidateLinks)).slice(0, 3)) {
      try {
        const pageHtml = await fetchText(url);
        telegramLinks.push(...extractTelegramLinks(pageHtml, url));
        emailAddresses.push(...extractEmailAddresses(pageHtml));
        scanPages.push({
          url,
          kind: inferWebsiteScanKind(url),
          title: stripTags(extractBetween(pageHtml, '<title[^>]*>', '</title>')) || safeText(url).slice(0, 120)
        });
      } catch {
        // Ignore individual subpage failures to keep homepage enrichment resilient.
      }
    }

    const discoveryText = [
      homepageTitle,
      description,
      ...scanPages.map((page) => `${page.kind} ${page.title} ${page.url}`)
    ].join('\n');
    const discovery = analyzeWebsiteDiscoverySignals(discoveryText);

    cache.website[cacheKey] = {
      fetchedAt: nowIso(),
      title: stripTags(homepageTitle),
      description: stripTags(description),
      complianceHits,
      blogUrl: target.blogUrl || '',
      siteUrl: target.website,
      scanPages,
      discoverySignals: discovery.hits,
      telegramLinks: Array.from(new Set(telegramLinks)),
      emailAddresses: Array.from(new Set(emailAddresses))
    };
  } catch (error) {
    cache.website[cacheKey] = {
      fetchedAt: nowIso(),
      error: error.message
    };
  }
}

function inferContact(project, profile) {
  if (profile && profile.contact) return profile.contact;
  return null;
}

function isPlaceholderContact(contact) {
  const value = safeText(contact?.value || '');
  return /use official website or x for first contact/i.test(value);
}

function buildInterpretation(project, profile) {
  if (profile && Array.isArray(profile.interpretation) && profile.interpretation.length) {
    return profile.interpretation;
  }
  const notes = [];
  if (project.signals.includes('hongKong')) {
    notes.push('项目公开语境里已经出现香港或监管相关信号，说明它有机会接受更正式的市场准入讨论。');
  }
  if (project.signals.includes('institutional')) {
    notes.push('它的叙事更偏机构客户，而不是纯散户交易量，这和合规交易平台的价值主张更接近。');
  }
  if (project.signals.includes('funding')) {
    notes.push('近期融资或资本市场信号通常意味着团队有预算、节奏和更强的渠道扩张意愿。');
  }
  if (project.signals.includes('listing')) {
    notes.push('项目已经在谈流动性或上所相关语义，更适合快速判断其是否进入二级市场窗口。');
  }
  if (!notes.length) {
    notes.push('当前公开信号还偏早期，建议先做项目画像和组织结构判断，再决定是否触达。');
  }
  return notes;
}

async function refreshCoinGeckoData(rootDir, config, cache, profiles) {
  const key = config.apis?.coingeckoDemoKey;
  if (!key) return;
  const ttlHours = config.apis?.cacheHours?.coingecko || 12;
  const staleProfiles = profiles.filter((profile) => profile.coingeckoId && !isCacheFresh(cache.coingecko[profile.coingeckoId], ttlHours));
  if (staleProfiles.length === 0) return;

  const ids = Array.from(new Set(staleProfiles.map((profile) => profile.coingeckoId)));
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(','))}&price_change_percentage=24h`;
  const rows = await fetchJson(url, {
    headers: { 'x-cg-demo-api-key': key }
  });
  for (const row of rows || []) {
    cache.coingecko[row.id] = {
      fetchedAt: nowIso(),
      marketCapUsd: row.market_cap || 0,
      dailyVolumeUsd: row.total_volume || 0,
      priceChange24h: row.price_change_percentage_24h || 0,
      symbol: row.symbol || '',
      name: row.name || '',
      coingeckoId: row.id
    };
  }
}

async function refreshDefiLlamaData(rootDir, config, cache, profiles) {
  const ttlHours = config.apis?.cacheHours?.defillama || 12;
  if (isCacheFresh(cache.defillama.__all, ttlHours)) return;
  const rows = await fetchJson('https://api.llama.fi/protocols');
  const wantedKeys = new Set(
    (profiles || []).flatMap((profile) => [
      normalizeKey(profile.name || ''),
      normalizeKey(profile.defillamaSlug || '')
    ]).filter(Boolean)
  );
  const protocols = {};
  for (const row of rows || []) {
    const rowKeys = [normalizeKey(row.name || ''), normalizeKey(row.slug || '')].filter(Boolean);
    if (!rowKeys.some((key) => wantedKeys.has(key))) continue;
    for (const key of rowKeys) {
      protocols[key] = {
        slug: row.slug || '',
        name: row.name || '',
        tvlUsd: row.tvl || 0,
        category: row.category || '',
        chains: row.chains || []
      };
    }
  }
  cache.defillama.__all = {
    fetchedAt: nowIso(),
    protocols
  };
}

async function refreshCryptoRankCatalog(rootDir, config, cache) {
  const key = config.apis?.cryptoRankKey;
  if (!key) return;
  const ttlHours = config.apis?.cacheHours?.cryptorank || 24;
  if (isCacheFresh(cache.cryptorank.__catalog, ttlHours)) return;

  const response = await fetchJson(`https://api.cryptorank.io/v1/currencies?limit=5000&api_key=${encodeURIComponent(key)}`);
  const rows = Array.isArray(response?.data) ? response.data : [];
  cache.cryptorank.__catalog = {
    fetchedAt: nowIso(),
    ...buildCryptoRankCatalog(rows)
  };
}

async function refreshCryptoRankFundingRounds(rootDir, config, cache, projects) {
  const key = config.apis?.cryptoRankKey;
  if (!key) return;
  const ttlHours = config.apis?.cacheHours?.cryptorank || 24;
  const catalog = cache.cryptorank.__catalog || {};
  const fundingCandidates = (projects || []).filter((project) => {
    const discoveryPath = String(project?.discoveryPath || project?.radarBucket || '');
    const hasFundingSignal = Array.isArray(project?.signals) && project.signals.includes('funding');
    return discoveryPath === 'fundraising' || hasFundingSignal || Boolean(project?.fundraising);
  });

  await mapWithConcurrency(fundingCandidates, 4, async (project) => {
    const match =
      catalog.bySlug?.[normalizeKey(project.slug || '')] ||
      catalog.byName?.[normalizeKey(project.name || '')] ||
      catalog.bySymbol?.[normalizeKey(project.symbol || '')];
    const slug = match?.slug || project.slug || '';
    if (!slug) return;
    const cacheKey = `funding:${slug}`;
    if (isCacheFresh(cache.cryptorank[cacheKey], ttlHours)) return;

    try {
      const html = await fetchText(`https://cryptorank.io/ico/${encodeURIComponent(slug)}`, { timeoutMs: 8000 });
      const rounds = parseCryptoRankFundingPage(html);
      cache.cryptorank[cacheKey] = {
        fetchedAt: nowIso(),
        slug,
        rounds
      };
    } catch (error) {
      cache.cryptorank[cacheKey] = {
        fetchedAt: nowIso(),
        slug,
        error: error.message
      };
    }
  });
}

async function refreshWebsiteSignals(rootDir, config, cache, profiles) {
  const ttlHours = config.apis?.cacheHours?.website || 24;
  await mapWithConcurrency(profiles, 3, async (profile) => {
    if (!profile.website) return;
    const cacheKey = profile.slug || profile.name;
    await refreshWebsiteTarget(cache, cacheKey, {
      name: profile.name,
      website: profile.website,
      blogUrl: profile.blogUrl || ''
    }, ttlHours);
  });
}

function resolveProjectWebsiteTarget(project, profile, cache) {
  const rootdata =
    cache.rootdata[project?.slug || ''] ||
    cache.rootdata[project?.name || ''] ||
    cache.rootdata[slugify(project?.name || '')] ||
    null;
  const website = profile?.website || project?.website || rootdata?.website || '';
  if (!website) return null;
  return {
    cacheKey: profile?.slug || project?.slug || project?.name,
    target: {
      name: project?.name || profile?.name || '',
      website,
      blogUrl: profile?.blogUrl || ''
    }
  };
}

async function refreshWebsiteSignalsForProjects(rootDir, config, cache, projects) {
  const ttlHours = config.apis?.cacheHours?.website || 24;
  const profiles = loadProfiles(rootDir);
  await mapWithConcurrency(projects || [], 3, async (project) => {
    const profile = profiles.get(normalizeKey(project.name)) || null;
    const resolved = resolveProjectWebsiteTarget(project, profile, cache);
    if (!resolved?.cacheKey) return;
    await refreshWebsiteTarget(cache, resolved.cacheKey, resolved.target, ttlHours);
  });
}

async function refreshRootData(rootDir, config, cache, profiles) {
  const key = config.apis?.rootDataKey;
  if (!key) return;
  const ttlHours = config.apis?.cacheHours?.rootdata || 24;
  for (const profile of profiles) {
    const cacheKey = profile.slug || profile.name;
    if (isCacheFresh(cache.rootdata[cacheKey], ttlHours)) continue;
    try {
      const response = await fetchText('https://api.rootdata.com/open/ser_inv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          language: 'en'
        },
        body: JSON.stringify({ input: profile.name })
      });
      const json = JSON.parse(response);
      const first = Array.isArray(json?.data) ? json.data[0] : null;
      cache.rootdata[cacheKey] = {
        fetchedAt: nowIso(),
        projectName: first?.project_name || '',
        projectType: first?.project_type || '',
        description: first?.description || '',
        website: first?.website || ''
      };
    } catch (error) {
      cache.rootdata[cacheKey] = {
        fetchedAt: nowIso(),
        error: error.message
      };
    }
  }
}

async function refreshRootDataForProjectNames(rootDir, config, cache, projects) {
  const key = config.apis?.rootDataKey;
  if (!key) return;
  const ttlHours = config.apis?.cacheHours?.rootdata || 24;
  for (const project of projects || []) {
    const lookupName = safeText(project.name || '');
    if (!lookupName) continue;
    const cacheKeys = Array.from(new Set([project.slug, project.name, slugify(lookupName)].filter(Boolean)));
    if (cacheKeys.some((cacheKey) => isCacheFresh(cache.rootdata[cacheKey], ttlHours))) continue;
    try {
      const response = await fetchText('https://api.rootdata.com/open/ser_inv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          language: 'en'
        },
        body: JSON.stringify({ input: lookupName })
      });
      const json = JSON.parse(response);
      const first = Array.isArray(json?.data) ? json.data[0] : null;
      const payload = {
        fetchedAt: nowIso(),
        projectName: first?.project_name || '',
        projectType: first?.project_type || '',
        description: first?.description || '',
        website: first?.website || ''
      };
      cacheKeys.forEach((cacheKey) => { cache.rootdata[cacheKey] = payload; });
    } catch (error) {
      const payload = {
        fetchedAt: nowIso(),
        error: error.message
      };
      cacheKeys.forEach((cacheKey) => { cache.rootdata[cacheKey] = payload; });
    }
  }
}

function extractTwitterUsername(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.replace(/^@/, '').trim();
  if (!/^https?:\/\//i.test(direct)) return direct;
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return (parts[0] || '').replace(/^@/, '').trim();
  } catch {
    return '';
  }
}

async function refreshOpenNewsData(rootDir, config, cache, profiles) {
  const token = config.apis?.team6551Token;
  if (!token) return;
  const ttlHours = config.apis?.cacheHours?.opennews || 12;

  for (const profile of profiles) {
    const cacheKey = profile.slug || profile.name;
    if (isCacheFresh(cache.opennews[cacheKey], ttlHours)) continue;
    try {
      const payload = {
        q: profile.name,
        limit: 5,
        page: 1
      };
      if (profile.symbol) payload.coins = [String(profile.symbol).toUpperCase()];
      const json = await fetchJson('https://ai.6551.io/open/news_search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      cache.opennews[cacheKey] = {
        fetchedAt: nowIso(),
        articles: rows.slice(0, 5).map((row) => ({
          id: row.id || '',
          text: safeText(row.text || row.title || ''),
          link: row.link || '',
          newsType: row.newsType || '',
          engineType: row.engineType || '',
          coins: Array.isArray(row.coins) ? row.coins : [],
          aiRating: row.aiRating || null,
          ts: row.ts || 0
        }))
      };
    } catch (error) {
      cache.opennews[cacheKey] = {
        fetchedAt: nowIso(),
        error: error.message
      };
    }
  }
}

async function refreshOpenTwitterData(rootDir, config, cache, profiles) {
  const token = config.apis?.team6551Token;
  if (!token) return;
  const ttlHours = config.apis?.cacheHours?.opentwitter || 12;

  for (const profile of profiles) {
    const username = extractTwitterUsername(profile.twitter || '');
    if (!username) continue;
    const cacheKey = profile.slug || profile.name;
    if (isCacheFresh(cache.opentwitter[cacheKey], ttlHours)) continue;
    try {
      const json = await fetchJson('https://ai.6551.io/open/twitter_user_tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          maxResults: 5,
          product: 'Latest',
          includeReplies: false,
          includeRetweets: false
        })
      });

      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      cache.opentwitter[cacheKey] = {
        fetchedAt: nowIso(),
        username,
        tweets: rows.slice(0, 5).map((row) => ({
          id: row.id || '',
          text: safeText(row.text || ''),
          createdAt: row.createdAt || '',
          retweetCount: Number(row.retweetCount || 0),
          favoriteCount: Number(row.favoriteCount || 0),
          replyCount: Number(row.replyCount || 0),
          hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
          urls: Array.isArray(row.urls) ? row.urls : []
        }))
      };
    } catch (error) {
      cache.opentwitter[cacheKey] = {
        fetchedAt: nowIso(),
        username,
        error: error.message
      };
    }
  }
}

async function refreshOpenTwitterWatchlistData(rootDir, config, cache, handles) {
  const token = config.apis?.team6551Token;
  if (!token) return;
  const ttlHours = config.apis?.cacheHours?.opentwitter || 12;

  for (const handle of handles || []) {
    const username = extractTwitterUsername(handle);
    if (!username) continue;
    const cacheKey = `watch:${username.toLowerCase()}`;
    if (isCacheFresh(cache.opentwitter[cacheKey], ttlHours)) continue;
    try {
      const json = await fetchJson('https://ai.6551.io/open/twitter_user_tweets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          maxResults: 8,
          product: 'Latest',
          includeReplies: true,
          includeRetweets: true
        })
      });

      const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      cache.opentwitter[cacheKey] = {
        fetchedAt: nowIso(),
        username,
        tweets: rows.slice(0, 8).map((row) => ({
          id: row.id || '',
          text: safeText(row.text || ''),
          createdAt: row.createdAt || '',
          retweetCount: Number(row.retweetCount || 0),
          favoriteCount: Number(row.favoriteCount || 0),
          replyCount: Number(row.replyCount || 0),
          hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
          urls: Array.isArray(row.urls) ? row.urls : []
        }))
      };
    } catch (error) {
      cache.opentwitter[cacheKey] = {
        fetchedAt: nowIso(),
        username,
        error: error.message
      };
    }
  }
}

async function refreshExternalCaches(rootDir, config) {
  const profiles = loadProfileList(rootDir);
  const xWatchHandles = loadXWatchlist(rootDir);
  const cache = loadApiCache(rootDir);

  await refreshCoinGeckoData(rootDir, config, cache, profiles).catch(() => { });
  await refreshDefiLlamaData(rootDir, config, cache, profiles).catch(() => { });
  await refreshCryptoRankCatalog(rootDir, config, cache).catch(() => { });
  await refreshWebsiteSignals(rootDir, config, cache, profiles).catch(() => { });
  await refreshRootData(rootDir, config, cache, profiles).catch(() => { });
  await refreshOpenNewsData(rootDir, config, cache, profiles).catch(() => { });
  await refreshOpenTwitterData(rootDir, config, cache, profiles).catch(() => { });
  await refreshOpenTwitterWatchlistData(rootDir, config, cache, xWatchHandles).catch(() => { });

  saveApiCache(rootDir, cache);
  return cache;
}

function mergeExternalDataIntoProject(project, profile, cache) {
  const coingecko = profile?.coingeckoId ? cache.coingecko[profile.coingeckoId] : null;
  const defillamaAll = cache.defillama.__all?.protocols || {};
  const defillama = profile?.defillamaSlug
    ? defillamaAll[normalizeKey(profile.defillamaSlug)] || defillamaAll[normalizeKey(profile.name)]
    : defillamaAll[normalizeKey(project.name)];
  const cryptoRankCatalog = cache.cryptorank.__catalog || {};
  const cryptorank =
    cryptoRankCatalog.bySlug?.[normalizeKey(project.slug || '')] ||
    cryptoRankCatalog.byName?.[normalizeKey(project.name || '')] ||
    cryptoRankCatalog.bySymbol?.[normalizeKey(profile?.symbol || project.symbol || '')] ||
    null;
  const cryptoRankFunding = cryptorank?.slug ? cache.cryptorank[`funding:${cryptorank.slug}`] || null : null;
  const fundingRounds = Array.isArray(cryptoRankFunding?.rounds) ? cryptoRankFunding.rounds : [];
  const latestFundingRound = fundingRounds[0] || null;
  const website = cache.website[profile?.slug || project.slug || project.name] || null;
  const rootdata = cache.rootdata[profile?.slug || ''] || cache.rootdata[profile?.name || ''] || cache.rootdata[project.slug || ''] || cache.rootdata[project.name || ''] || cache.rootdata[slugify(project.name || '')] || null;
  const opennews = cache.opennews[profile?.slug || project.slug || project.name] || null;
  const opentwitter = cache.opentwitter[profile?.slug || project.slug || project.name] || null;

  const screening = {
    ...(project.screening || {})
  };
  if (defillama?.tvlUsd) screening.tvlUsd = Number(defillama.tvlUsd || screening.tvlUsd || 0);
  if (coingecko?.marketCapUsd) screening.marketCapUsd = Number(coingecko.marketCapUsd || screening.marketCapUsd || 0);
  else if (cryptorank?.marketCapUsd) screening.marketCapUsd = Number(cryptorank.marketCapUsd || screening.marketCapUsd || 0);
  if (coingecko?.dailyVolumeUsd) screening.dailyVolumeUsd = Number(coingecko.dailyVolumeUsd || screening.dailyVolumeUsd || 0);
  else if (cryptorank?.volume24hUsd) screening.dailyVolumeUsd = Number(cryptorank.volume24hUsd || screening.dailyVolumeUsd || 0);

  const sourceNotes = [...(project.sourceNotes || [])];
  if (coingecko) sourceNotes.push(`CoinGecko live cache: mcap ${formatCompactUsd(coingecko.marketCapUsd)}, volume ${formatCompactUsd(coingecko.dailyVolumeUsd)}`);
  if (defillama) sourceNotes.push(`DeFiLlama live cache: TVL ${formatCompactUsd(defillama.tvlUsd)} in ${defillama.category || 'protocol'} category`);
  if (cryptorank) sourceNotes.push(`CryptoRank cache: rank ${cryptorank.rank || 'n/a'}, ${cryptorank.category || cryptorank.type || 'unclassified'} / ${formatCompactUsd(cryptorank.marketCapUsd)}`);
  if (latestFundingRound) sourceNotes.push(`CryptoRank funding: ${latestFundingRound.roundStage || 'round'} on ${latestFundingRound.announcedAt ? latestFundingRound.announcedAt.slice(0, 10) : 'n/a'} with ${latestFundingRound.investorsCount || 0} investors`);
  if (website?.complianceHits?.length) sourceNotes.push(`Website/blog signals: ${website.complianceHits.join(', ')}`);
  if (website?.discoverySignals?.length) sourceNotes.push(`Website discovery: ${website.discoverySignals.join(', ')}`);
  if (rootdata?.projectType || rootdata?.description) sourceNotes.push(`RootData cache: ${safeText(rootdata.projectType || rootdata.description).slice(0, 120)}`);
  if (opennews?.articles?.length) sourceNotes.push(`OpenNews: ${opennews.articles.length} recent articles with AI ratings/search metadata`);
  if (opentwitter?.tweets?.length) sourceNotes.push(`OpenTwitter: ${opentwitter.tweets.length} recent posts from @${opentwitter.username || extractTwitterUsername(profile?.twitter || '')}`);

  const liveSignals = {
    coingecko: coingecko ? {
      fetchedAt: coingecko.fetchedAt || '',
      marketCapUsd: Number(coingecko.marketCapUsd || 0),
      dailyVolumeUsd: Number(coingecko.dailyVolumeUsd || 0),
      priceChange24h: Number(coingecko.priceChange24h || 0),
      symbol: coingecko.symbol || '',
      name: coingecko.name || '',
      coingeckoId: coingecko.coingeckoId || ''
    } : null,
    defillama: defillama ? {
      fetchedAt: cache.defillama.__all?.fetchedAt || '',
      tvlUsd: Number(defillama.tvlUsd || 0),
      category: defillama.category || '',
      chains: Array.isArray(defillama.chains) ? defillama.chains : [],
      slug: defillama.slug || ''
    } : null,
    cryptorank: cryptorank ? {
      fetchedAt: cache.cryptorank.__catalog?.fetchedAt || '',
      id: Number(cryptorank.id || 0),
      name: cryptorank.name || '',
      slug: cryptorank.slug || '',
      symbol: cryptorank.symbol || '',
      rank: Number(cryptorank.rank || 0),
      category: cryptorank.category || '',
      type: cryptorank.type || '',
      marketCapUsd: Number(cryptorank.marketCapUsd || 0),
      volume24hUsd: Number(cryptorank.volume24hUsd || 0),
      rounds: fundingRounds,
      latestRound: latestFundingRound,
      fundingFetchedAt: cryptoRankFunding?.fetchedAt || '',
      fundingError: cryptoRankFunding?.error || ''
    } : null,
    website: website ? {
      fetchedAt: website.fetchedAt || '',
      title: website.title || '',
      description: website.description || '',
      complianceHits: Array.isArray(website.complianceHits) ? website.complianceHits : [],
      blogUrl: website.blogUrl || '',
      siteUrl: website.siteUrl || '',
      scanPages: Array.isArray(website.scanPages) ? website.scanPages : [],
      discoverySignals: Array.isArray(website.discoverySignals) ? website.discoverySignals : [],
      telegramLinks: Array.isArray(website.telegramLinks) ? website.telegramLinks : [],
      emailAddresses: Array.isArray(website.emailAddresses) ? website.emailAddresses : [],
      error: website.error || ''
    } : null,
    rootdata: rootdata ? {
      fetchedAt: rootdata.fetchedAt || '',
      projectName: rootdata.projectName || '',
      projectType: rootdata.projectType || '',
      description: rootdata.description || '',
      website: rootdata.website || '',
      error: rootdata.error || ''
    } : null,
    opennews: opennews ? {
      fetchedAt: opennews.fetchedAt || '',
      articles: Array.isArray(opennews.articles) ? opennews.articles : [],
      error: opennews.error || ''
    } : null,
    opentwitter: opentwitter ? {
      fetchedAt: opentwitter.fetchedAt || '',
      username: opentwitter.username || '',
      tweets: Array.isArray(opentwitter.tweets) ? opentwitter.tweets : [],
      error: opentwitter.error || ''
    } : null
  };

  const hongKongPattern = /\b(hong kong|hksar|sfc)\b/i;
  const compliancePattern = /\b(compliance|compliant|regulated|regulatory|licensed|licensing|institutional grade|regulated markets|legal opinion)\b/i;
  const combinedSignalText = [
    project.name,
    project.reasonSummary,
    ...(project.signals || []),
    ...(project.mentions || []).map((mention) => `${mention.title || ''} ${mention.source || ''}`),
    cryptorank ? `${cryptorank.name || ''} ${cryptorank.category || ''} ${cryptorank.type || ''}` : '',
    website?.description || '',
    ...(website?.complianceHits || []),
    ...(opennews?.articles || []).map((article) => article.text || ''),
    ...(opentwitter?.tweets || []).map((tweet) => tweet.text || ''),
    ...(profile?.screening?.complianceSignals || []),
    ...(profile?.screening?.strategicFit || [])
  ].join('\n');
  const hasHongKongSignal = (project.signals || []).includes('hongKong') || hongKongPattern.test(combinedSignalText);
  const hasComplianceSignal = (project.signals || []).includes('compliance') || compliancePattern.test(combinedSignalText);
  const hongKongFit = hasHongKongSignal && hasComplianceSignal;

  return {
    ...project,
    website: project.website || profile?.website || website?.siteUrl || rootdata?.website || '',
    twitter: project.twitter || profile?.twitter || (opentwitter?.username ? `https://x.com/${opentwitter.username}` : ''),
    contact: isPlaceholderContact(project.contact) ? (profile ? inferContact(project, profile) : null) : (project.contact || (profile ? inferContact(project, profile) : null)),
    secondaryContact: isPlaceholderContact(project.secondaryContact) ? null : (project.secondaryContact || profile?.secondaryContact || null),
    screening,
    sourceNotes: Array.from(new Set(sourceNotes)),
    liveSignals,
    fundraising: latestFundingRound ? {
      source: 'CryptoRank',
      latestRound: latestFundingRound,
      rounds: fundingRounds
    } : project.fundraising || null,
    hongKongFit
  };
}

function hasProjectIdentityAnchor(project) {
  const telegramLinks = project?.liveSignals?.website?.telegramLinks || [];
  return Boolean(
    safeText(project?.website || '') ||
    safeText(project?.twitter || '') ||
    safeText(project?.contact?.value || '') ||
    safeText(project?.secondaryContact?.value || '') ||
    safeText(project?.liveSignals?.website?.siteUrl || '') ||
    safeText(project?.liveSignals?.rootdata?.website || '') ||
    telegramLinks.length
  );
}

function filterProjectsWithIdentity(projects) {
  return (projects || []).filter((project) => hasProjectIdentityAnchor(project));
}

function retainRadarProjects(currentProjects, previousProjects, options = {}) {
  const retentionDays = Number(options.retentionDays || 10);
  const cutoffMs = Date.now() - retentionDays * 86400000;
  const previousGeneratedAtMs = Date.parse(options.previousGeneratedAt || 0);
  const retainedAtFallback = options.currentGeneratedAt || nowIso();
  const currentMap = new Map((currentProjects || []).map((project) => [
    normalizeKey(project.name),
    {
      ...project,
      radarRetainedAt: project.radarRetainedAt || retainedAtFallback
    }
  ]));

  for (const project of previousProjects || []) {
    const key = normalizeKey(project.name);
    if (!key || currentMap.has(key)) continue;
    const seenAt = Date.parse(
      project.radarRetainedAt ||
      project.retainedAt ||
      (previousGeneratedAtMs ? options.previousGeneratedAt : '') ||
      project.latestSeenAt ||
      project.firstSeenAt ||
      0
    );
    if (!seenAt || seenAt < cutoffMs) continue;
    currentMap.set(key, {
      ...project,
      freshness: project.freshness || 'repeat',
      radarRetainedAt: project.radarRetainedAt || project.retainedAt || options.previousGeneratedAt || retainedAtFallback
    });
  }

  return Array.from(currentMap.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Date.parse(b.latestSeenAt || 0) - Date.parse(a.latestSeenAt || 0));
}

function dedupeProjectsByName(projects) {
  const seen = new Set();
  return (projects || []).filter((project) => {
    const key = normalizeKey(project?.name || '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldDisplayInRadarPool(project) {
  return Number(project?.score || 0) >= 15;
}

function formatCompactUsd(value) {
  const num = Number(value || 0);
  if (!num) return '$0';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toFixed(0)}`;
}

async function enrichWithExternalSources(rootDir, config, projects) {
  const profiles = loadProfileList(rootDir);
  const cache = loadApiCache(rootDir);

  await refreshCoinGeckoData(rootDir, config, cache, profiles).catch(() => { });
  await refreshDefiLlamaData(rootDir, config, cache, profiles).catch(() => { });
  await refreshCryptoRankCatalog(rootDir, config, cache).catch(() => { });
  await refreshCryptoRankFundingRounds(rootDir, config, cache, projects).catch(() => { });
  await refreshWebsiteSignals(rootDir, config, cache, profiles).catch(() => { });
  await refreshRootData(rootDir, config, cache, profiles).catch(() => { });
  await refreshRootDataForProjectNames(rootDir, config, cache, projects).catch(() => { });
  await refreshWebsiteSignalsForProjects(rootDir, config, cache, projects).catch(() => { });
  saveApiCache(rootDir, cache);

  const profileMap = loadProfiles(rootDir);
  return projects.map((project) => mergeExternalDataIntoProject(project, profileMap.get(normalizeKey(project.name)), cache));
}

function isCompetitorOrVenue(projectName, text, rules) {
  const competitors = (rules.competitors || []).map(normalizeKey);
  if (competitors.includes(normalizeKey(projectName))) return true;
  const projectNameLooksLikeVenue = /\b(exchange|trading venue|licensed exchange|markets?)\b/i.test(projectName);
  if (projectNameLooksLikeVenue) {
    return true;
  }
  return false;
}

function isAlreadyListedOnOslGlobal(projectName, projectSymbol, listedAssets) {
  const nameKey = normalizeKey(projectName);
  const symbolKey = String(projectSymbol || '').trim().toLowerCase();
  return (listedAssets || []).some((asset) => {
    const listedName = normalizeKey(asset.name || '');
    const listedSymbol = String(asset.symbol || '').trim().toLowerCase();
    return nameKey === listedName || (symbolKey && listedSymbol && symbolKey === listedSymbol);
  });
}

function findProfileMention(title, description, profileList) {
  const haystack = `${title || ''}\n${description || ''}`;
  const matches = [];
  for (const profile of profileList || []) {
    const name = normalizeProjectName(profile.name || '');
    if (!name) continue;
    let score = 0;
    const fullNameRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
    if (fullNameRegex.test(title || '')) score += 5;
    else if (fullNameRegex.test(haystack)) score += 3;

    const symbol = String(profile.symbol || '').trim();
    if (symbol) {
      const symbolRegex = new RegExp(`\\$?\\b${escapeRegex(symbol)}\\b`, 'i');
      if (symbolRegex.test(title || '')) score += 2;
      else if (symbolRegex.test(haystack)) score += 1;
    }

    if (score > 0) matches.push({ profile, score });
  }
  matches.sort((a, b) => b.score - a.score || a.profile.name.length - b.profile.name.length);
  return matches[0] ? matches[0].profile : null;
}

function isLikelyCryptoProjectName(name) {
  const clean = normalizeProjectName(name || '');
  if (!clean) return false;
  if (clean.length < 2 || clean.length > 36) return false;
  if (/^[A-Z0-9]{20,}$/i.test(clean)) return false;
  if (/^\d+$/.test(clean)) return false;
  if (/^(hong kong|asia|crypto|web3|exchange|market|markets|equity|consensus hong kong)$/i.test(clean)) return false;
  if (/\b(launches|launch|listed|listing|ceo|price|prediction|brokers|bank|banks|reportedly|under|raises?)\b/i.test(clean)) return false;
  const words = clean.split(/\s+/);
  if (words.length > 4) return false;
  if (words.every((word) => PROJECT_STOPWORDS.has(word))) return false;
  return true;
}

function isLowQualityMention(mention) {
  const text = `${mention?.title || ''}\n${mention?.source || ''}`.toLowerCase();
  return /\b(price prediction|to explode|under \$|bull run|listing buzz|mainnet migration|how high|technical analysis|will .* hit|\bvs\b)\b/i.test(text);
}

function projectNamePattern(name) {
  const clean = normalizeProjectName(name || '');
  if (!clean) return null;
  return new RegExp(`\\b${escapeRegex(clean).replace(/\\ /g, '\\s+')}\\b`, 'i');
}

function symbolPattern(symbol) {
  const clean = String(symbol || '').trim();
  if (!clean) return null;
  return new RegExp(`(?:\\$|\\b)${escapeRegex(clean)}\\b`, 'i');
}

function safeHostname(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isRelevantMentionForProject(mention, project, profile) {
  const title = safeText(mention?.title || '');
  const source = safeText(mention?.source || '');
  const text = `${title}\n${source}`.trim();
  const link = String(mention?.link || '').toLowerCase();
  if (!text) return false;
  if (isLowQualityMention(mention)) return false;
  if (/\b(price prediction|technical analysis|market wrap|live updates?)\b/i.test(text)) return false;

  const nameRegex = projectNamePattern(project?.name || profile?.name || '');
  const symbolRegex = symbolPattern(profile?.symbol || project?.symbol || '');
  const mentionsProject = (nameRegex && nameRegex.test(text)) || (symbolRegex && symbolRegex.test(text));
  if (!mentionsProject) return false;

  const trustedSource =
    (profile?.twitter && link.includes(extractTwitterUsername(profile.twitter).toLowerCase())) ||
    (profile?.website && safeHostname(profile.website) && link.includes(safeHostname(profile.website))) ||
    /\b(twitter|x|coindesk|the block|blockworks|defiant|dl news|decrypt|cointelegraph|fortune|ft|news websites|official blog)\b/i.test(source);

  const genericBadSource = /\b(foxnews|nyt|new york times|cnn|reuters world|bloomberg politics)\b/i.test(link + ' ' + source);
  const contextEvidence = /\b(protocol|network|token|stablecoin|rwa|defi|mainnet|treasury|yield|blockchain|onchain|institutional|custody|crypto)\b/i.test(text);

  if (genericBadSource && !contextEvidence) return false;
  return Boolean(trustedSource || contextEvidence);
}

function classifyMentionSource(mention, profile) {
  const title = safeText(mention?.title || '');
  const source = safeText(mention?.source || '');
  const link = String(mention?.link || '').toLowerCase();
  const text = `${title}\n${source}`;
  const twitterUsername = extractTwitterUsername(profile?.twitter || '').toLowerCase();
  const websiteHost = safeHostname(profile?.website || '');

  if (twitterUsername && link.includes(twitterUsername)) {
    return { tier: 'official', weight: 4, label: 'Official X' };
  }
  if (websiteHost && link.includes(websiteHost)) {
    return { tier: 'official', weight: 4, label: 'Official Site' };
  }
  if (/\b(official blog|official docs|official announcement)\b/i.test(source)) {
    return { tier: 'official', weight: 4, label: 'Official Source' };
  }
  if (/\b(official ecosystem directory|ecosystem directory)\b/i.test(source)) {
    return { tier: 'official', weight: 4, label: 'Official Ecosystem' };
  }
  if (/\b(coindesk|the block|blockworks|defiant|dl news|decrypt|cointelegraph|crypto news|news websites)\b/i.test(source + '\n' + link)) {
    return { tier: 'crypto_media', weight: 3, label: 'Crypto Media' };
  }
  if (/\b(ft|fortune|bloomberg|reuters|wsj|forbes|yahoo finance|finance feeds)\b/i.test(source + '\n' + link)) {
    return { tier: 'financial_media', weight: 2, label: 'Financial Media' };
  }
  if (/\b(twitter|x)\b/i.test(source) && /\b(protocol|network|token|stablecoin|rwa|defi|mainnet|treasury|yield|institutional|custody|crypto)\b/i.test(text)) {
    return { tier: 'crypto_social', weight: 2, label: 'Crypto Social' };
  }
  return { tier: 'general_media', weight: 1, label: 'General Media' };
}

function annotateMentionsWithSourceQuality(mentions, profile) {
  return (mentions || []).map((mention) => {
    const sourceMeta = classifyMentionSource(mention, profile);
    return {
      ...mention,
      sourceTier: sourceMeta.tier,
      sourceWeight: sourceMeta.weight,
      sourceLabel: sourceMeta.label
    };
  });
}

function sumMentionSourceWeights(mentions) {
  return (mentions || []).reduce((total, mention) => total + Number(mention?.sourceWeight || 0), 0);
}

function isRelevantOfficialXTweet(tweet) {
  const text = String(tweet?.text || '');
  return /\b(hong kong|asia|apac|regulated|compliance|institutional|custody|listing|liquidity|rwa|stablecoin|tokenized|partnership|expansion)\b/i.test(text);
}

function detectEntityType(name, context = {}) {
  const rawName = String(name || '').trim();
  const clean = normalizeProjectName(rawName);
  const lower = clean.toLowerCase();
  const title = String(context.title || '');
  const description = String(context.description || '');
  const combined = `${rawName}\n${title}\n${description}`.toLowerCase();
  const profile = context.profile || null;
  const hasProjectBrandedOrgSuffix = /\b(foundation|labs|dao)\b/i.test(clean);
  const hasProjectContext = /\b(protocol|network|chain|mainnet|testnet|token|blockchain|defi|ecosystem|developer|builder|rollup|wallet|oracle|sdk|api|infrastructure)\b/i.test(combined);
  const hasInvestorOrgContext = /\b(venture|ventures|capital|partners?|fund|asset manager|investment firm|vc firm|backed by|led the round|invested in)\b/i.test(combined);

  if (!clean) return 'unknown';
  if (/^(0x[a-f0-9]{4,}|[13][a-km-zA-HJ-NP-Z1-9]{24,}|bc1[a-z0-9]{10,}|T[a-zA-Z0-9]{20,})$/i.test(rawName)) return 'address';
  if (/^0x[0-9a-f]{4,}\.\.\.$/i.test(rawName) || /^0x[0-9a-f]{6,}$/i.test(rawName)) return 'address';

  if (profile) {
    if (/^[A-Z0-9]{2,10}$/.test(clean) && String(profile.symbol || '').toUpperCase() === clean.toUpperCase()) {
      return 'token';
    }
    return 'project';
  }

  if (DEFAULT_REJECT_SYMBOLS.has(lower)) return 'token';
  if (NON_PROJECT_PRIORITY_KEYWORDS.event.some((keyword) => combined.includes(keyword))) return 'event';
  if (NON_PROJECT_PRIORITY_KEYWORDS.exchange.some((keyword) => combined.includes(keyword))) return 'exchange';
  if (hasProjectBrandedOrgSuffix && hasProjectContext && !hasInvestorOrgContext) return 'project';
  if (NON_PROJECT_PRIORITY_KEYWORDS.organization.some((keyword) => combined.includes(keyword))) return 'organization';
  if (NON_PROJECT_PRIORITY_KEYWORDS.person.some((keyword) => combined.includes(keyword))) return 'person';
  if (NON_PROJECT_PRIORITY_KEYWORDS.topic.some((keyword) => combined.includes(keyword))) return 'topic';
  if (NON_PROJECT_PRIORITY_KEYWORDS.location.includes(lower)) return 'location';
  if (/^(hong kong|singapore|uae|dubai|asia)$/i.test(clean)) return 'location';
  if (/^[A-Z0-9]{2,10}$/.test(clean)) return 'token';
  if (/^[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}$/.test(clean)) return 'project';
  return 'unknown';
}

function assessBdFit(entity, config, internalRules) {
  if (!entity || !['project', 'token'].includes(entity.entityType)) {
    return { allow: false, reason: '非 project/token 实体直接排除' };
  }

  const normalizedKey = normalizeKey(entity.name);
  if (MAJOR_ASSET_BLOCKLIST.has(normalizedKey) || DEFAULT_REJECT_SYMBOLS.has(normalizedKey)) {
    return { allow: false, reason: '主流币或默认排除币种' };
  }

  const text = `${entity.title || ''}\n${entity.description || ''}`;
  const signalScore = scoreSignals(text, (config && config.weights) || {});
  const strongFitSignals = signalScore.hits.filter((key) => ['rwa', 'stablecoin', 'institutional', 'custody'].includes(key));
  const complianceSignals = signalScore.hits.filter((key) => ['compliance', 'hongKong', 'asia'].includes(key));
  const cryptoIdentityEvidence = /\b(protocol|network|token|coin|mainnet|defi|dao|chain|layer 1|layer 2|rollup|staking|yield|vault|onchain|blockchain)\b/i.test(text);

  if (entity.profile) {
    if (passesInternalListingRules(entity.profile, internalRules)) {
      return { allow: true, reason: '已命中资料库且通过内部规则' };
    }
    return { allow: false, reason: '资料库项目未通过内部规则' };
  }

  if (!isLikelyCryptoProjectName(entity.name)) {
    return { allow: false, reason: '名称不像具体 crypto 项目或代币' };
  }

  if (!cryptoIdentityEvidence) {
    return { allow: false, reason: '缺少明确 crypto 项目身份线索' };
  }

  if (strongFitSignals.length === 0 || complianceSignals.length === 0) {
    return { allow: false, reason: '证据不足，缺少赛道或合规/地域信号' };
  }

  if (signalScore.total < 7) {
    return { allow: false, reason: '证据不足，信号强度不够' };
  }

  return { allow: true, reason: '未入资料库，但公开信号显示具备 BD 潜力' };
}

function classifyLeadEntity(item, profileList, config, internalRules) {
  const matchedProfile = findProfileMention(item.title, item.description, profileList);
  const extractedName = matchedProfile ? matchedProfile.name : extractProjectName(item.title, item.description);
  const entityType = detectEntityType(extractedName, {
    title: item.title,
    description: item.description,
    profile: matchedProfile
  });
  const entity = {
    name: extractedName,
    entityType,
    profile: matchedProfile || null,
    title: item.title || '',
    description: item.description || ''
  };
  const fit = assessBdFit(entity, config, internalRules);
  return {
    ...entity,
    allow: fit.allow,
    rejectReason: fit.allow ? '' : fit.reason
  };
}

function passesInternalListingRules(profile, internalRules) {
  if (!profile || !profile.screening) return false;
  const thresholds = internalRules.thresholds || {};
  const s = profile.screening;
  const tractionPass =
    Number(s.tvlUsd || 0) >= Number(thresholds.minTvlUsd || 0) ||
    Number(s.marketCapUsd || 0) >= Number(thresholds.minMarketCapUsd || 0);
  const liquidityPass =
    Number(s.dailyVolumeUsd || 0) >= Number(thresholds.minDailyVolumeUsd || 0) &&
    Number(s.dexLiquidityUsd || 0) >= Number(thresholds.minDexLiquidityUsd || 0);
  const compliancePass = Array.isArray(s.complianceSignals) && s.complianceSignals.length > 0;
  const strategicPass = Array.isArray(s.strategicFit) && s.strategicFit.length > 0;
  return Boolean(s.passes && tractionPass && liquidityPass && compliancePass && strategicPass);
}

function extractProjectName(title, description) {
  const tokenMatch = title.match(/\$([A-Z0-9]{2,10})\b/);
  if (tokenMatch) {
    return tokenMatch[1];
  }

  const leadChunk = title.split(/\s[-|:]\s/)[0];
  const candidateSequences = leadChunk.match(/\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}|[A-Z0-9]{3,10})\b/g) || [];
  const filtered = candidateSequences
    .map(normalizeProjectName)
    .filter(Boolean)
    .filter((name) => {
      const words = name.split(/\s+/);
      return words.some((word) => !PROJECT_STOPWORDS.has(word));
    })
    .filter((name) => !/^(How|Why|When|What|Which|Where)\s+/i.test(name))
    .filter((name) => !/^(Hong Kong|Asia|Crypto|Web3|Exchange)$/i.test(name))
    .filter((name) => !/\b(agent|skill|kit|trade kit)\b/i.test(name))
    .filter((name) => !X_LIST_GENERIC_NAME_BLOCKLIST.has(normalizeKey(name)));

  if (filtered.length > 0) {
    return filtered[0];
  }

  const descMatch = (description || '').match(/\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2})\b/);
  return descMatch ? normalizeProjectName(descMatch[1]) : 'Unknown Project';
}

function extractLooseCandidateName(title, description) {
  const cleanTitle = String(title || '').replace(/^[^A-Za-z0-9$]+/, '').trim();
  const tokenMatch = cleanTitle.match(/\$([A-Z0-9]{2,10})\b/);
  if (tokenMatch) return tokenMatch[1];

  const anchoredPatterns = [
    /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\s+(?:Protocol|Network|Labs|DAO|Foundation|Chain))\b/,
    /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\s+Fi)\b/,
    /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2})'s\b/
  ];
  for (const pattern of anchoredPatterns) {
    const match = cleanTitle.match(pattern);
    if (match) {
      const candidate = normalizeProjectName(match[1]);
      if (!/^(How|Why|When|What|Which|Where)\s+/i.test(candidate)) {
        return candidate;
      }
    }
  }

  const leadChunk = cleanTitle.split(/\s[-|:]\s/)[0];
  const genericLead = leadChunk.match(/\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2})\b/);
  if (genericLead) {
    const candidate = normalizeProjectName(genericLead[1]);
    if (isLooseRadarCandidateName(candidate)) return candidate;
  }

  return extractProjectName(title, description);
}

function scoreSignals(text, weights) {
  const hits = [];
  let total = 0;
  for (const rule of SIGNAL_RULES) {
    if (rule.regex.test(text)) {
      hits.push(rule.key);
      total += Number(weights[rule.key] || 0);
    }
  }
  return { total, hits };
}

function scoreEarlySignals(text) {
  const hits = [];
  let total = 0;
  for (const rule of EARLY_SIGNAL_RULES) {
    if (rule.regex.test(text)) {
      hits.push(rule.key);
      total += Number(rule.weight || 0);
    }
  }
  return { total, hits };
}

function inferHongKongTier(text) {
  if (/\b(hong kong|hksar|sfc)\b/i.test(text)) return 'strong';
  if (/\b(asia|apac|regulated markets|licensed exchange|professional investors)\b/i.test(text)) return 'medium';
  if (/\b(institutional|custody|rwa)\b/i.test(text)) return 'weak';
  return 'none';
}

function isLooseRadarCandidateName(name) {
  const clean = normalizeProjectName(name || '');
  const lower = clean.toLowerCase();
  if (!clean) return false;
  if (/^(how|why|when|what|which|where)\s+/i.test(clean)) return false;
  if (/^(here|former nyc)$/i.test(clean)) return false;
  if (/^[A-Z]{2,4}$/.test(clean)) return false;
  if (/^\d+[mkb]?$/i.test(clean)) return false;
  if (/^(ai|fintech|trump|market|token|crypto|web3|chain|protocol|foundation|capital|stable|startup|blockchain|tokenized|british|german fintech|ex|paypal)$/i.test(lower)) return false;
  if (/\b(ceo|founder|president)\b/i.test(clean)) return false;
  if (/\b(startup|stable|tokenized|blockchain|crypto|fintech)\b/i.test(clean) && !/\b(protocol|network|chain|dao|labs)\b/i.test(clean)) return false;
  if (/(^| )(american|british|german|uae|hong kong|dubai)( |$)/i.test(clean)) return false;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(clean) && !/\b(protocol|network|chain|dao|labs)\b/i.test(clean)) return false;
  return isLikelyCryptoProjectName(clean);
}

function classifySector(text) {
  if (/\b(rwa|real world asset|tokenized treasury|tokenized fund)\b/i.test(text)) return 'RWA';
  if (/\b(stablecoin|payments|settlement)\b/i.test(text)) return 'Stablecoin';
  if (/\b(custody|institutional|prime brokerage)\b/i.test(text)) return 'Institutional';
  if (/\b(wallet|payments app)\b/i.test(text)) return 'Wallet';
  if (/\b(defi|dex|yield|staking|lending)\b/i.test(text)) return 'DeFi';
  if (/\b(infra|layer 1|layer 2|rollup|chain)\b/i.test(text)) return 'Infra';
  return 'General';
}

function isFundraisingBucketCandidate(project, text) {
  const name = safeText(project?.name || '');
  const normalizedKey = normalizeKey(name);
  const combined = `${name}\n${text || ''}`;
  const lower = combined.toLowerCase();
  if (!name) return false;
  if (FUNDRAISING_ENTITY_NAME_BLOCKLIST.has(normalizedKey)) return false;

  const looksLikeInvestorName =
    /\b(ventures?|capital|partners?|fund|funds|payments?|brokers?|bank|banks|investments?)\b/i.test(name) &&
    !/\b(protocol|network|chain|dao|labs|fi)\b/i.test(name);
  if (looksLikeInvestorName) return false;

  const investorRoleContext = new RegExp(`\\b${escapeRegex(name).replace(/\\ /g, '\\s+')}\\b[\\s\\S]{0,80}\\b(led|lead investor|joined the round|participated in|backed|invested in|co-led|co lead|supported the round)\\b`, 'i');
  if (investorRoleContext.test(combined)) return false;

  const organizationContext = /\b(venture firm|investment firm|vc firm|payments company|global payments|asset manager|incubator)\b/i.test(lower);
  const cryptoProjectContext = /\b(protocol|network|chain|mainnet|testnet|token|blockchain|defi|ecosystem|developer|builder|rollup|wallet)\b/i.test(lower);
  if (organizationContext && !cryptoProjectContext) return false;

  return true;
}

function isDexBucketCandidate(project, text) {
  const name = safeText(project?.name || '');
  const normalizedKey = normalizeKey(name);
  const combined = `${name}\n${text || ''}`;
  if (!name) return false;
  if (DEX_ENTITY_NAME_BLOCKLIST.has(normalizedKey)) return false;
  if (MAJOR_ASSET_BLOCKLIST.has(normalizedKey)) return false;

  const hasDexIdentity = /\b(dex|swap|amm|perp|perpetual|liquidity|pool|router|orderbook|trading)\b/i.test(combined);
  const hasCryptoProjectIdentity = /\b(protocol|network|chain|token|mainnet|defi|onchain|wallet)\b/i.test(combined);
  const looksGeneric = /^(dex|defi|swap|liquidity|trading|market|markets)$/i.test(name);
  const looksLikeChainBrand = /\b(chain|ecosystem)\b/i.test(name) && !/\b(protocol|network|labs)\b/i.test(name);

  if (looksGeneric || looksLikeChainBrand) return false;
  return hasDexIdentity && hasCryptoProjectIdentity;
}

function isEcosystemBucketCandidate(project, text) {
  const name = safeText(project?.name || '');
  const normalizedKey = normalizeKey(name);
  const combined = `${name}\n${text || ''}`;
  if (!name) return false;
  if (ECOSYSTEM_ENTITY_NAME_BLOCKLIST.has(normalizedKey)) return false;
  if (MAJOR_ASSET_BLOCKLIST.has(normalizedKey)) return false;

  const hasEcosystemIdentity = /\b(ecosystem|integration|integrates|builder|grant|developer|docs|mainnet|testnet|rollup|infrastructure|sdk|api)\b/i.test(combined);
  const hasCryptoProjectIdentity = /\b(protocol|network|chain|token|blockchain|defi|onchain|wallet|oracle)\b/i.test(combined);
  const looksGeneric = /^(ecosystem|builder|developers?|infrastructure|network infrastructure|best)$/i.test(name);
  const looksLikeMajorChainAlias = /\b(bnb chain|the open network|bitcoin network)\b/i.test(normalizedKey);

  if (looksGeneric || looksLikeMajorChainAlias) return false;
  return hasEcosystemIdentity && hasCryptoProjectIdentity;
}

function buildReasonSummary(project) {
  const reasons = [];
  if (project.signals.includes('funding')) reasons.push('近期有融资/资本市场信号');
  if (project.signals.includes('compliance')) reasons.push('公开信息里出现合规或牌照相关表述');
  if (project.signals.includes('hongKong')) reasons.push('与香港市场或 SFC 语境相关');
  if (project.signals.includes('asia')) reasons.push('有亚洲扩张信号');
  if (project.signals.includes('institutional')) reasons.push('偏机构客户或托管/清算场景');
  if (project.signals.includes('listing')) reasons.push('存在二级流动性或上所相关语义');
  if (project.signals.includes('hiring')) reasons.push('出现招聘或组织扩张线索');
  if (reasons.length === 0) reasons.push('新闻中出现潜在市场拓展线索');
  return reasons.slice(0, 3).join('；');
}

function cleanXWatchTweetText(text) {
  return safeText(String(text || '')
    .replace(/^RT\s+@[A-Za-z0-9_]{1,15}:\s*/i, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b@\w{1,15}\b/g, ' ')
  );
}

function inferXWatchQueryGroup(text) {
  const value = String(text || '');
  if (/\b(seed|series a|series b|funding|fundraise|raised|raises|backed|strategic round|investment|investor)\b/i.test(value)) return 'fundraising';
  if (/\b(dex|swap|amm|perp|perpetual|liquidity|pool|router|orderbook|pair)\b/i.test(value)) return 'dex';
  if (/\b(mainnet|testnet|launch|launched|rollout|integration|integrates|ecosystem|builder program|grant|developer docs|sdk|api)\b/i.test(value)) return 'ecosystem';
  return 'strict';
}

function inferFeedQueryGroup(item, fallbackGroup = 'strict') {
  const text = `${item?.title || ''}\n${item?.description || ''}`;
  if (/\b(seed|series a|series b|funding|fundraise|raised|raises|backed|strategic round|investment|investor)\b/i.test(text)) return 'fundraising';
  if (/\b(dex|swap|amm|perp|perpetual|liquidity|pool|router|orderbook|pair)\b/i.test(text)) return 'dex';
  if (/\b(mainnet|testnet|launch|launched|rollout|integration|integrates|ecosystem|builder program|grant|developer docs|sdk|api)\b/i.test(text)) return 'ecosystem';
  return fallbackGroup;
}

function isUsefulXListItem(item) {
  const title = safeText(item?.title || '');
  const description = safeText(item?.description || '');
  const creator = safeText(item?.creator || item?.source || '');
  const text = `${title}\n${description}`;

  const signalHit = /\b(funding|fundraise|raised|raises|backed|investment|investor|coinbase|roadmap|listing|listed|mainnet|testnet|launch|launched|integration|integrates|partnership|ecosystem|grant|builder|developer docs|sdk|api|tokenized|stablecoin|rwa|institutional|custody|sec|nasdaq)\b/i.test(text);
  if (!signalHit) return false;

  const macroNoise = /\b(ecb|bank of japan|boj|federal reserve|fed|interest rate|policy rate|gold|silver|bitcoin falls|good morning|u\.s\. session)\b/i.test(text);
  if (macroNoise) return false;

  const lowValueCreators = /\b(apompliano|consensus2026|consensus_hk|coinbase support|kraken support)\b/i.test(creator);
  if (lowValueCreators && !/\b(funding|raised|backed|listing|listed|coinbase|mainnet|testnet|integration|launch)\b/i.test(text)) {
    return false;
  }

  return true;
}

function buildXWatchItems(rootDir) {
  const cache = loadApiCache(rootDir);
  const handles = loadXWatchlist(rootDir);
  const items = [];

  for (const handle of handles) {
    const username = extractTwitterUsername(handle);
    if (!username) continue;
    const entry = cache.opentwitter[`watch:${username.toLowerCase()}`];
    const tweets = Array.isArray(entry?.tweets) ? entry.tweets : [];
    for (const tweet of tweets) {
      const cleanedText = cleanXWatchTweetText(tweet.text || '');
      if (!cleanedText) continue;
      if (cleanedText.length < 24) continue;
      if (!/\b(crypto|web3|blockchain|token|listing|roadmap|coinbase|kraken|bitstamp|funding|raised|backed|mainnet|testnet|integration|ecosystem|dex|defi|chain|protocol|network)\b/i.test(cleanedText)) {
        continue;
      }
      items.push({
        title: cleanedText.slice(0, 220),
        link: tweet.id ? `https://x.com/${username}/status/${tweet.id}` : `https://x.com/${username}`,
        pubDate: tweet.createdAt || entry?.fetchedAt || nowIso(),
        description: `X watchlist post from @${username}. ${cleanedText}`,
        source: `X Watchlist @${username}`,
        queryName: `X Watchlist @${username}`,
        queryGroup: inferXWatchQueryGroup(cleanedText)
      });
    }
  }

  return items
    .sort((a, b) => Date.parse(b.pubDate || 0) - Date.parse(a.pubDate || 0))
    .filter((item, index, list) => list.findIndex((other) => other.link === item.link) === index);
}

function deriveProfileSector(profile) {
  const text = [
    profile.fitSummary || '',
    ...(profile.screening?.strategicFit || []),
    ...(profile.screening?.complianceSignals || [])
  ].join(' ');
  return classifySector(text);
}

function buildProfileBackedProjects(items, config, rootDir) {
  const rules = readJson(resolveDataPath(rootDir, 'project-rules.json'), {
    whitelist: [],
    blacklist: [],
    competitors: []
  });
  const whitelist = new Set((rules.whitelist || []).map(normalizeKey));
  const blacklist = new Set((rules.blacklist || []).map(normalizeKey));
  const listedAssets = loadOslListedAssets(rootDir);
  const internalRules = loadInternalRules(rootDir);
  const cache = loadApiCache(rootDir);
  const profiles = loadProfileList(rootDir);

  return profiles
    .filter((profile) => {
      const nameKey = normalizeKey(profile.name);
      if (!nameKey) return false;
      if (blacklist.has(nameKey)) return false;
      if (MAJOR_ASSET_BLOCKLIST.has(nameKey)) return false;
      if (isAlreadyListedOnOslGlobal(profile.name, profile.symbol || '', listedAssets)) return false;
      if (isCompetitorOrVenue(profile.name, `${profile.fitSummary || ''} ${(profile.screening?.strategicFit || []).join(' ')}`, rules)) return false;
      return passesInternalListingRules(profile, internalRules);
    })
    .map((profile) => {
      const matchedMentions = items
        .filter((item) => {
          const found = findProfileMention(item.title, item.description, [profile]);
          return found && normalizeKey(found.name) === normalizeKey(profile.name);
        })
        .slice(0, 4)
        .map((item) => ({
          title: item.title,
          link: item.link,
          source: item.source || 'News',
          publishedAt: item.pubDate || nowIso()
        }))
        .filter((mention) => isRelevantMentionForProject(mention, { name: profile.name, symbol: profile.symbol }, profile));

      const opennewsMentions = ((cache.opennews[profile.slug || profile.name] || {}).articles || []).map((article) => ({
        title: safeText(article.text || `${profile.name} news`).slice(0, 220),
        link: article.link || '',
        source: article.newsType || 'OpenNews',
        publishedAt: article.ts ? new Date(article.ts).toISOString() : nowIso()
      }))
        .filter((mention) => isRelevantMentionForProject(mention, { name: profile.name, symbol: profile.symbol }, profile));

      const allMentions = [...matchedMentions, ...opennewsMentions]
        .filter((mention, index, list) => list.findIndex((item) => item.title === mention.title && item.link === mention.link) === index)
        .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
        .slice(0, 4);
      const weightedMentions = annotateMentionsWithSourceQuality(allMentions, profile);
      const sourceStrength = sumMentionSourceWeights(weightedMentions);

      const twitterCache = cache.opentwitter[profile.slug || profile.name] || {};
      const twitterText = (twitterCache.tweets || []).map((tweet) => tweet.text).join('\n');
      const relevantOfficialTweetCount = (twitterCache.tweets || []).filter(isRelevantOfficialXTweet).length;
      const directNewsMentionCount = matchedMentions.length;
      const opennewsMentionCount = opennewsMentions.length;

      const mentionText = allMentions.map((item) => `${item.title}\n${item.source}`).join('\n');
      const signalScore = scoreSignals(
        `${profile.fitSummary || ''}\n${(profile.screening?.complianceSignals || []).join(' ')}\n${(profile.screening?.strategicFit || []).join(' ')}\n${mentionText}\n${twitterText}`,
        config.weights
      );
      const score =
        5 +
        Math.min(directNewsMentionCount, 2) * 3 +
        Math.min(opennewsMentionCount, 1) +
        Math.min(sourceStrength, 8) +
        Math.min(signalScore.total, 6) +
        (Array.isArray(profile.screening?.complianceSignals) && profile.screening.complianceSignals.length ? 2 : 0) +
        (Array.isArray(profile.screening?.strategicFit) && profile.screening.strategicFit.length ? 1 : 0) +
        Math.min(relevantOfficialTweetCount, 2) +
        (whitelist.has(normalizeKey(profile.name)) ? 1 : 0);
      const priorityBand =
        score >= 17 && directNewsMentionCount >= 2 ? 'High' :
          score >= 12 && (directNewsMentionCount >= 1 || relevantOfficialTweetCount >= 2) ? 'Medium' :
            'Watch';

      return {
        name: profile.name,
        score,
        signals: Array.from(new Set(signalScore.hits.concat(['compliance', 'institutional']))),
        sector: deriveProfileSector(profile),
        reasons: [
          profile.fitSummary || '命中 OSL 内部规则，且具备机构或合规相关信号',
          directNewsMentionCount >= 1 ? '近期有较直接的外部新闻催化' :
            relevantOfficialTweetCount >= 1 ? '近期主要是官方 X 动态活跃' :
              '当前更多依赖基本面与合规画像，不依赖单条新闻热度'
        ],
        mentions: weightedMentions,
        priorityBand,
        priorityMeta: {
          directNewsMentionCount,
          opennewsMentionCount,
          relevantOfficialTweetCount,
          sourceStrength
        },
        internalFit: 'profiled',
        firstSeenAt: allMentions.length ? allMentions[allMentions.length - 1].publishedAt : nowIso(),
        latestSeenAt: allMentions.length ? allMentions[0].publishedAt : nowIso(),
        reasonSummary: buildReasonSummary({ signals: signalScore.hits.concat(['compliance', 'institutional']) }),
        sourceMode: allMentions.length ? 'profile+news' : 'profile'
      };
    });
}

function mergeProjectSets(primaryProjects, secondaryProjects) {
  const merged = new Map();
  [...secondaryProjects, ...primaryProjects].forEach((project) => {
    const key = normalizeKey(project.name);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...project,
        signals: Array.from(new Set(project.signals || [])),
        reasons: Array.from(new Set(project.reasons || [])),
        mentions: project.mentions || []
      });
      return;
    }

    merged.set(key, {
      ...existing,
      ...project,
      score: Math.max(Number(existing.score || 0), Number(project.score || 0)),
      signals: Array.from(new Set([...(existing.signals || []), ...(project.signals || [])])),
      reasons: Array.from(new Set([...(existing.reasons || []), ...(project.reasons || [])])),
      mentions: [...(project.mentions || []), ...(existing.mentions || [])]
        .filter((mention, index, list) => list.findIndex((item) => item.title === mention.title && item.link === mention.link) === index)
        .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0))
        .slice(0, 6),
      reasonSummary: project.reasonSummary || existing.reasonSummary,
      priorityBand: Number(project.score || 0) >= Number(existing.score || 0) ? project.priorityBand : existing.priorityBand,
      priorityMeta: project.priorityMeta || existing.priorityMeta || null
    });
  });

  return Array.from(merged.values())
    .map((project) => ({
      ...project,
      score: Number(project.score || 0),
      reasonSummary: project.reasonSummary || Array.from(new Set(project.reasons || [])).slice(0, 3).join('；')
    }))
    .sort((a, b) => b.score - a.score || Date.parse(b.latestSeenAt || 0) - Date.parse(a.latestSeenAt || 0));
}

function rebalancePriorityBands(projects) {
  const list = [...projects];
  const eligible = list
    .filter((project) => Number(project.score || 0) >= 12)
    .sort((a, b) => {
      const aUrgency =
        Number(a.priorityMeta?.directNewsMentionCount || 0) * 4 +
        Number(a.priorityMeta?.relevantOfficialTweetCount || 0) * 2 +
        Number(a.priorityMeta?.sourceStrength || 0) * 0.6 +
        Math.min((a.mentions || []).length, 2) +
        Number(a.score || 0) / 10;
      const bUrgency =
        Number(b.priorityMeta?.directNewsMentionCount || 0) * 4 +
        Number(b.priorityMeta?.relevantOfficialTweetCount || 0) * 2 +
        Number(b.priorityMeta?.sourceStrength || 0) * 0.6 +
        Math.min((b.mentions || []).length, 2) +
        Number(b.score || 0) / 10;
      return bUrgency - aUrgency || Number(b.score || 0) - Number(a.score || 0);
    });

  const highKeys = new Set(eligible.slice(0, 2).map((project) => normalizeKey(project.name)));
  const mediumKeys = new Set(eligible.slice(2, 3).map((project) => normalizeKey(project.name)));

  return list.map((project) => {
    const key = normalizeKey(project.name);
    const score = Number(project.score || 0);
    let priorityBand = 'Watch';
    if (highKeys.has(key) && score >= 12) priorityBand = 'High';
    else if (mediumKeys.has(key) && score >= 12) priorityBand = 'Medium';
    else if (score >= 8) priorityBand = 'Watch';

    return {
      ...project,
      priorityBand
    };
  });
}

function annotateNovelty(projects, history) {
  const recentRuns = (history.runs || []).slice(0, 14);
  const seenMap = new Map();

  recentRuns.forEach((run, runIndex) => {
    (run.projects || []).forEach((project) => {
      const key = normalizeKey(project.name);
      const existing = seenMap.get(key) || { count: 0, bestScore: 0, lastSeenRunIndex: runIndex };
      existing.count += 1;
      existing.bestScore = Math.max(existing.bestScore, Number(project.score || 0));
      existing.lastSeenRunIndex = Math.min(existing.lastSeenRunIndex, runIndex);
      seenMap.set(key, existing);
    });
  });

  return projects
    .map((project) => {
      const seen = seenMap.get(normalizeKey(project.name));
      const seenCount = seen ? seen.count : 0;
      const previousBestScore = seen ? seen.bestScore : 0;
      const scoreDelta = project.score - previousBestScore;
      const freshness = seenCount === 0 ? 'new' : scoreDelta >= 3 ? 'rising' : 'repeat';
      return {
        ...project,
        seenCount,
        previousBestScore,
        scoreDelta,
        freshness
      };
    })
    .sort((a, b) => {
      const freshnessRank = { new: 3, rising: 2, repeat: 1 };
      return (
        freshnessRank[b.freshness] - freshnessRank[a.freshness] ||
        b.scoreDelta - a.scoreDelta ||
        b.score - a.score
      );
    });
}

function aggregateProjects(items, config, rootDir) {
  const maxAgeDays = Number(config.filters.maxAgeDays || 21);
  const minScore = Number(config.filters.minScore || 3);
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const projects = new Map();
  const rules = readJson(resolveDataPath(rootDir, 'project-rules.json'), {
    whitelist: [],
    blacklist: [],
    blockedNamePatterns: [],
    blockedSourcePatterns: []
  });
  const whitelist = new Set((rules.whitelist || []).map(normalizeKey));
  const blacklist = new Set((rules.blacklist || []).map(normalizeKey));
  const profiles = loadProfiles(rootDir);
  const profileList = loadProfileList(rootDir);
  const listedAssets = loadOslListedAssets(rootDir);
  const internalRules = loadInternalRules(rootDir);

  for (const item of items) {
    if ((item.source || '') === 'System' || /^\[Source Error\]/.test(item.title || '')) {
      continue;
    }

    const publishedAt = Date.parse(item.pubDate || '') || Date.now();
    if (publishedAt < cutoff) continue;

    const text = `${item.title}\n${item.description}`;
    const classified = classifyLeadEntity(item, profileList, config, internalRules);
    const matchedProfile = classified.profile;
    const projectName = classified.name;
    if (!projectName || projectName === 'Unknown Project') continue;
    if (!classified.allow) continue;
    const normalizedKey = normalizeKey(projectName);
    const profile = matchedProfile || profiles.get(normalizedKey);
    const projectSymbol = profile ? profile.symbol : '';
    if (MAJOR_ASSET_BLOCKLIST.has(normalizedKey)) continue;
    if (isAlreadyListedOnOslGlobal(projectName, projectSymbol, listedAssets)) continue;
    if (isCompetitorOrVenue(projectName, text, rules)) continue;
    if (blacklist.has(normalizedKey)) continue;
    if (isBlockedByPattern(projectName, rules.blockedNamePatterns)) continue;
    if (isBlockedByPattern(item.title || '', rules.blockedNamePatterns)) continue;
    if (isBlockedByPattern(item.link || '', rules.blockedSourcePatterns)) continue;
    if (isBlockedByPattern(item.source || '', rules.blockedSourcePatterns)) continue;

    const signalScore = scoreSignals(text, config.weights);
    if (signalScore.total < minScore) continue;
    if (profile && !passesInternalListingRules(profile, internalRules)) continue;

    const listingHits = countMatches(text, /\b(listing|listed|exchange listing)\b/i);
    const fundingHits = countMatches(text, /\b(funding|raised|raises|backed|series a|series b)\b/i);
    const hasStrongIntent = signalScore.hits.some((key) => ['compliance', 'hongKong', 'institutional', 'rwa', 'stablecoin'].includes(key));
    const noisePenalty = listingHits > 0 && !hasStrongIntent ? 2 : 0;
    const intentBonus = hasStrongIntent ? 2 : 0;
    const whitelistBonus = whitelist.has(normalizedKey) ? 3 : 0;
    const existing = projects.get(normalizedKey) || {
      name: projectName,
      score: 0,
      signals: [],
      sector: classifySector(text),
      reasons: [],
      mentions: [],
      priorityBand: 'Watch',
      internalFit: profile ? 'profiled' : 'heuristic',
      firstSeenAt: item.pubDate || nowIso(),
      latestSeenAt: item.pubDate || nowIso()
    };

    existing.name = projectName.length > existing.name.length ? projectName : existing.name;
    existing.score += signalScore.total + intentBonus + whitelistBonus + Math.min(fundingHits, 1) - noisePenalty;
    existing.signals = Array.from(new Set(existing.signals.concat(signalScore.hits)));
    existing.reasons.push(buildReasonSummary({ signals: signalScore.hits }));
    existing.mentions.push({
      title: item.title,
      link: item.link,
      source: item.source || 'News',
      publishedAt: item.pubDate || nowIso()
    });

    if (publishedAt < Date.parse(existing.firstSeenAt || item.pubDate)) {
      existing.firstSeenAt = item.pubDate;
    }
    if (publishedAt > Date.parse(existing.latestSeenAt || item.pubDate)) {
      existing.latestSeenAt = item.pubDate;
    }
    projects.set(normalizedKey, existing);
  }

  return Array.from(projects.values())
    .map((project) => {
      const weightedMentions = annotateMentionsWithSourceQuality(project.mentions || [], project.profile || null);
      const sourceStrength = sumMentionSourceWeights(weightedMentions);
      const score = project.score + Math.min(weightedMentions.length - 1, 4) + Math.min(sourceStrength, 6);
      return {
        ...project,
        score,
        mentions: weightedMentions,
        priorityMeta: {
          ...(project.priorityMeta || {}),
          sourceStrength
        },
        reasonSummary: Array.from(new Set(project.reasons)).slice(0, 3).join('；'),
        priorityBand: score >= 12 ? 'High' : score >= 8 ? 'Medium' : 'Watch'
      };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.latestSeenAt) - Date.parse(a.latestSeenAt));
}

function enrichProjects(projects, rootDir) {
  const profiles = loadProfiles(rootDir);
  return projects.map((project) => {
    const profile = profiles.get(normalizeKey(project.name));
    const slug = profile && profile.slug ? profile.slug : slugify(project.name);
    const contact = inferContact(project, profile);
    return {
      ...project,
      slug,
      website: profile ? profile.website || '' : '',
      twitter: profile ? profile.twitter || '' : '',
      contact,
      secondaryContact: profile ? profile.secondaryContact || null : null,
      region: profile ? profile.region || '' : '',
      stage: profile ? profile.stage || '' : '',
      fitSummary: profile ? profile.fitSummary || project.reasonSummary : project.reasonSummary,
      interpretation: buildInterpretation(project, profile),
      nextStep: profile ? profile.nextStep || '优先找 warm intro 再发首封触达。' : '优先找 warm intro 再发首封触达。',
      sourceNotes: profile ? profile.sourceNotes || [] : [],
      screening: profile ? profile.screening || null : null
    };
  });
}

function buildLooseRadarProjects(items, config, rootDir, strictProjects) {
  const rules = readJson(resolveDataPath(rootDir, 'project-rules.json'), {
    whitelist: [],
    blacklist: [],
    blockedNamePatterns: [],
    blockedSourcePatterns: []
  });
  const blacklist = new Set((rules.blacklist || []).map(normalizeKey));
  const profiles = loadProfiles(rootDir);
  const profileList = loadProfileList(rootDir);
  const listedAssets = loadOslListedAssets(rootDir);
  const internalRules = loadInternalRules(rootDir);
  const strictKeys = new Set((strictProjects || []).map((project) => normalizeKey(project.name)));
  const radar = new Map();

  for (const item of items) {
    if ((item.source || '') === 'System' || /^\[Source Error\]/.test(item.title || '')) continue;

    const matchedProfile = findProfileMention(item.title, item.description, profileList);
    const looseName = matchedProfile ? matchedProfile.name : extractLooseCandidateName(item.title, item.description);
    const entityType = detectEntityType(looseName, { title: item.title, description: item.description, profile: matchedProfile });
    const name = looseName;
    if (!name || name === 'Unknown Project') continue;

    const normalizedKey = normalizeKey(name);
    const profile = matchedProfile || profiles.get(normalizedKey) || null;
    if (!['project', 'token'].includes(entityType)) continue;
    if (strictKeys.has(normalizedKey)) continue;
    if (blacklist.has(normalizedKey)) continue;
    if (MAJOR_ASSET_BLOCKLIST.has(normalizedKey) || DEFAULT_REJECT_SYMBOLS.has(normalizedKey)) continue;
    if (isAlreadyListedOnOslGlobal(name, profile ? profile.symbol : '', listedAssets)) continue;
    if (isBlockedByPattern(name, rules.blockedNamePatterns)) continue;
    if (isBlockedByPattern(item.title || '', rules.blockedNamePatterns)) continue;
    if (isCompetitorOrVenue(name, `${item.title}\n${item.description}`, rules)) continue;
    if (!isLooseRadarCandidateName(name)) continue;

    const text = `${item.title}\n${item.description}\n${item.source || ''}`;
    const earlyScore = scoreEarlySignals(text);
    const officialDirectoryBoost = /\b(official ecosystem directory|ecosystem directory)\b/i.test(item.source || '') ? 2 : 0;
    const hkTier = inferHongKongTier(text);
    const hasEarlyPathSignal = earlyScore.hits.some((key) => ['funding', 'launch', 'ecosystem', 'infra', 'ai', 'github'].includes(key));
    const hasCryptoIdentityEvidence = /\b(protocol|network|token|mainnet|testnet|defi|chain|wallet|rollup|oracle|sdk|onchain|blockchain|ecosystem)\b/i.test(text);
    const looseMention = {
      title: item.title,
      link: item.link,
      source: item.source || 'News',
      publishedAt: item.pubDate || nowIso()
    };
    if (/^(here|former nyc|oft)$/i.test(name)) continue;
    if (!hasEarlyPathSignal) continue;
    if (!hasCryptoIdentityEvidence) continue;
    if (earlyScore.total + officialDirectoryBoost < 4) continue;
    if (!isRelevantMentionForProject(looseMention, { name, symbol: profile ? profile.symbol : '' }, profile)) continue;

    const existing = radar.get(normalizedKey) || {
      name,
      score: 0,
      signals: [],
      sector: classifySector(text),
      reasons: [],
      mentions: [],
      priorityBand: 'Watch',
      internalFit: profile ? 'profiled' : 'early-radar',
      firstSeenAt: item.pubDate || nowIso(),
      latestSeenAt: item.pubDate || nowIso(),
      discoveryPath: 'loose',
      maturityPath: profile ? 'mature' : 'early',
      hongKongTier: hkTier
    };

    existing.score += earlyScore.total + officialDirectoryBoost + classifyMentionSource(looseMention, profile).weight;
    existing.signals = Array.from(new Set(existing.signals.concat(earlyScore.hits)));
    existing.reasons.push(
      hkTier !== 'none'
        ? `出现 ${hkTier === 'strong' ? '强' : hkTier === 'medium' ? '中' : '弱'} 香港/合规市场信号`
        : '出现早期项目催化信号'
    );
    existing.mentions.push(looseMention);

    const publishedAt = Date.parse(item.pubDate || '') || Date.now();
    if (publishedAt < Date.parse(existing.firstSeenAt || item.pubDate)) existing.firstSeenAt = item.pubDate;
    if (publishedAt > Date.parse(existing.latestSeenAt || item.pubDate)) existing.latestSeenAt = item.pubDate;
    radar.set(normalizedKey, existing);
  }

  return Array.from(radar.values())
    .map((project) => {
      const profile = profiles.get(normalizeKey(project.name)) || null;
      const weightedMentions = annotateMentionsWithSourceQuality(project.mentions || [], profile);
      const sourceStrength = sumMentionSourceWeights(weightedMentions);
      const score = Number(project.score || 0) + Math.min(weightedMentions.length - 1, 2) + Math.min(sourceStrength, 4);
      return {
        ...project,
        score,
        mentions: weightedMentions,
        priorityMeta: {
          ...(project.priorityMeta || {}),
          sourceStrength
        },
        reasonSummary: Array.from(new Set(project.reasons || [])).slice(0, 3).join('；'),
        priorityBand: score >= 12 ? 'Medium' : 'Watch'
      };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.latestSeenAt || 0) - Date.parse(a.latestSeenAt || 0))
    .slice(0, 12);
}

function buildBucketRadarProjects(items, config, rootDir, strictProjects, options = {}) {
  const bucketName = options.bucketName || 'watch';
  const scoreBoost = Number(options.scoreBoost || 0);
  const priorityCap = options.priorityCap || 'Watch';
  const label = options.label || bucketName;
  const bucketRules = {
    fundraising: { regex: /\b(seed|series a|series b|funding|raised|backed|strategic round|investors?)\b/i, bonus: 4 },
    dex: { regex: /\b(dex|liquidity|pool|volume|pair|market cap|fdv|dexscreener|dextools)\b/i, bonus: 3 },
    ecosystem: { regex: /\b(ecosystem|integrates|launch|builder program|grant|testnet|mainnet|solana|base|monad)\b/i, bonus: 2 }
  };
  const rule = bucketRules[bucketName] || { regex: /./, bonus: 0 };
  const projects = buildLooseRadarProjects(items, config, rootDir, strictProjects)
    .filter((project) => {
      const mentionText = (project.mentions || []).map((mention) => `${mention.title || ''}\n${mention.source || ''}`).join('\n');
      const combined = `${mentionText}\n${project.reasonSummary || ''}`;
      if (bucketName === 'fundraising') return isFundraisingBucketCandidate(project, combined);
      if (bucketName === 'dex') return isDexBucketCandidate(project, combined);
      if (bucketName === 'ecosystem') return isEcosystemBucketCandidate(project, combined);
      return true;
    })
    .map((project) => {
      const mentionText = (project.mentions || []).map((mention) => mention.title || '').join('\n');
    const bucketBonus = rule.regex.test(mentionText + '\n' + (project.reasonSummary || '')) ? rule.bonus : 0;
    const score = Number(project.score || 0) + scoreBoost + bucketBonus;
    const nextPriority = priorityCap === 'Medium' && score >= 12 ? 'Medium' : 'Watch';
    return {
      ...project,
      score,
      priorityBand: nextPriority,
      discoveryPath: bucketName,
      radarBucket: bucketName,
      reasonSummary: '[' + label + '] ' + project.reasonSummary
    };
  });
  return projects;
}

function rerankRadarProjectsWithExternalSignals(projects, options = {}) {
  const bucketName = options.bucketName || '';
  return (projects || [])
    .map((project) => {
      const websiteSignals = project.liveSignals?.website?.discoverySignals || [];
      const websiteScanText = (project.liveSignals?.website?.scanPages || [])
        .map((page) => `${page.kind || ''} ${page.title || ''} ${page.url || ''}`)
        .join('\n');
      const rootdataText = [
        project.liveSignals?.rootdata?.projectType || '',
        project.liveSignals?.rootdata?.description || ''
      ].join('\n');
      const cryptorankText = [
        project.liveSignals?.cryptorank?.name || '',
        project.liveSignals?.cryptorank?.category || '',
        project.liveSignals?.cryptorank?.type || ''
      ].join('\n');
      const websiteDiscovery = analyzeWebsiteDiscoverySignals([
        project.liveSignals?.website?.title || '',
        project.liveSignals?.website?.description || '',
        websiteScanText
      ].join('\n'));

      let externalBoost = 0;
      const externalReasons = [];

      if (websiteSignals.length) {
        externalBoost += Math.min(websiteDiscovery.total, 3);
        externalReasons.push(`官网/Docs/生态页出现 ${websiteSignals.join(', ')} 信号`);
      }
      if (project.liveSignals?.cryptorank?.rank) {
        externalBoost += 1;
        externalReasons.push(`CryptoRank 已收录（rank ${project.liveSignals.cryptorank.rank}）`);
      }
      if (bucketName === 'fundraising' && /\b(raise|raised|funding|backed|investors?|series|strategic)\b/i.test(rootdataText)) {
        externalBoost += 3;
        externalReasons.push('RootData 描述中出现融资/投资方线索');
      }
      if (bucketName === 'fundraising' && project.fundraising?.latestRound) {
        const latestRound = project.fundraising.latestRound;
        externalBoost += 4;
        if (latestRound.investorsCount >= 1) externalBoost += 2;
        if (latestRound.raiseUsd >= 10000000) externalBoost += 2;
        externalReasons.push(`CryptoRank 融资轮次已确认：${latestRound.roundStage || 'Funding Round'}`);
      }
      if (bucketName === 'dex' && /\b(dex|swap|amm|liquidity|pool|pair|trading|defi)\b/i.test(rootdataText + '\n' + websiteScanText + '\n' + cryptorankText)) {
        externalBoost += 3;
        externalReasons.push('RootData 或官网页出现 DEX/流动性语义');
      }
      if (bucketName === 'ecosystem' && /\b(ecosystem|integrat|partner|grant|builder|developer|docs|mainnet|testnet|infrastructure|chain|blockchain)\b/i.test(rootdataText + '\n' + websiteScanText + '\n' + cryptorankText)) {
        externalBoost += 3;
        externalReasons.push('官网/生态页出现生态集成或开发者信号');
      }

      const score = Number(project.score || 0) + externalBoost;
      return {
        ...project,
        score,
        reasons: Array.from(new Set([...(project.reasons || []), ...externalReasons])),
        reasonSummary: Array.from(new Set([project.reasonSummary, ...externalReasons].filter(Boolean))).slice(0, 3).join('；'),
        priorityMeta: {
          ...(project.priorityMeta || {}),
          externalBoost
        },
        priorityBand: score >= 14 ? 'Medium' : 'Watch'
      };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.latestSeenAt || 0) - Date.parse(a.latestSeenAt || 0));
}

function normalizeWorkflowValue(value) {
  return normalizeKey(String(value || '').replace(/[/-]+/g, ' '));
}

function summarizePromotionReasons(reasons) {
  return Array.from(new Set((reasons || []).filter(Boolean))).slice(0, 3);
}

function buildWorkflowMeta(project, crm) {
  const status = crm?.status || '';
  const outcome = crm?.review_outcome || '';
  const nextAction = crm?.next_action || project?.nextStep || '';
  const owner = crm?.owner || '';
  const notes = crm?.notes || crm?.review_notes || '';
  const dropReason = crm?.drop_reason || crm?.not_fit_reason || '';
  const targetPerson = crm?.target_person || crm?.decision_maker || '';
  const normalizedStatus = normalizeWorkflowValue(status);
  const normalizedOutcome = normalizeWorkflowValue(outcome);
  const statusText = `${status} ${outcome} ${dropReason}`.trim();
  const isFalsePositive = /(false positive|误报)/i.test(statusText);
  const isNotFit = /(not fit|不适配|skip|won t pursue|wont pursue|pass|不跟|暂缓)/i.test(statusText);
  let scoreAdjustment = 0;
  if (/(qualified|contacted|meeting|active|准备触达|已触达|已开会|持续跟进)/i.test(status)) scoreAdjustment += 2;
  if (/(researching|tracking|watchlist|待研究)/i.test(status)) scoreAdjustment += 1;
  if (isFalsePositive) scoreAdjustment -= 6;
  if (isNotFit) scoreAdjustment -= 4;

  const manualPromote =
    /promote to strict|promote|转正|升级 strict/i.test(status + ' ' + outcome) ||
    (/已开会|持续跟进/i.test(status) && Boolean(owner));

  return {
    status,
    priority: crm?.priority || project?.priorityBand || '',
    owner,
    targetPerson,
    nextAction,
    nextFollowUpAt: crm?.next_follow_up_at || '',
    reviewOutcome: outcome,
    reviewNotes: notes,
    notFitReason: dropReason,
    warmIntroPath: crm?.warm_intro_path || '',
    scoreAdjustment,
    shouldSuppress: isFalsePositive || isNotFit,
    suppressReason: isFalsePositive ? '误报' : isNotFit ? '不适配' : '',
    keepInRadar: /keep in radar|radar|继续观察/.test(normalizedOutcome),
    manualPromote,
    normalizedStatus,
    normalizedOutcome
  };
}

function applyWorkflowFeedback(projects, rootDir) {
  const crmRecords = readJson(resolveDataPath(rootDir, 'crm-records.json'), { records: [] }).records || [];
  const crmMap = new Map(crmRecords.map((record) => [normalizeKey(record.project_name), record]));

  return (projects || [])
    .map((project) => {
      const crm = crmMap.get(normalizeKey(project.name)) || null;
      const workflow = buildWorkflowMeta(project, crm);
      const score = Math.max(0, Number(project.score || 0) + Number(workflow.scoreAdjustment || 0));
      const workflowSignals = [];
      if (workflow.status) workflowSignals.push(`状态: ${workflow.status}`);
      if (workflow.owner) workflowSignals.push(`负责人: ${workflow.owner}`);
      if (workflow.nextFollowUpAt) workflowSignals.push(`下次跟进: ${workflow.nextFollowUpAt}`);
      return {
        ...project,
        score,
        workflow,
        nextStep: workflow.nextAction || project.nextStep,
        reasonSummary: Array.from(new Set([project.reasonSummary, ...workflowSignals].filter(Boolean))).slice(0, 3).join('；')
      };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.latestSeenAt || 0) - Date.parse(a.latestSeenAt || 0));
}

function buildRadarPromotionDecision(project) {
  const workflow = project?.workflow || {};
  const live = project?.liveSignals || {};
  const websiteSignals = live.website?.discoverySignals || [];
  const sourceStrength = Number(project?.priorityMeta?.sourceStrength || 0);
  const reasons = [];
  let promote = false;
  let mode = '';

  if (workflow.shouldSuppress || workflow.keepInRadar) {
    return { promote: false, mode: '', reasons: [] };
  }

  if (workflow.manualPromote) {
    promote = true;
    mode = 'manual';
    reasons.push(`人工标记转正${workflow.owner ? `（${workflow.owner}）` : ''}`);
  }

  if (project?.radarBucket === 'fundraising' && project?.fundraising?.latestRound && Number(project.score || 0) >= 14) {
    promote = true;
    mode = mode || 'auto';
    reasons.push(`融资轮次已确认：${project.fundraising.latestRound.roundStage || 'Funding Round'}`);
  }
  if (project?.radarBucket === 'dex' && Number(project.score || 0) >= 15 && /\b(dex|swap|amm|liquidity|orderbook|trading)\b/i.test([
    live.rootdata?.description || '',
    live.rootdata?.projectType || '',
    ...(live.website?.scanPages || []).map((page) => `${page.kind || ''} ${page.title || ''}`)
  ].join('\n'))) {
    promote = true;
    mode = mode || 'auto';
    reasons.push('DEX/流动性语义已被官网或资料源验证');
  }
  if (project?.radarBucket === 'ecosystem' && Number(project.score || 0) >= 14 && (websiteSignals.length >= 2 || sourceStrength >= 5)) {
    promote = true;
    mode = mode || 'auto';
    reasons.push('生态/开发者信号密度达到转正阈值');
  }
  if (!promote && Number(project.score || 0) >= 16 && (sourceStrength >= 5 || project?.hongKongTier === 'strong' || project?.hongKongFit)) {
    promote = true;
    mode = mode || 'auto';
    reasons.push('综合分数与业务相关度达到转正阈值');
  }

  return {
    promote,
    mode,
    reasons: summarizePromotionReasons(reasons)
  };
}

function promoteRadarProjects(projects) {
  return (projects || [])
    .map((project) => {
      const decision = buildRadarPromotionDecision(project);
      if (!decision.promote) return null;
      const promotedScore = Number(project.score || 0) + (decision.mode === 'manual' ? 2 : 1);
      const promotedReasons = summarizePromotionReasons([
        ...(project.reasons || []),
        ...decision.reasons,
        '已从 Radar Pool 转正进入主跟进列表'
      ]);
      return {
        ...project,
        score: promotedScore,
        discoveryPath: 'strict',
        promotedFromRadar: project.radarBucket || project.discoveryPath || 'radar',
        promotion: {
          mode: decision.mode,
          reasons: decision.reasons
        },
        reasons: promotedReasons,
        reasonSummary: Array.from(new Set([
          project.reasonSummary,
          ...decision.reasons,
          '已从 Radar Pool 转正进入主跟进列表'
        ].filter(Boolean))).slice(0, 3).join('；'),
        priorityBand: promotedScore >= 16 ? 'High' : 'Medium'
      };
    })
    .filter(Boolean);
}

function sortProjectsForAction(projects) {
  return [...(projects || [])]
    .filter((project) => !(project.workflow && project.workflow.shouldSuppress))
    .sort((a, b) => {
      const urgency = (project) => {
        const workflow = project.workflow || {};
        const promotionBoost = project.promotedFromRadar ? 3 : 0;
        const ownerBoost = workflow.owner ? 1 : 0;
        const followUpBoost = workflow.nextFollowUpAt ? 1 : 0;
        const freshnessBoost = project.freshness === 'new' ? 3 : project.freshness === 'rising' ? 2 : 1;
        const priorityBoost = project.priorityBand === 'High' ? 3 : project.priorityBand === 'Medium' ? 2 : 1;
        return Number(project.score || 0) + promotionBoost + ownerBoost + followUpBoost + freshnessBoost + priorityBoost;
      };
      return urgency(b) - urgency(a) || Date.parse(b.latestSeenAt || 0) - Date.parse(a.latestSeenAt || 0);
    });
}

function groupItemsByQuery(items) {
  const grouped = { strict: [], fundraising: [], dex: [], ecosystem: [] };
  for (const item of items || []) {
    const key = item.queryGroup || 'strict';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  return grouped;
}

function formatDigest(projects, config) {
  const topProjects = sortProjectsForAction(projects).slice(0, Number(config.filters.topProjects || 8));
  const lines = [];
  lines.push(`OSL 项目情报日报`);
  lines.push(`时间: ${new Date().toLocaleString('zh-HK', { timeZone: config.timezone || 'Asia/Hong_Kong', hour12: false })}`);
  lines.push(`目标接收: ${config.telegram.openclawHandle || '未配置'}`);
  lines.push('');

  if (topProjects.length === 0) {
    lines.push('今天没有筛到超过阈值的新项目。建议检查数据源或适当放宽打分阈值。');
    return lines.join('\n');
  }

  topProjects.forEach((project, index) => {
    const freshnessLabel = project.freshness === 'new' ? 'NEW' : project.freshness === 'rising' ? 'RISING' : 'TRACKING';
    const workflow = project.workflow || {};
    const whyNow = project.promotedFromRadar
      ? `Radar 转正 (${project.promotedFromRadar})`
      : freshnessLabel;
    lines.push(`${index + 1}. ${project.name} | ${project.sector} | Score ${project.score} | Priority ${project.priorityBand} | ${whyNow}`);
    lines.push(`为什么现在: ${project.reasonSummary}`);
    lines.push(`建议负责人: ${workflow.owner || '待分配'} | 当前状态: ${workflow.status || '待研判'}`);
    lines.push(`建议动作: ${workflow.nextAction || project.nextStep || '先核验项目窗口，再找 warm intro。'}`);
    if (project.promotion?.reasons?.length) lines.push(`转正原因: ${project.promotion.reasons.join('；')}`);
    const latest = project.mentions.slice(0, 2).map((mention) => `- ${mention.title} (${mention.source || 'News'}) ${mention.link}`).join('\n');
    lines.push(`线索:\n${latest}`);
    lines.push('');
  });

  lines.push('建议动作:');
  lines.push('1. 优先核验是否已有 TGE / 已上其他主流交易所');
  lines.push('2. 查看官网或团队页面是否出现香港、合规、机构销售、法务相关表述');
  lines.push('3. 通过律师、做市商、托管或投资方网络找 warm intro');
  return lines.join('\n');
}

function formatTelegramDigest(projects, config) {
  const topProjects = sortProjectsForAction(projects).slice(0, Math.min(Number(config.filters.topProjects || 8), 5));
  const lines = [];
  lines.push(`OSL 项目情报日报`);
  lines.push(`${new Date().toLocaleString('zh-HK', { timeZone: config.timezone || 'Asia/Hong_Kong', hour12: false })}`);
  lines.push('');

  if (topProjects.length === 0) {
    lines.push('今天没有筛到超过阈值的新项目。');
    return lines.join('\n');
  }

  topProjects.forEach((project, index) => {
    const mention = project.mentions[0];
    const shortReason = project.reasonSummary.length > 60 ? `${project.reasonSummary.slice(0, 60)}...` : project.reasonSummary;
    const freshnessLabel = project.freshness === 'new' ? 'NEW' : project.freshness === 'rising' ? 'UP' : 'TRACK';
    lines.push(`${index + 1}. ${project.name} | ${project.sector} | ${project.score} | ${project.priorityBand} | ${project.promotedFromRadar ? 'PROMOTED' : freshnessLabel}`);
    lines.push(`理由: ${shortReason}`);
    if (project.workflow?.owner || project.nextStep) lines.push(`动作: ${(project.workflow?.owner || '待分配')} / ${(project.workflow?.nextAction || project.nextStep || '').slice(0, 48)}`);
    if (mention) {
      lines.push(`线索: ${mention.title}`);
      lines.push(mention.link);
    }
    lines.push('');
  });

  lines.push('建议: 先核验 TGE/已上所情况，再找 warm intro。');
  return lines.join('\n').slice(0, 3500);
}

function selectProjectsForPush(projects, history, config) {
  const pushedNameSet = new Set(
    (history.runs || [])
      .filter((run) => run.pushed)
      .flatMap((run) => (run.projects || []).map((project) => normalizeKey(project.name)))
  );

  return sortProjectsForAction(projects)
    .filter((project) => !pushedNameSet.has(normalizeKey(project.name)))
    .slice(0, Math.min(Number(config.filters.topProjects || 8), 5));
}

async function sendTelegram(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true
    })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(json.description || `Telegram push failed with ${res.status}`);
  }
  return json;
}

async function collectLeads(rootDir) {
  const config = readJson(resolveDataPath(rootDir, 'config.json'), {});
  const sources = readJson(resolveDataPath(rootDir, 'sources.json'), { rssQueries: [] });
  const sampleFeed = readJson(resolveDataPath(rootDir, 'sample-feed.json'), { items: [] });
  const history = readJson(resolveDataPath(rootDir, 'run-history.json'), { runs: [] });
  const previousPayload = readJson(resolveDataPath(rootDir, 'projects.json'), { looseProjects: [], fundraisingProjects: [], dexProjects: [], ecosystemProjects: [] });
  const items = [];
  let successCount = 0;
  const sourceResults = await Promise.all((sources.rssQueries || []).map(async (source) => {
    try {
      const xml = await fetchText(source.url, { timeoutMs: 8000 });
      return {
        ok: true,
        items: parseItems(xml).map((item) => ({
          ...item,
          source: item.source || item.creator || source.name,
          queryName: source.name,
          queryGroup: source.kind === 'x_list_rss'
            ? inferFeedQueryGroup(item, source.group || 'strict')
            : (source.group || 'strict')
        })).filter((item) => source.kind === 'x_list_rss' ? isUsefulXListItem(item) : true)
      };
    } catch (error) {
      return {
        ok: false,
        items: [{
          title: `[Source Error] ${source.name}`,
          link: source.url,
          pubDate: nowIso(),
          description: error.message,
          source: 'System'
        }]
      };
    }
  }));

  sourceResults.forEach((result) => {
    items.push(...result.items);
    if (result.ok) successCount += 1;
  });

  items.push(...await fetchOfficialEcosystemDirectoryItems(sources));

  if (successCount === 0 && Array.isArray(sampleFeed.items) && sampleFeed.items.length > 0) {
    items.push(...sampleFeed.items);
  }

  await refreshExternalCaches(rootDir, config);
  items.push(...buildXWatchItems(rootDir));

  const groupedItems = groupItemsByQuery(items);
  const strictItems = groupedItems.strict.length ? groupedItems.strict : items;
  const aggregatedProjects = aggregateProjects(strictItems, config, rootDir);
  const profiledProjects = buildProfileBackedProjects(items, config, rootDir);
  const strictProjects = rebalancePriorityBands(mergeProjectSets(aggregatedProjects, profiledProjects))
    .map((project) => ({
      ...project,
      discoveryPath: 'strict',
      maturityPath: project.internalFit === 'profiled' ? 'mature' : 'early'
    }));

  const fundraisingProjects = buildBucketRadarProjects(groupedItems.fundraising, config, rootDir, strictProjects, {
    bucketName: 'fundraising',
    label: 'Fundraising Radar',
    scoreBoost: 3,
    priorityCap: 'Medium'
  });
  const dexProjects = buildBucketRadarProjects(groupedItems.dex, config, rootDir, strictProjects, {
    bucketName: 'dex',
    label: 'DEX New Stars',
    scoreBoost: 2,
    priorityCap: 'Medium'
  });
  const ecosystemProjects = buildBucketRadarProjects(groupedItems.ecosystem, config, rootDir, strictProjects, {
    bucketName: 'ecosystem',
    label: 'Ecosystem Watch',
    scoreBoost: 1,
    priorityCap: 'Watch'
  });

  const mergedRadarProjects = mergeProjectSets(fundraisingProjects, mergeProjectSets(dexProjects, ecosystemProjects))
    .map((project) => ({
      ...project,
      discoveryPath: project.discoveryPath || 'loose',
      maturityPath: project.maturityPath || 'early'
    }));

  const baseProjects = enrichProjects(strictProjects, rootDir);
  const rankedProjects = applyWorkflowFeedback(
    await enrichWithExternalSources(rootDir, config, baseProjects),
    rootDir
  );
  const radarProjects = rerankRadarProjectsWithExternalSignals(
    applyWorkflowFeedback(
      await enrichWithExternalSources(rootDir, config, enrichProjects(mergedRadarProjects, rootDir)),
      rootDir
    )
  );
  const enrichedFundraisingProjects = rerankRadarProjectsWithExternalSignals(
    applyWorkflowFeedback(
      await enrichWithExternalSources(rootDir, config, enrichProjects(fundraisingProjects, rootDir)),
      rootDir
    ),
    { bucketName: 'fundraising' }
  );
  const enrichedDexProjects = rerankRadarProjectsWithExternalSignals(
    applyWorkflowFeedback(
      await enrichWithExternalSources(rootDir, config, enrichProjects(dexProjects, rootDir)),
      rootDir
    ),
    { bucketName: 'dex' }
  );
  const enrichedEcosystemProjects = rerankRadarProjectsWithExternalSignals(
    applyWorkflowFeedback(
      await enrichWithExternalSources(rootDir, config, enrichProjects(ecosystemProjects, rootDir)),
      rootDir
    ),
    { bucketName: 'ecosystem' }
  );

  const promotedRadarProjects = promoteRadarProjects([
    ...enrichedFundraisingProjects,
    ...enrichedDexProjects,
    ...enrichedEcosystemProjects
  ]);
  const promotedKeys = new Set(promotedRadarProjects.map((project) => normalizeKey(project.name)));
  const finalStrictProjects = sortProjectsForAction(
    filterProjectsWithIdentity(rebalancePriorityBands(
      annotateNovelty(
        mergeProjectSets(promotedRadarProjects, rankedProjects),
        history
      )
    ))
  );
  const retainedFundraisingProjects = retainRadarProjects(
    enrichedFundraisingProjects.filter((project) => !promotedKeys.has(normalizeKey(project.name))),
    previousPayload.fundraisingProjects || [],
    { previousGeneratedAt: previousPayload.generatedAt, currentGeneratedAt: nowIso() }
  );
  const retainedDexProjects = retainRadarProjects(
    enrichedDexProjects.filter((project) => !promotedKeys.has(normalizeKey(project.name))),
    previousPayload.dexProjects || [],
    { previousGeneratedAt: previousPayload.generatedAt, currentGeneratedAt: nowIso() }
  );
  const retainedEcosystemProjects = retainRadarProjects(
    enrichedEcosystemProjects.filter((project) => !promotedKeys.has(normalizeKey(project.name))),
    previousPayload.ecosystemProjects || [],
    { previousGeneratedAt: previousPayload.generatedAt, currentGeneratedAt: nowIso() }
  );

  const finalFundraisingProjects = sortProjectsForAction(
    dedupeProjectsByName(await enrichWithExternalSources(rootDir, config, enrichProjects(retainedFundraisingProjects, rootDir)))
  );
  const finalDexProjects = sortProjectsForAction(
    dedupeProjectsByName(await enrichWithExternalSources(rootDir, config, enrichProjects(retainedDexProjects, rootDir)))
  );
  const finalEcosystemProjects = sortProjectsForAction(
    dedupeProjectsByName(await enrichWithExternalSources(rootDir, config, enrichProjects(retainedEcosystemProjects, rootDir)))
  );

  const radarPoolFundraisingProjects = finalFundraisingProjects.filter((project) => shouldDisplayInRadarPool(project));
  const radarPoolDexProjects = finalDexProjects.filter((project) => shouldDisplayInRadarPool(project));
  const radarPoolEcosystemProjects = finalEcosystemProjects.filter((project) => shouldDisplayInRadarPool(project));
  const watchOverflowProjects = [
    ...finalFundraisingProjects.filter((project) => !shouldDisplayInRadarPool(project)),
    ...finalDexProjects.filter((project) => !shouldDisplayInRadarPool(project)),
    ...finalEcosystemProjects.filter((project) => !shouldDisplayInRadarPool(project))
  ].map((project) => ({
    ...project,
    discoveryPath: 'loose',
    watchSource: project.radarBucket || project.discoveryPath || 'radar'
  }));

  const radarBucketKeys = new Set([
    ...radarPoolFundraisingProjects,
    ...radarPoolDexProjects,
    ...radarPoolEcosystemProjects
  ].map((project) => normalizeKey(project.name)));

  const retainedRadarProjects = retainRadarProjects(
    radarProjects.filter((project) => !promotedKeys.has(normalizeKey(project.name))),
    previousPayload.looseProjects || [],
    { previousGeneratedAt: previousPayload.generatedAt, currentGeneratedAt: nowIso() }
  ).filter((project) => !radarBucketKeys.has(normalizeKey(project.name)));

  const finalRadarProjects = sortProjectsForAction(
    dedupeProjectsByName(await enrichWithExternalSources(rootDir, config, enrichProjects([
      ...watchOverflowProjects,
      ...retainedRadarProjects
    ], rootDir)))
  );

  const payload = {
    generatedAt: nowIso(),
    sourceMode: successCount === 0 ? 'fallback' : 'live',
    projects: finalStrictProjects,
    strictProjects: finalStrictProjects,
    looseProjects: finalRadarProjects,
    fundraisingProjects: radarPoolFundraisingProjects,
    dexProjects: radarPoolDexProjects,
    ecosystemProjects: radarPoolEcosystemProjects
  };
  writeJson(resolveDataPath(rootDir, 'projects.json'), payload);
  return payload;
}

async function runDigest(rootDir, options = {}) {
  const config = readJson(resolveDataPath(rootDir, 'config.json'), {});
  const result = await collectLeads(rootDir);
  const text = formatDigest(result.projects, config);
  writeText(resolveDataPath(rootDir, 'telegram-message.txt'), text + '\n');

  const historyPath = resolveDataPath(rootDir, 'run-history.json');
  const history = readJson(historyPath, { runs: [] });
  const pushProjects = selectProjectsForPush(result.projects, history, config);
  const telegramText = formatTelegramDigest(pushProjects, config);
  const runRecord = {
    ranAt: nowIso(),
    projects: (options.push ? pushProjects : result.projects.slice(0, Number(config.filters.topProjects || 8))).map((project) => ({
      name: project.name,
      score: project.score
    })),
    pushed: false,
    target: config.telegram.openclawHandle || '',
    skippedReason: ''
  };

  if (options.push && pushProjects.length === 0) {
    runRecord.skippedReason = 'no_new_projects';
  } else if (options.push && config.telegram.botToken && config.telegram.chatId) {
    await sendTelegram(config.telegram.botToken, config.telegram.chatId, telegramText);
    runRecord.pushed = true;
    runRecord.target = config.telegram.chatId;
  }

  history.runs.unshift(runRecord);
  history.runs = history.runs.slice(0, 30);
  writeJson(historyPath, history);

  return {
    ...result,
    text,
    pushed: runRecord.pushed,
    target: runRecord.target
  };
}

function buildDashboardHtml(rootDir, options = {}) {
  const basePath = String(options.basePath || '').replace(/\/+$/, '');
  const asset = (pathname) => `${basePath}${pathname}`;
  const projectPayload = readJson(resolveDataPath(rootDir, 'projects.json'), { generatedAt: '', projects: [], strictProjects: [], looseProjects: [] });
  const history = readJson(resolveDataPath(rootDir, 'run-history.json'), { runs: [] });
  const emailTemplates = readJson(resolveDataPath(rootDir, 'email-templates.json'), { templates: [] });
  const crmRecords = readJson(resolveDataPath(rootDir, 'crm-records.json'), { records: [] });
  const crmFields = readJson(resolveDataPath(rootDir, 'crm-fields.json'), { fields: [] });
  const projectRules = readJson(resolveDataPath(rootDir, 'project-rules.json'), { whitelist: [], blacklist: [] });
  const internalRules = readJson(resolveDataPath(rootDir, 'internal-screening-rules.json'), { thresholds: {} });
  const oslListed = readJson(resolveDataPath(rootDir, 'osl-global-listed.json'), { assets: [] });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OSL Deal Scout</title>
  <link rel="icon" type="image/svg+xml" href="${asset('/favicon.svg')}" />
  <link rel="stylesheet" href="${asset('/styles.css')}" />
  <link rel="apple-touch-icon" href="${asset('/apple-touch-icon.png')}" />
</head>
<body>

  <!-- TOPBAR -->
  <header class="topbar">
    <button id="homeBtn" class="topbar-brand" type="button" title="返回主页">
      <img src="${asset('/logo-mark.svg')}" alt="OSL Deal Scout" class="brand-logo" />
      <span class="brand-name">OSL Deal Scout</span>
    </button>

    <div class="topbar-search">
      <input type="text" id="searchInput" placeholder="搜索项目名、赛道、信号..." />
    </div>
    <div class="topbar-actions">
      <button id="refreshBtn" class="btn btn-primary">刷新情报</button>
      <a href="${asset('/token-config')}" class="btn">币种配置</a>
      <div class="dropdown">
        <button id="digestBtn" class="btn">生成日报 ▾</button>
        <div id="digestMenu" class="dropdown-menu">
          <button id="exportBtn" class="dropdown-item">导出 CSV</button>
          <button id="digestOnly" class="dropdown-item">仅生成日报</button>
          <button id="digestViewText" class="dropdown-item">查看文本日报</button>
          <button id="digestPush" class="dropdown-item">生成并推送 Telegram</button>
        </div>
      </div>
      <button id="sidebarToggle" class="btn btn-icon sidebar-toggle" title="侧边栏">☰</button>
    </div>
  </header>

  <!-- THREE-COLUMN WORKBENCH -->
  <div class="workbench">

    <!-- LEFT: Project List -->
    <div class="col-left" id="colLeft">
      <div class="list-toolbar">
        <select id="filterSector" class="filter-select">
          <option value="">赛道</option>
          <option value="RWA">RWA</option>
          <option value="Stablecoin">Stablecoin</option>
          <option value="Institutional">Institutional</option>
          <option value="DeFi">DeFi</option>
          <option value="Infra">Infra</option>
          <option value="Wallet">Wallet</option>
          <option value="General">General</option>
        </select>
        <select id="filterPriority" class="filter-select">
          <option value="">优先级</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Watch">Watch</option>
        </select>
        <select id="filterFreshness" class="filter-select">
          <option value="">状态</option>
          <option value="new">新项目</option>
          <option value="rising">热度上升</option>
          <option value="repeat">持续跟踪</option>
        </select>
        <select id="filterHongKong" class="filter-select">
          <option value="">香港</option>
          <option value="yes">是</option>
          <option value="no">否</option>
        </select>
        <select id="sortBy" class="filter-select">
          <option value="score">按分数</option>
          <option value="name">按名称</option>
          <option value="freshness">按新鲜度</option>
        </select>
      </div>
      <div class="pool-tabs" id="poolTabs">
        <button class="pool-tab active" data-pool="bd">BD Pools</button>
        <button class="pool-tab" data-pool="watch">Watch Radar</button>
        <button class="pool-tab" data-pool="radar">Radar Pools</button>
      </div>
      <div id="listCount" class="list-count"></div>
      <div id="projectList" class="col-scroll"></div>
    </div>

    <!-- CENTER: Detail -->
    <div class="col-center" id="colCenter">
      <div id="detailHeader" class="detail-header"></div>
      <div id="tabsBar" class="tabs"></div>
      <div id="detailContent" class="col-scroll" style="padding-bottom:40px;"></div>
    </div>

    <!-- RIGHT: Sidebar -->
    <div class="col-right" id="colRight">
      <div class="col-scroll">
        <div class="sidebar-section">
          <div class="sidebar-title">概览</div>
          <div class="stats-grid">
            <div class="stat-card"><div id="statTotal" class="stat-value">0</div><div class="stat-label">项目总数</div></div>
            <div class="stat-card"><div id="statHigh" class="stat-value score-high">0</div><div class="stat-label">High 优先</div></div>
            <div class="stat-card"><div id="statCrm" class="stat-value">0</div><div class="stat-label">CRM 已建档</div></div>
            <div class="stat-card"><div id="statLastRun" class="stat-value text-sm">—</div><div class="stat-label">最后刷新</div></div>
          </div>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-title">CRM 看板</div>
          <div id="crmBoard"></div>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-title">内部门槛</div>
          <div id="rulesPanel"></div>
        </div>
      </div>
    </div>

  </div>

  <!-- MOBILE NAV -->
  <nav class="mobile-nav">
    <button class="mobile-nav-btn active" data-target="colLeft">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      项目
    </button>
    <button class="mobile-nav-btn" data-target="colCenter">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      详情
    </button>
    <button class="mobile-nav-btn" data-target="colRight">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      工具
    </button>
  </nav>

  <!-- TOAST CONTAINER -->
  <div id="toastContainer" class="toast-container"></div>

  <script>window.__BASE_PATH__=${JSON.stringify(basePath)};window.__BOOTSTRAP__=${JSON.stringify({
    projects: projectPayload.projects,
    strictProjects: projectPayload.strictProjects || projectPayload.projects,
    looseProjects: projectPayload.looseProjects || [],
    fundraisingProjects: projectPayload.fundraisingProjects || [],
    dexProjects: projectPayload.dexProjects || [],
    ecosystemProjects: projectPayload.ecosystemProjects || [],
    history: history.runs,
    emailTemplates: emailTemplates.templates,
    crmRecords: crmRecords.records,
    crmFields: crmFields.fields,
    projectRules,
    internalRules,
    oslListed
  })}</script>
  <script src="${asset('/app.js')}"></script>
</body>
</html>`;
}

function buildTokenConfigHtml(rootDir, options = {}) {
  const basePath = String(options.basePath || '').replace(/\/+$/, '');
  const asset = (pathname) => `${basePath}${pathname}`;
  const dashboardHref = asset('/');
  const bootstrap = {
    tabs: [
      { key: 'token', label: '币种配置表', ready: true },
      { key: 'chain', label: '币链配置表', ready: false },
      { key: 'pair', label: '币对配置表', ready: false },
      { key: 'contract', label: '合约配置表', ready: false }
    ]
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OSL Token Config</title>
  <link rel="icon" type="image/svg+xml" href="${asset('/favicon.svg')}" />
  <link rel="stylesheet" href="${asset('/styles.css')}" />
  <link rel="apple-touch-icon" href="${asset('/apple-touch-icon.png')}" />
</head>
<body class="tool-page">
  <header class="topbar">
    <div class="topbar-brand topbar-brand-static">
      <img src="${asset('/logo-mark.svg')}" alt="OSL Token Config" class="brand-logo" />
      <span class="brand-name">OSL Token Config</span>
    </div>
  </header>

  <main class="tool-layout">
    <section class="tool-hero">
      <div class="tool-back-wrap">
        <button id="backToDashboardBtn" class="tool-back-btn" type="button" data-fallback-href="${dashboardHref}" aria-label="返回 Deal Scout">
          <span class="tool-back-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M20 12H6" />
              <path d="M12 6L6 12L12 18" />
            </svg>
          </span>
        </button>
      </div>
      <h1>币种配置助手</h1>
      <p>搜索任意币种，后续会在这里生成运营上币配置所需的币种、币链、币对与合约参数。</p>
    </section>

    <section class="token-config-card">
      <div class="token-config-search">
        <label class="token-config-label" for="tokenKeyword">搜索币种</label>
        <div class="token-config-searchbox">
          <input id="tokenKeyword" type="text" autocomplete="off" placeholder="输入币种名称或简称，例如 Ethena / ENA" />
          <div id="tokenSearchDropdown" class="token-search-dropdown hidden"></div>
        </div>
        <div class="token-config-hint">联想结果会优先来自 CoinMarketCap，并展示币种全称、合约地址和市值排名。</div>
      </div>

      <div class="token-config-result-head">
        <div id="tokenSelectionMeta" class="token-selection-meta">选择下拉结果后生成配置表</div>
      </div>

      <div id="tokenConfigTabs" class="token-config-tabs"></div>
      <div id="tokenConfigPanels" class="token-config-panels"></div>
      <div id="tokenConfigStatus" class="token-config-status">先搜索一个币种开始。</div>
      <div id="tokenConfigError" class="token-config-error hidden"></div>
      <div id="tokenConfigLoading" class="token-config-loading hidden">正在抓取 CoinMarketCap 数据…</div>
      <div id="tokenConfigEmpty" class="token-config-placeholder">
        <div class="token-config-placeholder-title">币种配置表已接入</div>
        <p>当前已支持第一个 tab：币种配置表。选择币种后会抓取币种名称、全称、属性、显示精度、使用精度、币种符号和币种价格。</p>
      </div>
    </section>
  </main>
  <script>window.__TOKEN_CONFIG_BOOTSTRAP__ = ${JSON.stringify(bootstrap)}; window.__BASE_PATH__ = ${JSON.stringify(basePath)};</script>
  <script src="${asset('/token-config.js')}"></script>
</body>
</html>`;
}

module.exports = {
  buildRadarPromotionDecision,
  buildDashboardHtml,
  buildTokenConfigHtml,
  searchCmcCatalog,
  fetchCmcCoinDetail,
  buildTokenConfigRow,
  analyzeWebsiteDiscoverySignals,
  applyWorkflowFeedback,
  classifyLeadEntity,
  collectLeads,
  classifyMentionSource,
  detectEntityType,
  extractProjectName,
  extractOfficialEcosystemDirectoryItems,
  extractWebsiteScanLinks,
  extractLooseCandidateName,
  filterProjectsWithIdentity,
  hasProjectIdentityAnchor,
  isUsefulXListItem,
  retainRadarProjects,
  dedupeProjectsByName,
  shouldDisplayInRadarPool,
  isDexBucketCandidate,
  isEcosystemBucketCandidate,
  isFundraisingBucketCandidate,
  isRelevantMentionForProject,
  parseCryptoRankFundingPage,
  sortProjectsForAction,
  formatDigest,
  nowIso,
  runDigest
};

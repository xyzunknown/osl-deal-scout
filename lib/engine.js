const fs = require('fs');
const path = require('path');
const { readJson, resolveDataPath, writeJson, writeText } = require('./store');

const PROJECT_STOPWORDS = new Set([
  'A', 'An', 'And', 'Asia', 'At', 'By', 'Crypto', 'For', 'From', 'Fund', 'Funds',
  'Hong', 'In', 'Institutional', 'Into', 'Is', 'Launches', 'New', 'Of', 'On',
  'Protocol', 'Raises', 'Regulated', 'The', 'To', 'Token', 'Tokens', 'Web3', 'With'
]);

const MAJOR_ASSET_BLOCKLIST = new Set([
  'bitcoin', 'btc', 'ethereum', 'eth', 'xrp', 'ripple', 'solana', 'sol',
  'bnb', 'binance coin', 'dogecoin', 'doge', 'cardano', 'ada', 'tron', 'trx',
  'avalanche', 'avax', 'chainlink', 'link', 'sui', 'toncoin', 'ton'
]);

const DEFAULT_REJECT_SYMBOLS = new Set([
  'btc', 'eth', 'usdt', 'ada', 'ltc', 'doge', 'xrp', 'sol', 'bnb'
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
  const timeout = setTimeout(() => ac.abort(), 12000);
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
      source: extractTag(block, 'source')
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

function inferContact(project, profile) {
  if (profile && profile.contact) return profile.contact;
  return {
    label: 'Primary path',
    value: 'Use official website or X for first contact'
  };
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

async function refreshWebsiteSignals(rootDir, config, cache, profiles) {
  const ttlHours = config.apis?.cacheHours?.website || 24;
  const complianceRegex = /\b(compliant|regulat|institutional|mica|hong kong|singapore|uae|custody|licensed|regulated)\b/ig;

  for (const profile of profiles) {
    if (!profile.website) continue;
    const cacheKey = profile.slug || profile.name;
    if (isCacheFresh(cache.website[cacheKey], ttlHours)) continue;
    try {
      const homepage = await fetchText(profile.website);
      const blogText = profile.blogUrl ? await fetchText(profile.blogUrl).catch(() => '') : '';
      const merged = `${homepage}\n${blogText}`;
      const title = extractBetween(homepage, '<title[^>]*>', '</title>') || profile.name;
      const description = extractBetween(homepage, 'name="description" content="', '"') || extractBetween(homepage, "property=\"og:description\" content=\"", '"');
      const complianceHits = Array.from(new Set((merged.match(complianceRegex) || []).map((item) => item.toLowerCase()))).slice(0, 6);
      cache.website[cacheKey] = {
        fetchedAt: nowIso(),
        title: stripTags(title),
        description: stripTags(description),
        complianceHits,
        blogUrl: profile.blogUrl || ''
      };
    } catch (error) {
      cache.website[cacheKey] = {
        fetchedAt: nowIso(),
        error: error.message
      };
    }
  }
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

async function refreshExternalCaches(rootDir, config) {
  const profiles = loadProfileList(rootDir);
  const cache = loadApiCache(rootDir);

  await refreshCoinGeckoData(rootDir, config, cache, profiles).catch(() => { });
  await refreshDefiLlamaData(rootDir, config, cache, profiles).catch(() => { });
  await refreshWebsiteSignals(rootDir, config, cache, profiles).catch(() => { });
  await refreshRootData(rootDir, config, cache, profiles).catch(() => { });
  await refreshOpenNewsData(rootDir, config, cache, profiles).catch(() => { });
  await refreshOpenTwitterData(rootDir, config, cache, profiles).catch(() => { });

  saveApiCache(rootDir, cache);
  return cache;
}

function mergeExternalDataIntoProject(project, profile, cache) {
  const coingecko = profile?.coingeckoId ? cache.coingecko[profile.coingeckoId] : null;
  const defillamaAll = cache.defillama.__all?.protocols || {};
  const defillama = profile?.defillamaSlug
    ? defillamaAll[normalizeKey(profile.defillamaSlug)] || defillamaAll[normalizeKey(profile.name)]
    : defillamaAll[normalizeKey(project.name)];
  const website = cache.website[profile?.slug || project.slug || project.name] || null;
  const rootdata = cache.rootdata[profile?.slug || project.slug || project.name] || null;
  const opennews = cache.opennews[profile?.slug || project.slug || project.name] || null;
  const opentwitter = cache.opentwitter[profile?.slug || project.slug || project.name] || null;

  const screening = {
    ...(project.screening || {})
  };
  if (defillama?.tvlUsd) screening.tvlUsd = Number(defillama.tvlUsd || screening.tvlUsd || 0);
  if (coingecko?.marketCapUsd) screening.marketCapUsd = Number(coingecko.marketCapUsd || screening.marketCapUsd || 0);
  if (coingecko?.dailyVolumeUsd) screening.dailyVolumeUsd = Number(coingecko.dailyVolumeUsd || screening.dailyVolumeUsd || 0);

  const sourceNotes = [...(project.sourceNotes || [])];
  if (coingecko) sourceNotes.push(`CoinGecko live cache: mcap ${formatCompactUsd(coingecko.marketCapUsd)}, volume ${formatCompactUsd(coingecko.dailyVolumeUsd)}`);
  if (defillama) sourceNotes.push(`DeFiLlama live cache: TVL ${formatCompactUsd(defillama.tvlUsd)} in ${defillama.category || 'protocol'} category`);
  if (website?.complianceHits?.length) sourceNotes.push(`Website/blog signals: ${website.complianceHits.join(', ')}`);
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
    website: website ? {
      fetchedAt: website.fetchedAt || '',
      title: website.title || '',
      description: website.description || '',
      complianceHits: Array.isArray(website.complianceHits) ? website.complianceHits : [],
      blogUrl: website.blogUrl || '',
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
    screening,
    sourceNotes: Array.from(new Set(sourceNotes)),
    liveSignals,
    hongKongFit
  };
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
  await refreshWebsiteSignals(rootDir, config, cache, profiles).catch(() => { });
  await refreshRootData(rootDir, config, cache, profiles).catch(() => { });
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
    .filter((name) => !/^(Hong Kong|Asia|Crypto|Web3|Exchange)$/i.test(name));

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
    const hkTier = inferHongKongTier(text);
    const hasEarlyPathSignal = earlyScore.hits.some((key) => ['funding', 'launch', 'ecosystem', 'infra', 'ai', 'github'].includes(key));
    const hasCryptoIdentityEvidence = /\b(protocol|network|token|mainnet|testnet|defi|chain|wallet|rollup|oracle|sdk|onchain|blockchain|ecosystem)\b/i.test(text);
    const looseMention = {
      title: item.title,
      link: item.link,
      source: item.source || 'News',
      publishedAt: item.pubDate || nowIso()
    };
    if (!hasEarlyPathSignal) continue;
    if (!hasCryptoIdentityEvidence) continue;
    if (earlyScore.total < 4) continue;
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

    existing.score += earlyScore.total + classifyMentionSource(looseMention, profile).weight;
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

function formatDigest(projects, config) {
  const topProjects = projects.slice(0, Number(config.filters.topProjects || 8));
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
    lines.push(`${index + 1}. ${project.name} | ${project.sector} | Score ${project.score} | Priority ${project.priorityBand} | ${freshnessLabel}`);
    lines.push(`理由: ${project.reasonSummary}`);
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
  const topProjects = projects.slice(0, Math.min(Number(config.filters.topProjects || 8), 5));
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
    lines.push(`${index + 1}. ${project.name} | ${project.sector} | ${project.score} | ${project.priorityBand} | ${freshnessLabel}`);
    lines.push(`理由: ${shortReason}`);
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

  return (projects || [])
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
  const items = [];
  let successCount = 0;

  for (const source of sources.rssQueries || []) {
    try {
      const xml = await fetchText(source.url);
      const parsed = parseItems(xml).map((item) => ({ ...item, queryName: source.name }));
      items.push(...parsed);
      successCount += 1;
    } catch (error) {
      items.push({
        title: `[Source Error] ${source.name}`,
        link: source.url,
        pubDate: nowIso(),
        description: error.message,
        source: 'System'
      });
    }
  }

  if (successCount === 0 && Array.isArray(sampleFeed.items) && sampleFeed.items.length > 0) {
    items.push(...sampleFeed.items);
  }

  await refreshExternalCaches(rootDir, config);

  const aggregatedProjects = aggregateProjects(items, config, rootDir);
  const profiledProjects = buildProfileBackedProjects(items, config, rootDir);
  const strictProjects = rebalancePriorityBands(mergeProjectSets(aggregatedProjects, profiledProjects))
    .map((project) => ({
      ...project,
      discoveryPath: 'strict',
      maturityPath: project.internalFit === 'profiled' ? 'mature' : 'early'
    }));
  const looseProjects = buildLooseRadarProjects(items, config, rootDir, strictProjects)
    .map((project) => ({
      ...project,
      discoveryPath: 'loose',
      maturityPath: project.maturityPath || 'early'
    }));
  const baseProjects = annotateNovelty(enrichProjects(strictProjects, rootDir), history);
  const rankedProjects = await enrichWithExternalSources(rootDir, config, baseProjects);
  const radarProjects = await enrichWithExternalSources(rootDir, config, enrichProjects(looseProjects, rootDir));
  const payload = {
    generatedAt: nowIso(),
    sourceMode: successCount === 0 ? 'fallback' : 'live',
    projects: rankedProjects,
    strictProjects: rankedProjects,
    looseProjects: radarProjects
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
    <div class="topbar-brand">
  <img src="${asset('/logo-mark.svg')}" alt="OSL Deal Scout" class="brand-logo" />
  <span class="brand-name">OSL Deal Scout</span>
</div>

    <div class="topbar-search">
      <input type="text" id="searchInput" placeholder="搜索项目名、赛道、信号..." />
    </div>
    <div class="topbar-actions">
      <button id="refreshBtn" class="btn btn-primary">刷新情报</button>
      <div class="dropdown">
        <button id="digestBtn" class="btn">生成日报 ▾</button>
        <div id="digestMenu" class="dropdown-menu">
          <button id="digestOnly" class="dropdown-item">仅生成日报</button>
          <button id="digestPush" class="dropdown-item">生成并推送 Telegram</button>
        </div>
      </div>
      <button id="exportBtn" class="btn btn-sm">导出 CSV</button>
      <a href="${asset('/api/digest')}" target="_blank" rel="noreferrer" class="btn btn-sm">查看文本日报</a>
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
          <div class="sidebar-title">Watch Radar</div>
          <div id="watchRadar"></div>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-title">运行记录</div>
          <div id="historyList"></div>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-title">筛选规则</div>
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

module.exports = {
  buildDashboardHtml,
  classifyLeadEntity,
  collectLeads,
  classifyMentionSource,
  detectEntityType,
  extractLooseCandidateName,
  isRelevantMentionForProject,
  formatDigest,
  nowIso,
  runDigest
};

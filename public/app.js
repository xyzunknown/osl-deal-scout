/* ===== OSL Deal Scout — Workbench App ===== */

const state = window.__BOOTSTRAP__ || {
  projects: [], history: [], emailTemplates: [],
  strictProjects: [], looseProjects: [], fundraisingProjects: [], dexProjects: [], ecosystemProjects: [],
  crmRecords: [], crmFields: [], projectRules: {},
  internalRules: {}, oslListed: {}
};
const BASE_PATH = String(window.__BASE_PATH__ || '').replace(/\/+$/, '');

// ===== UTILITIES =====
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function byId(id) { return document.getElementById(id); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtUsd(value) {
  const num = Number(value || 0);
  if (!num) return '—';
  return '$' + num.toLocaleString();
}
function fmtCompactUsd(value) {
  const num = Number(value || 0);
  if (!num) return '—';
  if (num >= 1_000_000_000) return '$' + (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return '$' + (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return '$' + (num / 1_000).toFixed(2) + 'K';
  return '$' + num.toFixed(0);
}
function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
function fmtDateShort(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}
function latestFundingRound(project) {
  return project && project.fundraising && project.fundraising.latestRound ? project.fundraising.latestRound : null;
}
function investorNames(round) {
  return ((round && round.investors) || []).map(item => item.name).filter(Boolean);
}
function fundingSummary(project) {
  const round = latestFundingRound(project);
  if (!round) return '';
  const parts = [
    round.roundStage || 'Funding Round',
    fmtDateShort(round.announcedAt)
  ];
  if (round.raiseUsd) parts.push(fmtCompactUsd(round.raiseUsd));
  return parts.filter(Boolean).join(' / ');
}

// ===== TOAST =====
function showToast(msg, type) {
  type = type || 'info';
  const container = byId('toastContainer');
  const t = el('div', 'toast toast-' + type, msg);
  container.appendChild(t);
  setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ===== CONFIRM MODAL =====
function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = el('div', 'modal-overlay');
    const card = el('div', 'modal-card');
    card.appendChild(el('div', 'modal-title', title));
    card.appendChild(el('div', 'modal-message', message));
    const actions = el('div', 'modal-actions');
    const cancelBtn = el('button', 'btn', '取消');
    const confirmBtn = el('button', 'btn btn-primary', '确认');
    cancelBtn.onclick = () => { overlay.remove(); resolve(false); };
    confirmBtn.onclick = () => { overlay.remove(); resolve(true); };
    overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    confirmBtn.focus();
  });
}

// ===== LOADING STATE =====
function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn._origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span>';
  } else {
    btn.disabled = false;
    if (btn._origHtml) btn.innerHTML = btn._origHtml;
  }
}

// ===== API HELPERS =====
async function postJson(url, body) {
  const res = await fetch(withBasePath(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function putJson(url, body) {
  const res = await fetch(withBasePath(url), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function deleteJson(url) {
  const res = await fetch(withBasePath(url), { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function withBasePath(url) {
  if (!url) return BASE_PATH || '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${BASE_PATH}${url.startsWith('/') ? url : `/${url}`}`;
}

// ===== STATE =====
let selectedSlug = '';
let activeTab = 'overview';
let searchQuery = '';
let filterSector = '';
let filterPriority = '';
let filterFreshness = '';
let filterHongKong = '';
let sortBy = 'score';
let activePool = 'bd';

function hasLiveSignals(project) {
  const live = project && project.liveSignals;
  return Boolean(live && (live.coingecko || live.defillama || live.website || live.rootdata || live.cryptorank));
}

function allKnownProjects() {
  const map = new Map();
  [
    ...(state.projects || []),
    ...(state.looseProjects || []),
    ...(state.fundraisingProjects || []),
    ...(state.dexProjects || []),
    ...(state.ecosystemProjects || [])
  ].forEach(project => {
    if (project && project.slug) map.set(project.slug, project);
  });
  return Array.from(map.values());
}

function currentProject() {
  const allProjects = allKnownProjects();
  if (!selectedSlug && allProjects.length) {
    const preferred = allProjects.find(hasLiveSignals) || allProjects[0];
    selectedSlug = preferred.slug;
  }
  return allProjects.find(p => p.slug === selectedSlug) || null;
}

function crmForProject(name) {
  return (state.crmRecords || []).find(r => r.project_name === name) || null;
}

function projectPriorityForBoard(name) {
  const proj = allKnownProjects().find(item => item.name === name);
  return proj ? proj.priorityBand : 'Watch';
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function crmBoardLane(record) {
  const status = String(record && record.status || '');
  const followUpAt = String(record && record.next_follow_up_at || '');
  const today = todayDateString();

  if (/暂缓|不跟/i.test(status)) return 'paused';
  if (/已触达/i.test(status)) return 'waiting';
  if (followUpAt && followUpAt <= today) return 'today';
  if (/待研究|准备触达|已开会|持续跟进/i.test(status)) return 'today';
  return 'today';
}

async function saveCrmRecord(project, updates) {
  const existing = crmForProject(project.name) || {};
  const data = {
    ...existing,
    ...updates,
    project_name: project.name
  };
  const encodedName = encodeURIComponent(project.name);
  await putJson('/api/crm-records/' + encodedName, data);
  const idx = (state.crmRecords || []).findIndex(r => r.project_name === project.name);
  if (idx >= 0) state.crmRecords[idx] = data;
  else state.crmRecords.push(data);
  renderSidebar();
  renderDetail();
  return data;
}

// ===== HASH ROUTING =====
function parseHash() {
  const h = window.location.hash.replace(/^#/, '');
  const parts = h.split('/');
  return { slug: parts[0] || '', tab: parts[1] || 'overview' };
}

function setHash(slug, tab) {
  slug = slug || selectedSlug;
  tab = tab || activeTab;
  const hash = tab === 'overview' ? slug : slug + '/' + tab;
  if (window.location.hash !== '#' + hash) {
    window.location.hash = hash;
  }
}

function onHashChange() {
  const h = parseHash();
  if (h.slug && h.slug !== selectedSlug) {
    selectedSlug = h.slug;
    renderProjectList();
    renderDetail();
  }
  if (h.tab && h.tab !== activeTab) {
    activeTab = h.tab;
    activateTab(activeTab);
  }
}

// ===== SCORING COLOR =====
function scoreClass(score) {
  if (score >= 12) return 'score-high';
  if (score >= 8) return 'score-mid';
  return 'score-low';
}

function priorityChipClass(band) {
  const b = String(band || '').toLowerCase();
  if (b === 'high') return 'chip-high';
  if (b === 'medium') return 'chip-medium';
  return 'chip-watch';
}

function freshnessLabel(f) {
  if (f === 'new') return '新项目';
  if (f === 'rising') return '热度上升';
  return '持续跟踪';
}

function freshnessChipClass(f) {
  if (f === 'new') return 'chip-new';
  if (f === 'rising') return 'chip-rising';
  return 'chip-repeat';
}

// ===== FILTERING & SORTING =====
function filteredProjects() {
  let list = currentPoolProjects();

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sector || '').toLowerCase().includes(q) ||
      (p.signals || []).some(s => s.toLowerCase().includes(q)) ||
      (p.reasonSummary || '').toLowerCase().includes(q)
    );
  }

  if (filterSector) list = list.filter(p => p.sector === filterSector);
  if (filterPriority) list = list.filter(p => p.priorityBand === filterPriority);
  if (filterFreshness) list = list.filter(p => p.freshness === filterFreshness);
  if (filterHongKong) list = list.filter(p => filterHongKong === 'yes' ? Boolean(p.hongKongFit) : !p.hongKongFit);

  list = [...list];
  if (sortBy === 'score') list.sort((a, b) => b.score - a.score);
  else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else if (sortBy === 'freshness') {
    const rank = { 'new': 3, 'rising': 2, 'repeat': 1 };
    list.sort((a, b) => (rank[b.freshness] || 0) - (rank[a.freshness] || 0) || b.score - a.score);
  }

  return list;
}

function currentPoolProjects() {
  if (activePool === 'watch') return [...(state.looseProjects || [])];
  if (activePool === 'radar') {
    return [
      ...(state.fundraisingProjects || []),
      ...(state.dexProjects || []),
      ...(state.ecosystemProjects || [])
    ];
  }
  return [...(state.strictProjects || state.projects || [])];
}

function currentPoolLabel() {
  if (activePool === 'watch') return 'Watch Radar';
  if (activePool === 'radar') return 'Radar Pools';
  return 'BD Pools';
}

function currentPoolEmptyText() {
  if (activePool === 'watch') return '暂无 Watch Radar 项目';
  if (activePool === 'radar') return '暂无 Radar Pools 项目';
  return '还没有数据，先点"刷新情报"';
}

function poolTagForProject(project) {
  if (activePool === 'watch') return project.discoveryPath || 'watch';
  if (activePool === 'radar') return project.radarBucket || project.discoveryPath || 'radar';
  return '';
}

function renderPoolTabs() {
  const root = byId('poolTabs');
  if (!root) return;
  root.querySelectorAll('.pool-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pool === activePool);
    const pool = btn.dataset.pool || 'bd';
    let count = 0;
    if (pool === 'watch') count = (state.looseProjects || []).length;
    else if (pool === 'radar') count = (state.fundraisingProjects || []).length + (state.dexProjects || []).length + (state.ecosystemProjects || []).length;
    else count = (state.strictProjects || state.projects || []).length;
    const baseLabel = pool === 'watch' ? 'Watch Radar' : pool === 'radar' ? 'Radar Pools' : 'BD Pools';
    btn.textContent = `${baseLabel} (${count})`;
  });
}

function createProjectRow(p) {
  const row = el('div', 'project-row' + (p.slug === selectedSlug ? ' active' : ''));
  row.dataset.slug = p.slug;

  const info = el('div', 'project-row-info');
  info.appendChild(el('div', 'project-row-name', p.name));
  const meta = el('div', 'project-row-meta');
  meta.appendChild(el('span', 'chip chip-sector', p.sector));
  meta.appendChild(el('span', 'chip ' + priorityChipClass(p.priorityBand), p.priorityBand));
  const poolTag = poolTagForProject(p);
  if (poolTag) meta.appendChild(el('span', 'chip chip-watch', poolTag));
  if (p.promotedFromRadar) meta.appendChild(el('span', 'chip chip-source', '已转正'));
  if (p.freshness) meta.appendChild(el('span', 'chip ' + freshnessChipClass(p.freshness), freshnessLabel(p.freshness)));
  if (p.hongKongFit) meta.appendChild(el('span', 'chip chip-hongkong', '香港'));
  if (hasLiveSignals(p)) meta.appendChild(el('span', 'chip chip-source', '已补数'));
  if (latestFundingRound(p)) meta.appendChild(el('span', 'chip chip-source', latestFundingRound(p).roundStage || 'Funding'));
  if (p.workflow && p.workflow.status) meta.appendChild(el('span', 'chip chip-watch', p.workflow.status));
  info.appendChild(meta);
  row.appendChild(info);

  const score = el('div', 'project-row-score ' + scoreClass(p.score), String(p.score));
  row.appendChild(score);

  row.addEventListener('click', () => {
    selectedSlug = p.slug;
    activeTab = 'overview';
    setHash(p.slug, 'overview');
    renderProjectList();
    renderDetail();
  });

  return row;
}

function renderRadarGroupedList(root, list) {
  const grouped = [
    { key: 'fundraising', label: 'Fundraising', projects: list.filter(p => (p.radarBucket || p.discoveryPath) === 'fundraising') },
    { key: 'dex', label: 'DEX', projects: list.filter(p => (p.radarBucket || p.discoveryPath) === 'dex') },
    { key: 'ecosystem', label: 'Ecosystem', projects: list.filter(p => (p.radarBucket || p.discoveryPath) === 'ecosystem') }
  ];

  grouped.forEach(group => {
    if (!group.projects.length) return;
    const section = el('div', 'project-group');
    const header = el('div', 'project-group-header');
    header.appendChild(el('span', 'project-group-title', group.label));
    header.appendChild(el('span', 'project-group-count', String(group.projects.length)));
    section.appendChild(header);
    group.projects.forEach(project => section.appendChild(createProjectRow(project)));
    root.appendChild(section);
  });
}

// ===== RENDER: PROJECT LIST (left column) =====
function renderProjectList() {
  const root = byId('projectList');
  root.innerHTML = '';
  const list = filteredProjects();

  byId('listCount').textContent = `${currentPoolLabel()} · ${list.length} 个项目`;

  if (!list.length) {
    root.appendChild(el('div', 'empty-state', searchQuery || filterSector || filterPriority || filterFreshness || filterHongKong ? '没有匹配的项目' : currentPoolEmptyText()));
    return;
  }

  if (activePool === 'radar') {
    renderRadarGroupedList(root, list);
    return;
  }

  list.forEach(p => root.appendChild(createProjectRow(p)));
}

// ===== RENDER: DETAIL (center column) =====
function renderDetail() {
  const p = currentProject();
  const header = byId('detailHeader');
  const tabsBar = byId('tabsBar');
  const content = byId('detailContent');

  if (!p) {
    header.innerHTML = '';
    tabsBar.innerHTML = '';
    content.innerHTML = '<div class="detail-empty">选择左侧项目查看详情，或先点击"刷新情报"获取数据</div>';
    return;
  }

  // Header
  header.innerHTML = '';
  const titleRow = el('div', 'detail-title-row');
  titleRow.appendChild(el('span', 'detail-name', p.name));
  const tags = el('div', 'detail-tags');
  tags.appendChild(el('span', 'chip chip-sector', p.sector));
  tags.appendChild(el('span', 'chip ' + priorityChipClass(p.priorityBand), p.priorityBand));
  tags.appendChild(el('span', 'chip ' + scoreClass(p.score), 'Score: ' + p.score));
  if (p.freshness) tags.appendChild(el('span', 'chip ' + freshnessChipClass(p.freshness), freshnessLabel(p.freshness)));
  if (p.hongKongFit) tags.appendChild(el('span', 'chip chip-hongkong', '香港'));
  if (p.region) tags.appendChild(el('span', 'chip chip-watch', p.region));
  if (p.stage) tags.appendChild(el('span', 'chip chip-watch', p.stage));
  titleRow.appendChild(tags);
  header.appendChild(titleRow);
  if (p.fitSummary) header.appendChild(el('div', 'detail-summary', p.fitSummary));

  // Tabs
  tabsBar.innerHTML = '';
  const tabDefs = [
    { key: 'overview', label: '项目解读' },
    { key: 'crm', label: 'CRM 记录' },
    { key: 'templates', label: '触达模板' },
    { key: 'mentions', label: '新闻线索 (' + (p.mentions || []).length + ')' }
  ];
  tabDefs.forEach(t => {
    const btn = el('button', 'tab-btn' + (activeTab === t.key ? ' active' : ''), t.label);
    btn.dataset.tab = t.key;
    btn.addEventListener('click', () => {
      activeTab = t.key;
      setHash(selectedSlug, t.key);
      activateTab(t.key);
      renderTabContent(t.key);
    });
    tabsBar.appendChild(btn);
  });

  renderTabContent(activeTab);
}

function activateTab(key) {
  document.querySelectorAll('#tabsBar .tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === key);
  });
}

function renderTabContent(key) {
  const p = currentProject();
  if (!p) return;
  const content = byId('detailContent');
  content.innerHTML = '';

  if (key === 'overview') renderOverviewTab(content, p);
  else if (key === 'crm') renderCrmTab(content, p);
  else if (key === 'templates') renderTemplatesTab(content, p);
  else if (key === 'mentions') renderMentionsTab(content, p);
}

// ===== TAB 1: OVERVIEW =====
function renderOverviewTab(root, p) {
  const grid = el('div', 'info-grid');
  const live = p.liveSignals || {};
  const fallbackWebsite = p.website || (live.website && live.website.siteUrl) || (live.rootdata && live.rootdata.website) || '';
  const telegramLinks = Array.from(new Set([
    ...(live.website && Array.isArray(live.website.telegramLinks) ? live.website.telegramLinks : []),
    p.contact && /(?:t\.me|telegram\.me|telegram\.dog)\//i.test(p.contact.value || '') ? p.contact.value : '',
    p.secondaryContact && /(?:t\.me|telegram\.me|telegram\.dog)\//i.test(p.secondaryContact.value || '') ? p.secondaryContact.value : ''
  ].filter(Boolean)));

  // Contact card
  const contactCard = el('div', 'info-card');
  contactCard.appendChild(el('div', 'info-card-title', '联系入口'));
  const contactItems = [
    fallbackWebsite ? { label: '官网', value: fallbackWebsite, href: fallbackWebsite } : null,
    p.twitter ? { label: '官推', value: p.twitter.replace(/^https?:\/\//, ''), href: p.twitter } : null,
    p.contact ? { label: p.contact.label || '联系方式', value: p.contact.value, href: p.contact.value.startsWith('http') ? p.contact.value : null } : null,
    p.secondaryContact ? { label: p.secondaryContact.label || '备用联系', value: p.secondaryContact.value, href: p.secondaryContact.value.startsWith('http') ? p.secondaryContact.value : null } : null,
    ...telegramLinks.map((href, index) => ({ label: index === 0 ? 'Telegram' : `Telegram ${index + 1}`, value: href, href }))
  ].filter(Boolean);
  contactItems.forEach(item => {
    const row = el('div', 'info-row');
    row.appendChild(el('span', 'info-row-label', item.label));
    if (item.href) {
      const a = el('a', '', item.value);
      a.href = item.href; a.target = '_blank'; a.rel = 'noreferrer';
      const val = el('span', 'info-row-value');
      val.appendChild(a);
      row.appendChild(val);
    } else {
      row.appendChild(el('span', 'info-row-value', item.value));
    }
    contactCard.appendChild(row);
  });
  if (!contactItems.length) contactCard.appendChild(el('div', 'text-muted text-sm', '暂无已验证联系信息'));
  grid.appendChild(contactCard);

  // Screening card
  const screenCard = el('div', 'info-card');
  screenCard.appendChild(el('div', 'info-card-title', 'OSL 规则匹配'));
  if (p.screening) {
    const metrics = [
      { label: 'TVL', value: '$' + Number(p.screening.tvlUsd || 0).toLocaleString() },
      { label: '市值', value: '$' + Number(p.screening.marketCapUsd || 0).toLocaleString() },
      { label: '24h 成交', value: '$' + Number(p.screening.dailyVolumeUsd || 0).toLocaleString() },
      { label: 'DEX 流动性', value: '$' + Number(p.screening.dexLiquidityUsd || 0).toLocaleString() }
    ];
    metrics.forEach(m => {
      const row = el('div', 'info-row');
      row.appendChild(el('span', 'info-row-label', m.label));
      row.appendChild(el('span', 'info-row-value', m.value));
      screenCard.appendChild(row);
    });
    if (p.screening.strategicFit && p.screening.strategicFit.length) {
      const fitRow = el('div', 'info-row');
      fitRow.appendChild(el('span', 'info-row-label', '战略适配'));
      fitRow.appendChild(el('span', 'info-row-value', p.screening.strategicFit.join(' / ')));
      screenCard.appendChild(fitRow);
    }
  } else {
    screenCard.appendChild(el('div', 'text-muted text-sm', '启发式筛选，未命中完整内部规则画像'));
  }
  grid.appendChild(screenCard);

  // Live source card
  const liveCard = el('div', 'info-card');
  liveCard.appendChild(el('div', 'info-card-title', '实时补数'));

  const liveRows = [];
  if (live.coingecko) {
    liveRows.push({
      label: 'CoinGecko',
      primary: `${fmtCompactUsd(live.coingecko.marketCapUsd)} 市值 / ${fmtCompactUsd(live.coingecko.dailyVolumeUsd)} 成交`,
      secondary: `24h ${live.coingecko.priceChange24h >= 0 ? '+' : ''}${Number(live.coingecko.priceChange24h || 0).toFixed(2)}%`,
      time: live.coingecko.fetchedAt
    });
  }
  if (live.defillama) {
    liveRows.push({
      label: 'DeFiLlama',
      primary: `${fmtCompactUsd(live.defillama.tvlUsd)} TVL`,
      secondary: live.defillama.category || 'Protocol',
      time: live.defillama.fetchedAt
    });
  }
  if (live.cryptorank) {
    const latestRound = live.cryptorank.latestRound;
    liveRows.push({
      label: 'CryptoRank',
      primary: `Rank ${live.cryptorank.rank || '—'} / ${live.cryptorank.category || live.cryptorank.type || 'Unclassified'}`,
      secondary: latestRound
        ? `${latestRound.roundStage || 'Funding'} / ${fmtDateShort(latestRound.announcedAt)} / ${(investorNames(latestRound).slice(0, 2).join(', ') || '未披露投资方')}`
        : `${fmtCompactUsd(live.cryptorank.marketCapUsd)} 市值 / ${fmtCompactUsd(live.cryptorank.volume24hUsd)} 成交`,
      time: live.cryptorank.fetchedAt
    });
  }
  if (live.website) {
    liveRows.push({
      label: '官网 / Blog',
      primary: live.website.title || '已抓取官网信号',
      secondary: (live.website.complianceHits || []).length ? ('命中: ' + live.website.complianceHits.join(', ')) : '未命中明确合规关键词',
      time: live.website.fetchedAt
    });
  }
  if (live.opennews && (live.opennews.articles || []).length) {
    const topArticle = live.opennews.articles[0];
    liveRows.push({
      label: 'OpenNews',
      primary: `${live.opennews.articles.length} 条相关新闻`,
      secondary: (topArticle && topArticle.text) ? topArticle.text.slice(0, 72) : '已拉取项目相关新闻',
      time: live.opennews.fetchedAt
    });
  }
  if (live.opentwitter && (live.opentwitter.tweets || []).length) {
    const topTweet = live.opentwitter.tweets[0];
    liveRows.push({
      label: 'OpenTwitter',
      primary: '@' + (live.opentwitter.username || 'official'),
      secondary: topTweet && topTweet.text ? topTweet.text.slice(0, 72) : '已拉取最近官方推文',
      time: live.opentwitter.fetchedAt
    });
  }
  if (live.rootdata && !live.rootdata.error && (live.rootdata.projectType || live.rootdata.description)) {
    liveRows.push({
      label: 'RootData',
      primary: live.rootdata.projectType || live.rootdata.projectName || '已抓取项目资料',
      secondary: (live.rootdata.description || '').slice(0, 72) || '已写入缓存',
      time: live.rootdata.fetchedAt
    });
  }

  if (liveRows.length) {
    liveRows.forEach(item => {
      const row = el('div', 'source-row');
      const meta = el('div', 'source-row-meta');
      meta.appendChild(el('div', 'source-row-label', item.label));
      meta.appendChild(el('div', 'source-row-primary', item.primary));
      meta.appendChild(el('div', 'source-row-secondary', item.secondary));
      row.appendChild(meta);
      row.appendChild(el('div', 'source-row-time', fmtTime(item.time)));
      liveCard.appendChild(row);
    });
  } else {
    liveCard.appendChild(el('div', 'text-muted text-sm', '当前项目还没有命中外部补数。通常是因为它来自 RSS 线索，但还没映射到资料库里的 CoinGecko / DeFiLlama / 官网档案。'));
  }
  grid.appendChild(liveCard);

  root.appendChild(grid);

  // Interpretation
  if (p.interpretation && p.interpretation.length) {
    const interCard = el('div', 'info-card mt-16');
    interCard.appendChild(el('div', 'info-card-title', '判断依据'));
    const ul = el('ul', 'info-list');
    p.interpretation.forEach(note => ul.appendChild(el('li', '', note)));
    interCard.appendChild(ul);
    root.appendChild(interCard);
  }

  // Reason summary
  if (p.reasonSummary) {
    const reasonCard = el('div', 'info-card mt-16');
    reasonCard.appendChild(el('div', 'info-card-title', '信号摘要'));
    reasonCard.appendChild(el('div', 'text-sm', p.reasonSummary));
    if (p.signals && p.signals.length) {
      const sigTags = el('div', 'flex-wrap gap-8 mt-8');
      p.signals.forEach(s => sigTags.appendChild(el('span', 'chip chip-sector', s)));
      reasonCard.appendChild(sigTags);
    }
    root.appendChild(reasonCard);
  }

  const quickActionsCard = el('div', 'info-card mt-16');
  quickActionsCard.appendChild(el('div', 'info-card-title', 'BD 快捷动作'));
  const quickActions = el('div', 'quick-actions');

  const contactBtn = el('button', 'btn btn-sm', '标记已触达');
  contactBtn.addEventListener('click', async () => {
    setLoading(contactBtn, true);
    try {
      await saveCrmRecord(p, {
        status: '已触达',
        next_action: '等待对方回复，准备 follow-up。',
        next_follow_up_at: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
      });
      showToast('已更新为“已触达”', 'success');
    } catch (e) {
      showToast('更新失败: ' + e.message, 'error');
    } finally {
      setLoading(contactBtn, false);
    }
  });
  quickActions.appendChild(contactBtn);

  const followUpBtn = el('button', 'btn btn-sm', '设置下次跟进');
  followUpBtn.addEventListener('click', async () => {
    const suggested = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const value = window.prompt('输入下次跟进日期（YYYY-MM-DD）', (p.workflow && p.workflow.nextFollowUpAt) || suggested);
    if (!value) return;
    setLoading(followUpBtn, true);
    try {
      await saveCrmRecord(p, {
        status: (p.workflow && p.workflow.status) || '持续跟进',
        next_follow_up_at: value
      });
      showToast('下次跟进日期已保存', 'success');
    } catch (e) {
      showToast('更新失败: ' + e.message, 'error');
    } finally {
      setLoading(followUpBtn, false);
    }
  });
  quickActions.appendChild(followUpBtn);

  const pauseBtn = el('button', 'btn btn-sm', '标记暂缓');
  pauseBtn.addEventListener('click', async () => {
    const reason = window.prompt('暂缓原因（可选）', (p.workflow && p.workflow.notFitReason) || '');
    setLoading(pauseBtn, true);
    try {
      await saveCrmRecord(p, {
        status: '暂缓',
        drop_reason: reason || ''
      });
      showToast('已标记为“暂缓”', 'success');
    } catch (e) {
      showToast('更新失败: ' + e.message, 'error');
    } finally {
      setLoading(pauseBtn, false);
    }
  });
  quickActions.appendChild(pauseBtn);

  quickActionsCard.appendChild(quickActions);
  root.appendChild(quickActionsCard);

  if ((p.workflow && (p.workflow.status || p.workflow.owner || p.workflow.nextAction || p.workflow.reviewOutcome)) || p.promotedFromRadar) {
    const workflowCard = el('div', 'info-card mt-16');
    workflowCard.appendChild(el('div', 'info-card-title', '跟进判断'));
    const workflowRows = [
      { label: '当前状态', value: p.workflow && p.workflow.status ? p.workflow.status : '待研判' },
      { label: '负责人', value: p.workflow && p.workflow.owner ? p.workflow.owner : '待分配' },
      { label: '目标联系人', value: p.workflow && p.workflow.targetPerson ? p.workflow.targetPerson : '—' },
      { label: '评审结论', value: p.workflow && p.workflow.reviewOutcome ? p.workflow.reviewOutcome : (p.promotedFromRadar ? 'Promoted to Strict' : '未填写') },
      { label: '下次跟进', value: p.workflow && p.workflow.nextFollowUpAt ? p.workflow.nextFollowUpAt : '—' }
    ];
    workflowRows.forEach(item => {
      const row = el('div', 'info-row');
      row.appendChild(el('span', 'info-row-label', item.label));
      row.appendChild(el('span', 'info-row-value', item.value));
      workflowCard.appendChild(row);
    });
    if (p.workflow && p.workflow.reviewNotes) {
      workflowCard.appendChild(el('div', 'text-sm mt-8', p.workflow.reviewNotes));
    }
    if (p.workflow && p.workflow.notFitReason) {
      workflowCard.appendChild(el('div', 'text-sm mt-8', '不适配原因: ' + p.workflow.notFitReason));
    }
    root.appendChild(workflowCard);
  }

  if (p.promotion && p.promotion.reasons && p.promotion.reasons.length) {
    const promotionCard = el('div', 'info-card mt-16');
    promotionCard.appendChild(el('div', 'info-card-title', 'Radar 转正'));
    const modeLabel = p.promotion.mode === 'manual' ? '人工转正' : '自动转正';
    promotionCard.appendChild(el('div', 'text-sm', `${modeLabel}${p.promotedFromRadar ? ` / 来源: ${p.promotedFromRadar}` : ''}`));
    const ul = el('ul', 'info-list');
    p.promotion.reasons.forEach(reason => ul.appendChild(el('li', '', reason)));
    promotionCard.appendChild(ul);
    root.appendChild(promotionCard);
  }

  if (p.fundraising && p.fundraising.latestRound) {
    const fundingCard = el('div', 'info-card mt-16');
    fundingCard.appendChild(el('div', 'info-card-title', '融资轮次'));
    const latestRound = p.fundraising.latestRound;
    const rows = [
      { label: 'Round Stage', value: latestRound.roundStage || '—' },
      { label: 'Announced', value: fmtDateShort(latestRound.announcedAt) },
      { label: 'Raise', value: fmtUsd(latestRound.raiseUsd) }
    ];
    rows.forEach(item => {
      const row = el('div', 'info-row');
      row.appendChild(el('span', 'info-row-label', item.label));
      row.appendChild(el('span', 'info-row-value', item.value));
      fundingCard.appendChild(row);
    });

    const investors = investorNames(latestRound);
    const investorRow = el('div', 'info-row');
    investorRow.appendChild(el('span', 'info-row-label', 'Investors'));
    investorRow.appendChild(el('span', 'info-row-value', investors.length ? investors.join(' / ') : '未披露'));
    fundingCard.appendChild(investorRow);

    if (latestRound.linkToAnnouncement) {
      const announceRow = el('div', 'info-row');
      announceRow.appendChild(el('span', 'info-row-label', 'Announcement'));
      const linkWrap = el('span', 'info-row-value');
      const a = el('a', '', latestRound.linkToAnnouncement.replace(/^https?:\/\//, ''));
      a.href = latestRound.linkToAnnouncement;
      a.target = '_blank';
      a.rel = 'noreferrer';
      linkWrap.appendChild(a);
      announceRow.appendChild(linkWrap);
      fundingCard.appendChild(announceRow);
    }

    root.appendChild(fundingCard);
  }

  if (live.website && ((live.website.complianceHits && live.website.complianceHits.length) || live.website.description)) {
    const signalCard = el('div', 'info-card mt-16');
    signalCard.appendChild(el('div', 'info-card-title', '合规与机构信号'));
    if (live.website.description) {
      signalCard.appendChild(el('div', 'text-sm', live.website.description));
    }
    if (live.website.complianceHits && live.website.complianceHits.length) {
      const hitWrap = el('div', 'flex-wrap gap-8 mt-8');
      live.website.complianceHits.forEach(hit => hitWrap.appendChild(el('span', 'chip chip-source', hit)));
      signalCard.appendChild(hitWrap);
    }
    root.appendChild(signalCard);
  }

  // Source notes (previously unrendered!)
  if (p.sourceNotes && p.sourceNotes.length) {
    const srcCard = el('div', 'info-card mt-16');
    srcCard.appendChild(el('div', 'info-card-title', '来源标注'));
    const ul = el('ul', 'info-list');
    p.sourceNotes.forEach(note => ul.appendChild(el('li', '', note)));
    srcCard.appendChild(ul);
    root.appendChild(srcCard);
  }

  // Next step
  if (p.nextStep) {
    const box = el('div', 'next-step-box mt-16');
    box.textContent = '下一步: ' + p.nextStep;
    root.appendChild(box);
  }
}

// ===== TAB 2: CRM =====
function renderCrmTab(root, p) {
  const record = crmForProject(p.name) || {};
  const fields = state.crmFields || [];
  const fieldMap = new Map(fields.map(field => [field.key, field]));
  const form = el('div', 'crm-form');

  const quickCard = el('div', 'info-card mt-16');
  quickCard.appendChild(el('div', 'info-card-title', 'BD 快速更新'));

  const quickFields = ['project_name', 'status', 'owner', 'target_person', 'next_action', 'next_follow_up_at'];
  quickFields.forEach((key) => {
    const field = fieldMap.get(key) || { key, label: key, type: key === 'next_action' ? 'long_text' : (key === 'next_follow_up_at' ? 'date' : 'text'), description: '' };
    quickCard.appendChild(buildCrmField(field, p, record));
  });
  form.appendChild(quickCard);

  const detailCard = el('details', 'mt-16');
  detailCard.open = Boolean(record.warm_intro_path || record.notes || record.drop_reason);
  const summary = el('summary', 'info-card-title', '补充信息');
  detailCard.appendChild(summary);
  const detailWrap = el('div', 'info-card');
  ['warm_intro_path', 'notes', 'drop_reason'].forEach((key) => {
    const field = fieldMap.get(key) || { key, label: key, type: 'long_text', description: '' };
    detailWrap.appendChild(buildCrmField(field, p, record));
  });
  detailCard.appendChild(detailWrap);
  form.appendChild(detailCard);

  const actions = el('div', 'crm-actions');
  const saveBtn = el('button', 'btn btn-primary', '保存');
  saveBtn.addEventListener('click', async () => {
    setLoading(saveBtn, true);
    try {
      const data = {};
      form.querySelectorAll('[data-field]').forEach(inp => {
        data[inp.dataset.field] = inp.value;
      });
      await saveCrmRecord(p, data);
      showToast('CRM 记录已保存', 'success');
    } catch (e) {
      showToast('保存失败: ' + e.message, 'error');
    } finally {
      setLoading(saveBtn, false);
    }
  });

  const deleteBtn = el('button', 'btn btn-danger', '删除');
  deleteBtn.addEventListener('click', async () => {
    const confirmed = await showConfirm('删除确认', '确定要删除 ' + p.name + ' 的 CRM 记录吗？');
    if (!confirmed) return;
    setLoading(deleteBtn, true);
    try {
      const encodedName = encodeURIComponent(p.name);
      await deleteJson('/api/crm-records/' + encodedName);
      state.crmRecords = (state.crmRecords || []).filter(r => r.project_name !== p.name);
      showToast('CRM 记录已删除', 'success');
      renderCrmTab(root.parentElement ? byId('detailContent') : root, p);
      renderSidebar();
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error');
    } finally {
      setLoading(deleteBtn, false);
    }
  });

  actions.appendChild(saveBtn);
  if (record.project_name) actions.appendChild(deleteBtn);
  form.appendChild(actions);
  root.appendChild(form);
}

function buildCrmField(field, project, record) {
  const group = el('div', 'form-group');
  group.appendChild(el('label', 'form-label', field.label));

  let input;
  const val = field.key === 'project_name' ? project.name : (record[field.key] || '');

  if (field.type === 'long_text') {
    input = el('textarea', 'form-input');
    input.value = val;
    input.rows = field.key === 'next_action' ? 2 : 3;
  } else if (field.type === 'single_select') {
    input = el('select', 'form-input');
    const emptyOpt = el('option', '', '— 选择 —');
    emptyOpt.value = '';
    input.appendChild(emptyOpt);
    const opts = (field.description || '').match(/[^，、,。.]+/g) || [];
    const cleanOpts = opts.map(o => o.replace(/^如\s*/, '').trim()).filter(o => o.length > 0 && o.length < 30);
    cleanOpts.forEach(o => {
      const opt = el('option', '', o);
      opt.value = o;
      if (o === val) opt.selected = true;
      input.appendChild(opt);
    });
    if (val && !cleanOpts.includes(val)) {
      const opt = el('option', '', val);
      opt.value = val;
      opt.selected = true;
      input.appendChild(opt);
    }
  } else if (field.type === 'date') {
    input = el('input', 'form-input');
    input.type = 'date';
    input.value = val;
  } else {
    input = el('input', 'form-input');
    input.type = 'text';
    input.value = val;
  }

  input.dataset.field = field.key;
  if (field.key === 'project_name') input.readOnly = true;
  if (field.description) group.appendChild(el('span', 'form-hint', field.description));
  group.appendChild(input);
  return group;
}

// ===== TAB 3: TEMPLATES =====
function renderTemplatesTab(root, p) {
  const templates = state.emailTemplates || [];
  if (!templates.length) {
    root.appendChild(el('div', 'empty-state', '暂无邮件模板'));
    return;
  }

  templates.forEach(tpl => {
    const filled = fillTemplate(tpl, p);
    const card = el('div', 'template-card');
    const head = el('div', 'template-head');
    head.appendChild(el('span', 'template-name', tpl.name));
    const copyBtn = el('button', 'btn btn-sm', '复制全文');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('Subject: ' + filled.subject + '\n\n' + filled.body);
        showToast('已复制到剪贴板', 'success');
      } catch (e) {
        showToast('复制失败', 'error');
      }
    });
    head.appendChild(copyBtn);
    card.appendChild(head);
    card.appendChild(el('div', 'template-subject', 'Subject: ' + filled.subject));
    card.appendChild(el('pre', 'template-body', filled.body));
    root.appendChild(card);
  });
}

function fillTemplate(tpl, p) {
  if (!p) return { subject: tpl.subject, body: tpl.body };
  const replacements = {
    project_name: p.name,
    signal_summary: p.reasonSummary || '',
    fit_reason: (p.screening && p.screening.strategicFit) ? p.screening.strategicFit.join(', ') : (p.fitSummary || ''),
    sender_name: 'OSL Deal Scout',
    contact_name: 'team'
  };
  const rep = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => replacements[k] || '');
  return { subject: rep(tpl.subject), body: rep(tpl.body) };
}

// ===== TAB 4: MENTIONS =====
function renderMentionsTab(root, p) {
  const mentions = p.mentions || [];
  if (!mentions.length) {
    root.appendChild(el('div', 'empty-state', '暂无新闻线索'));
    return;
  }

  mentions.forEach(m => {
    const item = el('div', 'mention-item');
    const titleEl = el('div', 'mention-title');
    if (m.link) {
      const a = el('a', '', m.title);
      a.href = m.link; a.target = '_blank'; a.rel = 'noreferrer';
      titleEl.appendChild(a);
    } else {
      titleEl.textContent = m.title;
    }
    item.appendChild(titleEl);
    const meta = el('div', 'mention-meta');
    meta.appendChild(el('span', '', m.source || 'News'));
    if (m.publishedAt) {
      meta.appendChild(el('span', '', m.publishedAt.replace('T', ' ').slice(0, 16)));
    }
    item.appendChild(meta);
    root.appendChild(item);
  });
}

// ===== RENDER: SIDEBAR (right column) =====
function renderSidebar() {
  renderStats();
  renderBoard();
  renderHistory();
  renderRules();
}

function renderStats() {
  const projects = state.strictProjects && state.strictProjects.length ? state.strictProjects : (state.projects || []);
  const highCount = projects.filter(p => p.priorityBand === 'High').length;
  const crmCount = (state.crmRecords || []).length;
  const lastRun = (state.history || [])[0];
  const lastTime = lastRun ? lastRun.ranAt.replace('T', ' ').slice(0, 16) : '—';

  byId('statTotal').textContent = projects.length;
  byId('statHigh').textContent = highCount;
  byId('statCrm').textContent = crmCount;
  byId('statLastRun').textContent = lastTime;
}

function renderBoard() {
  const root = byId('crmBoard');
  root.innerHTML = '';
  const records = state.crmRecords || [];
  if (!records.length) {
    root.appendChild(el('div', 'text-muted text-sm', '暂无 CRM 记录'));
    return;
  }

  const board = el('div', 'crm-board-grid');
  const lanes = [
    { key: 'today', title: '今天要跟' },
    { key: 'waiting', title: '等待回复' },
    { key: 'paused', title: '暂缓' }
  ];
  const groups = { today: [], waiting: [], paused: [] };
  records.forEach((record) => {
    groups[crmBoardLane(record)].push(record);
  });

  lanes.forEach((lane) => {
    const laneEl = el('div', 'crm-board-lane');
    laneEl.appendChild(el('div', 'board-group-title', `${lane.title} (${groups[lane.key].length})`));
    if (!groups[lane.key].length) {
      laneEl.appendChild(el('div', 'text-muted text-sm', '暂无项目'));
      board.appendChild(laneEl);
      return;
    }

    groups[lane.key].forEach(r => {
      const item = el('div', 'board-item');
      const head = el('div', 'board-item-head');
      head.appendChild(el('span', 'board-item-name', r.project_name));
      const boardPriority = r.priority || projectPriorityForBoard(r.project_name);
      head.appendChild(el('span', 'chip ' + priorityChipClass(boardPriority), boardPriority || 'Watch'));
      item.appendChild(head);
      if (r.next_action) item.appendChild(el('div', 'board-item-detail', r.next_action));
      if (r.next_follow_up_at) item.appendChild(el('div', 'board-item-detail', '下次跟进: ' + r.next_follow_up_at));
      item.addEventListener('click', () => {
        const proj = allKnownProjects().find(p => p.name === r.project_name);
        if (proj) {
          selectedSlug = proj.slug;
          activeTab = 'crm';
          setHash(proj.slug, 'crm');
          renderProjectList();
          renderDetail();
        }
      });
      laneEl.appendChild(item);
    });
    board.appendChild(laneEl);
  });

  root.appendChild(board);
}

function renderHistory() {
  const root = byId('historyList');
  root.innerHTML = '';
  const runs = state.history || [];

  if (!runs.length) {
    root.appendChild(el('div', 'text-muted text-sm', '还没有运行记录'));
    return;
  }

  runs.slice(0, 8).forEach(run => {
    const item = el('div', 'history-item');
    const head = el('div', 'history-head');
    const statusEl = el('span', 'history-status', run.pushed ? '已推送' : '仅生成');
    statusEl.style.color = run.pushed ? 'var(--accent)' : 'var(--muted)';
    head.appendChild(statusEl);
    head.appendChild(el('span', 'history-time', run.ranAt.replace('T', ' ').slice(0, 16)));
    item.appendChild(head);
    const projNames = (run.projects || []).slice(0, 3).map(p => p.name).join(' / ') || '无项目';
    item.appendChild(el('div', 'history-projects', projNames));
    root.appendChild(item);
  });
}

function renderRules() {
  const root = byId('rulesPanel');
  root.innerHTML = '';
  const rules = state.projectRules || {};

  // Whitelist
  if (rules.whitelist && rules.whitelist.length) {
    const group = el('div', 'rule-group');
    group.appendChild(el('div', 'rule-group-label', '白名单'));
    const tags = el('div', 'rule-tags');
    rules.whitelist.forEach(name => tags.appendChild(el('span', 'chip chip-whitelist', name)));
    group.appendChild(tags);
    root.appendChild(group);
  }

  // Blacklist
  if (rules.blacklist && rules.blacklist.length) {
    const group = el('div', 'rule-group');
    group.appendChild(el('div', 'rule-group-label', '黑名单'));
    const tags = el('div', 'rule-tags');
    rules.blacklist.forEach(name => tags.appendChild(el('span', 'chip chip-blacklist', name)));
    group.appendChild(tags);
    root.appendChild(group);
  }

  // Competitors
  if (rules.competitors && rules.competitors.length) {
    const group = el('div', 'rule-group');
    group.appendChild(el('div', 'rule-group-label', '竞争对手'));
    const tags = el('div', 'rule-tags');
    rules.competitors.forEach(name => tags.appendChild(el('span', 'chip chip-competitor', name)));
    group.appendChild(tags);
    root.appendChild(group);
  }

  // Internal thresholds
  const ir = state.internalRules || {};
  if (ir.thresholds) {
    const group = el('div', 'rule-group');
    group.appendChild(el('div', 'rule-group-label', '内部门槛'));
    const t = ir.thresholds;
    const lines = [
      'TVL ≥ $' + Number(t.minTvlUsd || 0).toLocaleString(),
      '市值 ≥ $' + Number(t.minMarketCapUsd || 0).toLocaleString(),
      '24h 成交 ≥ $' + Number(t.minDailyVolumeUsd || 0).toLocaleString(),
      'DEX 流动性 ≥ $' + Number(t.minDexLiquidityUsd || 0).toLocaleString()
    ];
    lines.forEach(line => group.appendChild(el('div', 'text-sm text-muted', line)));
    root.appendChild(group);
  }

  // OSL listed
  const listed = state.oslListed || {};
  if (listed.assets && listed.assets.length) {
    const group = el('div', 'rule-group');
    group.appendChild(el('div', 'rule-group-label', 'OSL 已上架 (自动排除)'));
    const tags = el('div', 'rule-tags');
    listed.assets.forEach(a => tags.appendChild(el('span', 'chip chip-watch', a.symbol)));
    group.appendChild(tags);
    root.appendChild(group);
  }
}

// ===== TOP BAR ACTIONS =====

// Refresh
byId('refreshBtn').addEventListener('click', async () => {
  const btn = byId('refreshBtn');
  setLoading(btn, true);
  try {
    const data = await postJson('/api/refresh', {});
    state.projects = data.strictProjects || data.projects || [];
    state.strictProjects = data.strictProjects || data.projects || [];
    state.looseProjects = data.looseProjects || [];
    state.fundraisingProjects = data.fundraisingProjects || [];
    state.dexProjects = data.dexProjects || [];
    state.ecosystemProjects = data.ecosystemProjects || [];
    if (state.projects.length) {
      const preferred = state.projects.find(hasLiveSignals) || state.projects[0];
      selectedSlug = preferred.slug;
    }
    renderProjectList();
    renderDetail();
    renderSidebar();
    showToast('情报刷新成功，发现 ' + state.projects.length + ' 个项目', 'success');
  } catch (e) {
    showToast('刷新失败: ' + e.message, 'error');
  } finally {
    setLoading(btn, false);
  }
});

// Digest dropdown
const digestBtn = byId('digestBtn');
const digestMenu = byId('digestMenu');

digestBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  digestMenu.classList.toggle('open');
});
document.addEventListener('click', () => digestMenu.classList.remove('open'));

byId('digestOnly').addEventListener('click', async () => {
  digestMenu.classList.remove('open');
  setLoading(digestBtn, true);
  try {
    await postJson('/api/digest/run', { push: false });
      const histRes = await fetch(withBasePath('/api/history'));
    const histJson = await histRes.json();
    state.history = histJson.runs || [];
    renderSidebar();
    showToast('日报已生成', 'success');
  } catch (e) {
    showToast('生成失败: ' + e.message, 'error');
  } finally {
    setLoading(digestBtn, false);
  }
});

byId('digestPush').addEventListener('click', async () => {
  digestMenu.classList.remove('open');
  const confirmed = await showConfirm('推送确认', '确定要生成日报并推送到 Telegram 吗？');
  if (!confirmed) return;
  setLoading(digestBtn, true);
  try {
    const result = await postJson('/api/digest/run', { push: true });
    const histRes = await fetch(withBasePath('/api/history'));
    const histJson = await histRes.json();
    state.history = histJson.runs || [];
    renderSidebar();
    showToast(result.pushed ? '日报已推送至 Telegram' : '日报已生成（未配置 Telegram）', result.pushed ? 'success' : 'info');
  } catch (e) {
    showToast('推送失败: ' + e.message, 'error');
  } finally {
    setLoading(digestBtn, false);
  }
});

// Export CSV
byId('exportBtn').addEventListener('click', () => {
  window.open(withBasePath('/api/export/csv'), '_blank');
  showToast('CSV 导出中...', 'info');
});

// Search
let searchTimer = null;
byId('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = e.target.value.trim();
    renderProjectList();
  }, 200);
});

// Filters
byId('filterSector').addEventListener('change', (e) => { filterSector = e.target.value; renderProjectList(); });
byId('filterPriority').addEventListener('change', (e) => { filterPriority = e.target.value; renderProjectList(); });
byId('filterFreshness').addEventListener('change', (e) => { filterFreshness = e.target.value; renderProjectList(); });
byId('filterHongKong').addEventListener('change', (e) => { filterHongKong = e.target.value; renderProjectList(); });
byId('sortBy').addEventListener('change', (e) => { sortBy = e.target.value; renderProjectList(); });
document.querySelectorAll('.pool-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    activePool = btn.dataset.pool || 'bd';
    renderPoolTabs();
    renderProjectList();
  });
});

// Sidebar toggle (for ≤1280px)
const sidebarToggle = byId('sidebarToggle');
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () => {
    byId('colRight').classList.toggle('mobile-open');
  });
}

// Mobile nav
document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['colLeft', 'colCenter', 'colRight'].forEach(id => {
      byId(id).classList.remove('mobile-active');
    });
    byId(target).classList.add('mobile-active');
  });
});

// Hash change
window.addEventListener('hashchange', onHashChange);

// ===== INITIALIZE =====
(function init() {
  const h = parseHash();
  if (h.slug) selectedSlug = h.slug;
  else if (state.projects.length) selectedSlug = state.projects[0].slug;
  if (h.tab) activeTab = h.tab;

  renderProjectList();
  renderDetail();
  renderSidebar();
  renderPoolTabs();

  if (selectedSlug) setHash(selectedSlug, activeTab);
})();

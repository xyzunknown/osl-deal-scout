/* ===== OSL Deal Scout — Workbench App ===== */

const state = window.__BOOTSTRAP__ || {
  projects: [], history: [], emailTemplates: [],
  strictProjects: [], looseProjects: [], crmRecords: [], crmFields: [], projectRules: {},
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

function hasLiveSignals(project) {
  const live = project && project.liveSignals;
  return Boolean(live && (live.coingecko || live.defillama || live.website || live.rootdata));
}

function currentProject() {
  const allProjects = [...(state.projects || []), ...(state.looseProjects || [])];
  if (!selectedSlug && allProjects.length) {
    const preferred = allProjects.find(hasLiveSignals) || allProjects[0];
    selectedSlug = preferred.slug;
  }
  return allProjects.find(p => p.slug === selectedSlug) || null;
}

function crmForProject(name) {
  return (state.crmRecords || []).find(r => r.project_name === name) || null;
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
  let list = state.projects || [];

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

// ===== RENDER: PROJECT LIST (left column) =====
function renderProjectList() {
  const root = byId('projectList');
  root.innerHTML = '';
  const list = filteredProjects();

  byId('listCount').textContent = list.length + ' 个项目';

  if (!list.length) {
    root.appendChild(el('div', 'empty-state', searchQuery || filterSector || filterPriority || filterFreshness || filterHongKong ? '没有匹配的项目' : '还没有数据，先点"刷新情报"'));
    return;
  }

  list.forEach(p => {
    const row = el('div', 'project-row' + (p.slug === selectedSlug ? ' active' : ''));
    row.dataset.slug = p.slug;

    const info = el('div', 'project-row-info');
    info.appendChild(el('div', 'project-row-name', p.name));
    const meta = el('div', 'project-row-meta');
    meta.appendChild(el('span', 'chip chip-sector', p.sector));
    meta.appendChild(el('span', 'chip ' + priorityChipClass(p.priorityBand), p.priorityBand));
    if (p.freshness) meta.appendChild(el('span', 'chip ' + freshnessChipClass(p.freshness), freshnessLabel(p.freshness)));
    if (p.hongKongFit) meta.appendChild(el('span', 'chip chip-hongkong', '香港'));
    if (hasLiveSignals(p)) meta.appendChild(el('span', 'chip chip-source', '已补数'));
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

    root.appendChild(row);
  });
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

  // Contact card
  const contactCard = el('div', 'info-card');
  contactCard.appendChild(el('div', 'info-card-title', '联系入口'));
  const contactItems = [
    p.website ? { label: '官网', value: p.website, href: p.website } : null,
    p.twitter ? { label: '官推', value: p.twitter.replace(/^https?:\/\//, ''), href: p.twitter } : null,
    p.contact ? { label: p.contact.label || '联系方式', value: p.contact.value, href: p.contact.value.startsWith('http') ? p.contact.value : null } : null,
    p.secondaryContact ? { label: p.secondaryContact.label || '备用联系', value: p.secondaryContact.value, href: p.secondaryContact.value.startsWith('http') ? p.secondaryContact.value : null } : null
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
  if (!contactItems.length) contactCard.appendChild(el('div', 'text-muted text-sm', '暂无联系信息'));
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
  const form = el('div', 'crm-form');

  fields.forEach(field => {
    const group = el('div', 'form-group');
    group.appendChild(el('label', 'form-label', field.label));

    let input;
    const val = field.key === 'project_name' ? p.name : (record[field.key] || '');

    if (field.type === 'long_text') {
      input = el('textarea', 'form-input');
      input.value = val;
      input.rows = 3;
    } else if (field.type === 'single_select') {
      input = el('select', 'form-input');
      const emptyOpt = el('option', '', '— 选择 —');
      emptyOpt.value = '';
      input.appendChild(emptyOpt);
      // Extract options from description
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
        opt.value = val; opt.selected = true;
        input.appendChild(opt);
      }
    } else if (field.type === 'date') {
      input = el('input', 'form-input');
      input.type = 'date';
      input.value = val;
    } else if (field.type === 'number') {
      input = el('input', 'form-input');
      input.type = 'number';
      input.value = val;
    } else if (field.type === 'url') {
      input = el('input', 'form-input');
      input.type = 'url';
      input.value = val;
      input.placeholder = 'https://...';
    } else {
      input = el('input', 'form-input');
      input.type = 'text';
      input.value = val;
    }

    input.dataset.field = field.key;
    if (field.key === 'project_name') input.readOnly = true;
    if (field.description) group.appendChild(el('span', 'form-hint', field.description));
    group.appendChild(input);
    form.appendChild(group);
  });

  // If no crm-fields.json, show basic fields
  if (!fields.length) {
    const basicFields = ['project_name', 'status', 'priority', 'owner', 'warm_intro_path', 'next_action', 'decision_maker'];
    basicFields.forEach(key => {
      const group = el('div', 'form-group');
      group.appendChild(el('label', 'form-label', key.replace(/_/g, ' ')));
      const input = el('input', 'form-input');
      input.type = 'text';
      input.value = key === 'project_name' ? p.name : (record[key] || '');
      input.dataset.field = key;
      if (key === 'project_name') input.readOnly = true;
      group.appendChild(input);
      form.appendChild(group);
    });
  }

  const actions = el('div', 'crm-actions');
  const saveBtn = el('button', 'btn btn-primary', '保存');
  saveBtn.addEventListener('click', async () => {
    setLoading(saveBtn, true);
    try {
      const data = {};
      form.querySelectorAll('[data-field]').forEach(inp => {
        data[inp.dataset.field] = inp.value;
      });
      const encodedName = encodeURIComponent(p.name);
      const result = await putJson('/api/crm-records/' + encodedName, data);
      // Update local state
      const idx = (state.crmRecords || []).findIndex(r => r.project_name === p.name);
      if (idx >= 0) state.crmRecords[idx] = data;
      else state.crmRecords.push(data);
      showToast('CRM 记录已保存', 'success');
      renderSidebar();
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
  renderWatchRadar();
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

function renderWatchRadar() {
  const root = byId('watchRadar');
  if (!root) return;
  root.innerHTML = '';
  const radar = state.looseProjects || [];
  if (!radar.length) {
    root.appendChild(el('div', 'text-muted text-sm', '暂无 Watch Radar'));
    return;
  }

  radar.slice(0, 8).forEach(project => {
    const item = el('div', 'board-item');
    const head = el('div', 'board-item-head');
    head.appendChild(el('span', 'board-item-name', project.name));
    head.appendChild(el('span', 'chip ' + priorityChipClass(project.priorityBand), project.priorityBand));
    item.appendChild(head);
    item.appendChild(el('div', 'board-item-detail', `${project.sector || 'General'} / ${project.maturityPath === 'early' ? 'Early' : 'Mature'} / ${project.discoveryPath || 'loose'}`));
    item.addEventListener('click', () => {
      selectedSlug = project.slug;
      activeTab = 'overview';
      setHash(project.slug, 'overview');
      renderProjectList();
      renderDetail();
    });
    root.appendChild(item);
  });
}

function renderBoard() {
  const root = byId('crmBoard');
  root.innerHTML = '';
  const records = state.crmRecords || [];
  if (!records.length) {
    root.appendChild(el('div', 'text-muted text-sm', '暂无 CRM 记录'));
    return;
  }

  // Group by status
  const groups = {};
  records.forEach(r => {
    const status = r.status || 'New Lead';
    if (!groups[status]) groups[status] = [];
    groups[status].push(r);
  });

  Object.keys(groups).forEach(status => {
    root.appendChild(el('div', 'board-group-title', status + ' (' + groups[status].length + ')'));
    groups[status].forEach(r => {
      const item = el('div', 'board-item');
      const head = el('div', 'board-item-head');
      head.appendChild(el('span', 'board-item-name', r.project_name));
      head.appendChild(el('span', 'chip ' + priorityChipClass(r.priority), r.priority || 'Watch'));
      item.appendChild(head);
      if (r.next_action) item.appendChild(el('div', 'board-item-detail', r.next_action));
      item.addEventListener('click', () => {
        const proj = state.projects.find(p => p.name === r.project_name);
        if (proj) {
          selectedSlug = proj.slug;
          activeTab = 'crm';
          setHash(proj.slug, 'crm');
          renderProjectList();
          renderDetail();
        }
      });
      root.appendChild(item);
    });
  });
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

  if (selectedSlug) setHash(selectedSlug, activeTab);
})();

const boot = window.__TOKEN_CONFIG_BOOTSTRAP__ || { tabs: [] };
const BASE_PATH = String(window.__BASE_PATH__ || '').replace(/\/+$/, '');

const state = {
  keyword: '',
  activeTab: 'token',
  searchTimer: null,
  searchResults: [],
  selectedCoin: null,
  tokenConfig: null,
  chainNames: [],
  loading: false,
  error: ''
};

function byId(id) { return document.getElementById(id); }
function withBasePath(url) {
  if (!url) return BASE_PATH || '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${BASE_PATH}${url.startsWith('/') ? url : `/${url}`}`;
}

async function fetchJson(url) {
  const res = await fetch(withBasePath(url));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function escHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value || '');
  return div.innerHTML;
}

function shortenAddress(address) {
  const value = String(address || '').trim();
  if (!value) return '—';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function tabDefinitions() {
  return boot.tabs && boot.tabs.length ? boot.tabs : [
    { key: 'token', label: '币种配置表', ready: true },
    { key: 'chain', label: '币链配置表', ready: false },
    { key: 'pair', label: '币对配置表', ready: false },
    { key: 'contract', label: '合约配置表', ready: false }
  ];
}

function renderTabs() {
  const root = byId('tokenConfigTabs');
  root.innerHTML = '';
  tabDefinitions().forEach((tab) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab-btn' + (state.activeTab === tab.key ? ' active' : '');
    btn.textContent = tab.label;
    btn.disabled = !state.selectedCoin && tab.key !== 'token';
    btn.addEventListener('click', () => {
      state.activeTab = tab.key;
      renderTabs();
      renderPanels();
      renderCopyButton();
    });
    root.appendChild(btn);
  });
}

function renderStatus() {
  byId('tokenConfigStatus').textContent = state.selectedCoin
    ? `已选币种：${state.selectedCoin.fullName || state.selectedCoin.name} (${state.selectedCoin.symbol || ''})`
    : '先搜索一个币种开始。';
  const errorEl = byId('tokenConfigError');
  errorEl.textContent = state.error || '';
  errorEl.classList.toggle('hidden', !state.error);
  byId('tokenConfigLoading').classList.toggle('hidden', !state.loading);
  byId('tokenConfigEmpty').classList.toggle('hidden', Boolean(state.selectedCoin));
  const meta = byId('tokenSelectionMeta');
  if (!state.selectedCoin) {
    meta.textContent = '选择下拉结果后生成配置表';
    return;
  }
  const rank = state.selectedCoin.rank ? `#${state.selectedCoin.rank}` : '未排名';
  const addr = state.selectedCoin.contractAddress || '';
  meta.textContent = `${state.selectedCoin.fullName || state.selectedCoin.name} / ${state.selectedCoin.symbol || ''} / ${rank}${addr ? ` / ${shortenAddress(addr)}` : ''}`;
}

function rowCopyText() {
  if (!state.tokenConfig) return '';
  const row = state.tokenConfig;
  const lines = [
    row.tokenName,
    row.tokenFullName,
    row.tokenAttribute,
    row.displayPrecision,
    row.usagePrecision,
    row.tokenSymbol,
    row.tokenPrice
  ];
  const remark = [row.remark, row.verificationNote].filter(Boolean).join(' ');
  return remark ? `${lines.join('\t')}\n${remark}` : lines.join('\t');
}

function renderRemarkHtml(row) {
  const chains = Array.isArray(row.chainNames) ? row.chainNames.filter(Boolean) : [];
  const chainText = chains.join('/');
  const sourceChain = row.precisionSourceChain || '';
  const sourceUrl = row.precisionSourceUrl || '';
  if (!chainText || !sourceChain) return '';
  const sourceLabel = sourceUrl
    ? `<a href="${escHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escHtml(sourceChain)}</a>`
    : escHtml(sourceChain);
  return `该币种分别有${escHtml(chainText)}几条链，使用精度取自${sourceLabel}链。`;
}

function renderPanels() {
  const root = byId('tokenConfigPanels');
  root.innerHTML = '';

  const panel = document.createElement('section');
  panel.className = 'token-config-panel token-config-panel-' + state.activeTab;

  if (state.activeTab === 'token') {
    if (!state.tokenConfig) {
      panel.innerHTML = '<div class="token-config-panel-empty">搜索并选择币种后，这里会生成币种配置表。</div>';
    } else {
      const row = state.tokenConfig;
      panel.innerHTML = `
        <div class="token-config-panel-head">
          <div>
            <div class="token-config-panel-title">币种配置表</div>
            <div class="token-config-panel-subtitle">数据源：CoinMarketCap；使用精度取多链合约中的最小 decimals。</div>
          </div>
          <button id="copyVisibleTabBtn" class="btn btn-sm" type="button">复制当前表</button>
        </div>
        <div class="token-config-table-wrap">
          <table class="token-config-table">
            <thead>
              <tr>
                <th>币种名称</th>
                <th>币种全称</th>
                <th>币种属性</th>
                <th>显示精度</th>
                <th>使用精度</th>
                <th>币种符号</th>
                <th>币种价格</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div class="token-name-cell">
                    <button class="copy-row-btn" type="button" title="复制这一行" aria-label="复制这一行">
                      <span class="copy-row-btn-icon">⧉</span>
                    </button>
                    <span>${escHtml(row.tokenName)}</span>
                  </div>
                </td>
                <td>${escHtml(row.tokenFullName)}</td>
                <td>${escHtml(row.tokenAttribute)}</td>
                <td>${escHtml(row.displayPrecision)}</td>
                <td>${escHtml(row.usagePrecision)}</td>
                <td>${escHtml(row.tokenSymbol)}</td>
                <td>${escHtml(row.tokenPrice)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="token-config-remark">${renderRemarkHtml(row)}</div>
        ${row.verificationNote ? `<div class="token-config-verify-note">${escHtml(row.verificationNote)}</div>` : ''}
      `;
    }
  } else if (state.activeTab === 'chain') {
    panel.innerHTML = `
      <div class="token-config-panel-head">
        <div class="token-config-panel-title">币链配置表</div>
        <button id="copyVisibleTabBtn" class="btn btn-sm" type="button" disabled>复制当前表</button>
      </div>
      <div class="token-config-panel-note">这张表会和币种配置表分开维护，适合放更长的链路参数。你把字段定义给我后，我按独立布局接进去。</div>
    `;
  } else if (state.activeTab === 'pair') {
    panel.innerHTML = `
      <div class="token-config-panel-head">
        <div class="token-config-panel-title">币对配置表</div>
        <button id="copyVisibleTabBtn" class="btn btn-sm" type="button" disabled>复制当前表</button>
      </div>
      <div class="token-config-panel-note">这张表会预留更密集的交易对字段，不和币种基础信息混排。</div>
    `;
  } else {
    panel.innerHTML = `
      <div class="token-config-panel-head">
        <div class="token-config-panel-title">合约配置表</div>
        <button id="copyVisibleTabBtn" class="btn btn-sm" type="button" disabled>复制当前表</button>
      </div>
      <div class="token-config-panel-note">这张表会按合约维度展示，支持更长地址、链名和补充说明。</div>
    `;
  }

  root.appendChild(panel);
  const copyBtn = byId('copyVisibleTabBtn');
  if (copyBtn) {
    copyBtn.disabled = !buildCopyText();
    copyBtn.addEventListener('click', async () => {
      try {
        await copyCurrentTab();
      } catch (error) {
        state.error = '复制失败：' + error.message;
        renderStatus();
      }
    });
  }
  const rowCopyBtn = root.querySelector('.copy-row-btn');
  if (rowCopyBtn) {
    rowCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rowCopyText());
        byId('tokenConfigStatus').textContent = '该行信息已复制';
      } catch (error) {
        state.error = '复制失败：' + error.message;
        renderStatus();
      }
    });
  }
}

function buildCopyText() {
  if (state.activeTab === 'token' && state.tokenConfig) {
    const row = state.tokenConfig;
    const headers = ['币种名称', '币种全称', '币种属性', '显示精度', '使用精度', '币种符号', '币种价格'];
    const values = [row.tokenName, row.tokenFullName, row.tokenAttribute, row.displayPrecision, row.usagePrecision, row.tokenSymbol, row.tokenPrice];
    return `${headers.join('\t')}\n${values.join('\t')}`;
  }
  if (state.activeTab === 'chain') return '币链配置表字段待补充';
  if (state.activeTab === 'pair') return '币对配置表字段待补充';
  if (state.activeTab === 'contract') return '合约配置表字段待补充';
  return '';
}

function renderCopyButton() {
  const btn = byId('copyVisibleTabBtn');
  if (btn) btn.disabled = !buildCopyText();
}

async function copyCurrentTab() {
  const text = buildCopyText();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  byId('tokenConfigStatus').textContent = '当前表格内容已复制';
}

function renderDropdown() {
  const root = byId('tokenSearchDropdown');
  root.innerHTML = '';
  const show = state.searchResults.length > 0 && state.keyword.trim().length > 0;
  root.classList.toggle('hidden', !show);
  if (!show) return;

  state.searchResults.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'token-search-item';
    const rank = item.rank ? `#${item.rank}` : '未排名';
    const address = item.contractAddress ? shortenAddress(item.contractAddress) : '暂无合约';
    const extra = item.chainCount > 1 ? ` · ${item.chainCount} 条链` : '';
    button.innerHTML = `
      <div class="token-search-item-head">
        <span class="token-search-item-symbol">${escHtml(item.symbol || '')}</span>
        <span class="token-search-item-rank">${escHtml(rank)}</span>
      </div>
      <div class="token-search-item-name">${escHtml(item.fullName || item.name || '')}</div>
      <div class="token-search-item-meta">${escHtml(address + extra)}</div>
    `;
    button.addEventListener('click', () => selectCoin(item));
    root.appendChild(button);
  });
}

async function searchCoins() {
  const keyword = state.keyword.trim();
  if (!keyword) {
    state.searchResults = [];
    renderDropdown();
    return;
  }
  try {
    const data = await fetchJson(`/api/token-config/search?q=${encodeURIComponent(keyword)}`);
    state.searchResults = data.results || [];
    renderDropdown();
  } catch (error) {
    state.error = '搜索失败：' + error.message;
    renderStatus();
  }
}

async function selectCoin(item) {
  state.selectedCoin = item;
  state.keyword = item.fullName || item.name || '';
  byId('tokenKeyword').value = state.keyword;
  state.searchResults = [];
  state.loading = true;
  state.error = '';
  renderDropdown();
  renderStatus();
  try {
    const data = await fetchJson(`/api/token-config/coin/${encodeURIComponent(item.slug)}`);
    state.tokenConfig = data.tokenConfig || null;
    state.chainNames = data.chainNames || [];
    state.activeTab = 'token';
  } catch (error) {
    state.error = '抓取失败：' + error.message;
    state.tokenConfig = null;
    state.chainNames = [];
  } finally {
    state.loading = false;
    renderTabs();
    renderPanels();
    renderStatus();
    renderCopyButton();
  }
}

function bindEvents() {
  const input = byId('tokenKeyword');
  input.addEventListener('input', (event) => {
    state.keyword = event.target.value;
    state.error = '';
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      searchCoins();
    }, 220);
  });

  document.addEventListener('click', (event) => {
    const wrap = document.querySelector('.token-config-searchbox');
    if (!wrap.contains(event.target)) {
      state.searchResults = [];
      renderDropdown();
    }
  });

  const backBtn = byId('backToDashboardBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = backBtn.dataset.fallbackHref || withBasePath('/');
    });
  }
}

(function init() {
  renderTabs();
  renderPanels();
  renderStatus();
  renderCopyButton();
  bindEvents();
})();

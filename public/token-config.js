const boot = window.__TOKEN_CONFIG_BOOTSTRAP__ || { tabs: [] };
const BASE_PATH = String(window.__BASE_PATH__ || '').replace(/\/+$/, '');

const state = {
  keyword: '',
  activeTab: 'token',
  searchTimer: null,
  searchResults: [],
  selectedCoin: null,
  tokenConfig: null,
  pairConfig: null,
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
  meta.textContent = `${state.selectedCoin.fullName || state.selectedCoin.name} / ${state.selectedCoin.symbol || ''} / ${rank}${addr ? ` / ${addr}` : ''}`;
}

function rowCopyText() {
  if (!state.tokenConfig) return '';
  const row = state.tokenConfig;
  return [
    row.tokenName,
    row.tokenFullName,
    row.tokenAttribute,
    row.displayPrecision,
    row.usagePrecision,
    row.tokenSymbol,
    row.tokenPrice
  ].join('\t');
}

function pairCopyText() {
  if (!state.pairConfig) return '';
  const row = state.pairConfig;
  return [
    row.pair,
    row.minTradeQuantity,
    row.maxTradeQuantity,
    row.minOrderAmount,
    row.maxOrderAmount,
    row.pricePrecision,
    row.quantityPrecision,
    row.currentPrice
  ].join('\t');
}

function renderRemarkHtml(row) {
  const chains = Array.isArray(row.remarkChains) ? row.remarkChains.filter((item) => item && item.name) : [];
  const sourceChain = row.precisionSourceChain || '';
  const sourceUrl = row.precisionSourceUrl || '';
  if (!chains.length || !sourceChain) return '';
  const chainText = chains.map((item) => {
    const label = escHtml(item.name);
    if (!item.url) return label;
    return `<a href="${escHtml(item.url)}" target="_blank" rel="noreferrer">${label}</a>`;
  }).join('/');
  const sourceLabel = sourceUrl
    ? `<a href="${escHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escHtml(sourceChain)}</a>`
    : escHtml(sourceChain);
  return `该币种分别有${chainText}几条链，使用精度取自${sourceLabel}链。`;
}

function renderPairRemarkHtml(row) {
  if (!row || !row.precisionSourceExchange) return '';
  const label = escHtml(row.precisionSourceExchange);
  const source = row.precisionSourceUrl
    ? `<a href="${escHtml(row.precisionSourceUrl)}" target="_blank" rel="noreferrer">${label}</a>`
    : label;
  if (row.precisionSourceResolved === false) {
    return `暂未从${source}交易所接口拿到价格精度和数量精度。`;
  }
  return `该币种价格精度和数量精度取自${source}交易所。`;
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
          <table class="token-config-table token-config-table-token">
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
                <td class="token-symbol-cell">
                  <button class="copy-row-btn" type="button" title="复制这一行" aria-label="复制这一行">
                    <span class="copy-row-btn-icon">⧉</span>
                  </button>
                  <span class="token-name-text">${escHtml(row.tokenName)}</span>
                </td>
                <td>
                  ${escHtml(row.tokenFullName)}
                </td>
                <td class="token-cell-center">${escHtml(row.tokenAttribute)}</td>
                <td class="token-cell-center">${escHtml(row.displayPrecision)}</td>
                <td class="token-cell-center">${escHtml(row.usagePrecision)}</td>
                <td class="token-cell-center">${escHtml(row.tokenSymbol)}</td>
                <td class="token-cell-center">${escHtml(row.tokenPrice)}</td>
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
    if (!state.pairConfig) {
      panel.innerHTML = '<div class="token-config-panel-empty">搜索并选择币种后，这里会生成币对配置表。</div>';
    } else {
      const row = state.pairConfig;
      panel.innerHTML = `
        <div class="token-config-panel-head">
          <div>
            <div class="token-config-panel-title">币对配置表</div>
            <div class="token-config-panel-subtitle">默认展示所选币种的 USDT 现货交易对。</div>
          </div>
          <button id="copyVisibleTabBtn" class="btn btn-sm" type="button">复制当前表</button>
        </div>
        <div class="token-config-table-wrap">
          <table class="token-config-table token-config-table-pair">
            <thead>
              <tr>
                <th>币对</th>
                <th>最小交易数量</th>
                <th>最大交易数量</th>
                <th>最小下单金额</th>
                <th>最大下单金额</th>
                <th>价格精度</th>
                <th>数量精度</th>
                <th>当前价</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="token-cell-center">${escHtml(row.pair)}</td>
                <td class="token-cell-center">${escHtml(row.minTradeQuantity)}</td>
                <td class="token-cell-center">${escHtml(row.maxTradeQuantity)}</td>
                <td class="token-cell-center">${escHtml(row.minOrderAmount)}</td>
                <td class="token-cell-center">${escHtml(row.maxOrderAmount)}</td>
                <td class="token-cell-center">${escHtml(row.pricePrecision)}</td>
                <td class="token-cell-center">${escHtml(row.quantityPrecision)}</td>
                <td class="token-cell-center">${escHtml(row.currentPrice)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="token-config-remark">${renderPairRemarkHtml(row)}</div>
      `;
    }
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
  if (state.activeTab === 'pair' && state.pairConfig) {
    const headers = ['币对', '最小交易数量', '最大交易数量', '最小下单金额', '最大下单金额', '价格精度', '数量精度', '当前价'];
    return `${headers.join('\t')}\n${pairCopyText()}`;
  }
  if (state.activeTab === 'chain') return '币链配置表字段待补充';
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
    state.pairConfig = data.pairConfig || null;
    state.chainNames = data.chainNames || [];
    state.activeTab = 'token';
  } catch (error) {
    state.error = '抓取失败：' + error.message;
    state.tokenConfig = null;
    state.pairConfig = null;
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

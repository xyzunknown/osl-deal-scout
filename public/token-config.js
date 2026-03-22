const boot = window.__TOKEN_CONFIG_BOOTSTRAP__ || { tabs: [] };
const BASE_PATH = String(window.__BASE_PATH__ || '').replace(/\/+$/, '');

const state = {
  keyword: '',
  activeTab: 'token',
  searchTimer: null,
  searchResults: [],
  selectedCoin: null,
  tokenConfig: null,
  chainConfig: null,
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

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortenAddress(address) {
  const value = String(address || '').trim();
  if (!value) return '—';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function middleEllipsis(value, options = {}) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const head = Math.max(2, Number(options.head || 8));
  const tail = Math.max(2, Number(options.tail || 6));
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function smartUrlDisplay(url) {
  const text = String(url || '').trim();
  if (!text) return '—';
  try {
    const parsed = new URL(text);
    const host = parsed.host || parsed.hostname || '';
    const path = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
    if ((host + path).length <= 44) return `${host}${path}`;
    return `${host}${middleEllipsis(path || '/', { head: 10, tail: 10 })}`;
  } catch {
    return middleEllipsis(text, { head: 18, tail: 10 });
  }
}

function ensureToastContainer() {
  let container = byId('toastContainer');
  if (container) return container;
  container = el('div');
  container.id = 'toastContainer';
  container.className = 'toast-container';
  document.body.appendChild(container);
  return container;
}

function showToast(msg, type = 'info') {
  const container = ensureToastContainer();
  const toast = el('div', `toast toast-${type}`, msg);
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
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
  return (state.pairConfig.rows || []).map((row) => [
    row.pair,
    row.minTradeQuantity,
    row.maxTradeQuantity,
    row.minOrderAmount,
    row.maxOrderAmount,
    row.pricePrecision,
    row.quantityPrecision,
    row.currentPrice
  ].join('\t')).join('\n');
}

function chainCopyText() {
  if (!state.chainConfig) return '';
  return (state.chainConfig.rows || []).map((row) => [
    row.tokenName,
    row.networkFullName,
    row.networkShortName,
    row.browserUrl,
    row.contractAddress,
    row.cmcUrl
  ].join('\t')).join('\n');
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
  return row && row.remarkHtml ? row.remarkHtml : '';
}

function renderChainRemarkHtml(config) {
  return config && config.remark ? escHtml(config.remark) : '';
}

function renderEllipsisSpan(displayText, fullText, extraClass = '') {
  const safeDisplay = escHtml(displayText || '—');
  const safeFull = escHtml(fullText || '');
  const titleAttr = safeFull ? ` title="${safeFull}"` : '';
  const cls = `token-ellipsis${extraClass ? ` ${extraClass}` : ''}`;
  return `<span class="${cls}"${titleAttr}>${safeDisplay}</span>`;
}

function renderTruncatedLink(url, mode) {
  const full = String(url || '').trim();
  if (!full) return '<span class="token-empty">—</span>';
  const display = mode === 'address' ? middleEllipsis(full, { head: 8, tail: 6 }) : smartUrlDisplay(full);
  return `<a class="token-link token-ellipsis" href="${escHtml(full)}" target="_blank" rel="noreferrer" title="${escHtml(full)}">${escHtml(display)}</a>`;
}

function renderCopyableAddress(address) {
  const full = String(address || '').trim();
  if (!full) return '<span class="token-empty">—</span>';
  const display = middleEllipsis(full, { head: 8, tail: 6 });
  return `<button class="token-copy-surface token-ellipsis token-code-text" type="button" data-copy-value="${escHtml(full)}" title="点击复制">${escHtml(display)}</button>`;
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
            <colgroup>
              <col class="token-col-token-name" />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
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
    if (!state.chainConfig) {
      panel.innerHTML = '<div class="token-config-panel-empty">搜索并选择币种后，这里会生成币链配置表。</div>';
    } else {
      const rows = Array.isArray(state.chainConfig.rows) ? state.chainConfig.rows : [];
      panel.innerHTML = `
        <div class="token-config-panel-head">
          <div>
            <div class="token-config-panel-title">币链配置表</div>
            <div class="token-config-panel-subtitle">按币种逐链展示网络名称、浏览器、合约地址和对应 CMC 地址。</div>
          </div>
          <button id="copyVisibleTabBtn" class="btn btn-sm" type="button">复制当前表</button>
        </div>
        <div class="token-config-table-wrap">
          <table class="token-config-table token-config-table-chain">
            <colgroup>
              <col class="token-col-symbol" />
              <col class="token-col-network-full" />
              <col class="token-col-network-short" />
              <col class="token-col-browser-url" />
              <col class="token-col-contract-address" />
              <col class="token-col-cmc-url" />
            </colgroup>
            <thead>
              <tr>
                <th>币种名称</th>
                <th>网络全称</th>
                <th>网络简称</th>
                <th>币浏览器URL</th>
                <th>合约地址</th>
                <th>CMC地址</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row, index) => `
                <tr>
                  <td class="token-symbol-cell">
                    <button class="copy-row-btn chain-copy-btn" type="button" data-row-index="${index}" title="复制这一行" aria-label="复制这一行">
                      <span class="copy-row-btn-icon">⧉</span>
                    </button>
                    <span class="token-name-text" title="${escHtml(row.tokenName || '')}">${escHtml(row.tokenName || '—')}</span>
                  </td>
                  <td>${renderEllipsisSpan(row.networkFullName || '—', row.networkFullName || '')}</td>
                  <td class="token-cell-center">${renderEllipsisSpan(row.networkShortName || '—', row.networkShortName || '')}</td>
                  <td class="token-cell-left">${renderTruncatedLink(row.browserUrl, 'url')}</td>
                  <td class="token-cell-left">${renderCopyableAddress(row.contractAddress)}</td>
                  <td class="token-cell-left">${renderTruncatedLink(row.cmcUrl, 'url')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="token-config-remark">${renderChainRemarkHtml(state.chainConfig)}</div>
      `;
    }
  } else if (state.activeTab === 'pair') {
    if (!state.pairConfig) {
      panel.innerHTML = '<div class="token-config-panel-empty">搜索并选择币种后，这里会生成币对配置表。</div>';
    } else {
      const rows = Array.isArray(state.pairConfig.rows) ? state.pairConfig.rows : [];
      panel.innerHTML = `
        <div class="token-config-panel-head">
          <div>
            <div class="token-config-panel-title">币对配置表</div>
            <div class="token-config-panel-subtitle">默认展示所选币种的 USDT 现货交易对；若 Indodax 存在 IDR 交易对，则追加显示。</div>
          </div>
          <button id="copyVisibleTabBtn" class="btn btn-sm" type="button">复制当前表</button>
        </div>
        <div class="token-config-table-wrap">
          <table class="token-config-table token-config-table-pair">
            <colgroup>
              <col class="token-col-pair-name" />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
              <col />
            </colgroup>
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
              ${rows.map((row, index) => `
                <tr>
                  <td class="token-symbol-cell">
                    <button class="copy-row-btn pair-copy-btn" type="button" data-row-index="${index}" title="复制这一行" aria-label="复制这一行">
                      <span class="copy-row-btn-icon">⧉</span>
                    </button>
                    <span class="token-name-text">${escHtml(row.pair)}</span>
                  </td>
                  <td class="token-cell-center">${escHtml(row.minTradeQuantity)}</td>
                  <td class="token-cell-center">${escHtml(row.maxTradeQuantity)}</td>
                  <td class="token-cell-center">${escHtml(row.minOrderAmount)}</td>
                  <td class="token-cell-center">${escHtml(row.maxOrderAmount)}</td>
                  <td class="token-cell-center">${escHtml(row.pricePrecision)}</td>
                  <td class="token-cell-center">${escHtml(row.quantityPrecision)}</td>
                  <td class="token-cell-center">${escHtml(row.currentPrice)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="token-config-remark">${renderPairRemarkHtml(state.pairConfig)}</div>
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
  root.querySelectorAll('.copy-row-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        if (state.activeTab === 'pair') {
          const index = Number(button.dataset.rowIndex || -1);
          const row = state.pairConfig && Array.isArray(state.pairConfig.rows) ? state.pairConfig.rows[index] : null;
          if (!row) return;
          await navigator.clipboard.writeText(row.rowCopyText || '');
        } else if (state.activeTab === 'chain') {
          const index = Number(button.dataset.rowIndex || -1);
          const row = state.chainConfig && Array.isArray(state.chainConfig.rows) ? state.chainConfig.rows[index] : null;
          if (!row) return;
          await navigator.clipboard.writeText(row.rowCopyText || '');
        } else {
          await navigator.clipboard.writeText(rowCopyText());
        }
        byId('tokenConfigStatus').textContent = '该行信息已复制';
        showToast('该行信息已复制', 'success');
      } catch (error) {
        state.error = '复制失败：' + error.message;
        showToast('复制失败：' + error.message, 'error');
        renderStatus();
      }
    });
  });

  root.querySelectorAll('.token-copy-surface').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        const text = String(button.dataset.copyValue || '').trim();
        if (!text) return;
        await navigator.clipboard.writeText(text);
        byId('tokenConfigStatus').textContent = '已复制完整地址';
        showToast('已复制完整地址', 'success');
      } catch (error) {
        state.error = '复制失败：' + error.message;
        showToast('复制失败：' + error.message, 'error');
        renderStatus();
      }
    });
  });
}

function buildCopyText() {
  if (state.activeTab === 'token' && state.tokenConfig) {
    const row = state.tokenConfig;
    const headers = ['币种名称', '币种全称', '币种属性', '显示精度', '使用精度', '币种符号', '币种价格'];
    const values = [row.tokenName, row.tokenFullName, row.tokenAttribute, row.displayPrecision, row.usagePrecision, row.tokenSymbol, row.tokenPrice];
    return `${headers.join('\t')}\n${values.join('\t')}`;
  }
  if (state.activeTab === 'chain' && state.chainConfig) {
    const headers = ['币种名称', '网络全称', '网络简称', '币浏览器URL', '合约地址', 'CMC地址'];
    return `${headers.join('\t')}\n${chainCopyText()}`;
  }
  if (state.activeTab === 'pair' && state.pairConfig) {
    const headers = ['币对', '最小交易数量', '最大交易数量', '最小下单金额', '最大下单金额', '价格精度', '数量精度', '当前价'];
    return `${headers.join('\t')}\n${pairCopyText()}`;
  }
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
  showToast('当前表格内容已复制', 'success');
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
    state.chainConfig = data.chainConfig || null;
    state.pairConfig = data.pairConfig || null;
    state.chainNames = data.chainNames || [];
    state.activeTab = 'token';
  } catch (error) {
    state.error = '抓取失败：' + error.message;
    state.tokenConfig = null;
    state.chainConfig = null;
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

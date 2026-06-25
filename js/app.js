// app.js — 進入點：載入資料、事件綁定、render。
import { store } from './store.js';
import { fetchProducts, parseHtml } from './taifex.js';
import { computePosition, computePortfolio, computeLive } from './calc.js';
import { fetchLastPrice } from './fugle.js';

let MULTI = { index: {}, stockLotDefault: 2000, stockLotSmall: 100, etfUnitsDefault: 10000, etfUnitsSmall: 1000 };
let tab = 'all';
const $ = (id) => document.getElementById(id);

// ---------- 格式化 ----------
const fmtNTD = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtLev = (n) => (n == null ? '—' : `${n.toFixed(2)}x`);
const fmtPct = (n) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- meta / 狀態 ----------
function renderMeta() {
  const meta = store.getMeta();
  const el = $('meta');
  if (!meta.lastRefreshed) {
    el.textContent = '尚未更新，請按「更新保證金」';
    el.className = 'meta stale';
    return;
  }
  const d = new Date(meta.lastRefreshed);
  const days = (Date.now() - d.getTime()) / 86400000;
  const dd = meta.dataDate ? `（資料日 ${meta.dataDate}）` : '';
  el.textContent = `保證金更新於 ${d.toLocaleString('zh-TW')} ${dd}`;
  el.className = days > 90 ? 'meta stale' : 'meta';
  if (days > 90) el.textContent += '　⚠ 已逾 90 天，保證金每季調整，建議重新更新';
}

// ---------- 商品列表 ----------
function filteredProducts() {
  const q = $('search').value.trim().toLowerCase();
  return store.getProducts().filter((p) => {
    if (tab !== 'all' && p.type !== tab) return false;
    if (!q) return true;
    return [p.code, p.name, p.underlying].some((s) => String(s).toLowerCase().includes(q));
  });
}

function productListLeverage(p) {
  // percent 制：1/原始比例（免價格）。amount 制：需成本 → 列表顯示「—」。
  if (p.marginModel === 'percent') return p.initial > 0 ? 1 / p.initial : null;
  return null;
}

function renderProducts() {
  const rows = filteredProducts();
  const tb = $('prodBody');
  tb.innerHTML =
    rows
      .slice(0, 500)
      .map((p) => {
        const im = p.marginModel === 'percent' ? fmtPct(p.initial) : fmtNTD(p.initial);
        const mm = p.marginModel === 'percent' ? fmtPct(p.maintenance) : fmtNTD(p.maintenance);
        const lev = productListLeverage(p);
        const levTxt = lev != null ? fmtLev(lev) : '<span class="dim">需成本</span>';
        return `<tr>
          <td class="lcol num">${esc(p.code)}</td>
          <td class="lcol">${esc(p.name)}<div class="dim" style="font-size:11px">${esc(p.underlying || '')}</div></td>
          <td><span class="badge ${p.type}">${({ index: '指數', stock: '個股', etf: 'ETF' })[p.type]}</span></td>
          <td class="num">${im}</td>
          <td class="num">${mm}</td>
          <td class="num lev">${levTxt}</td>
          <td><button class="sm" data-add="${esc(p.code)}">加入</button></td>
        </tr>`;
      })
      .join('') || `<tr><td colspan="7" class="empty">無商品。${store.getProducts().length ? '調整搜尋條件' : '請先按「更新保證金」'}</td></tr>`;
  $('prodCount').textContent = `共 ${store.getProducts().length} 檔，符合 ${rows.length} 檔${rows.length > 500 ? '（顯示前 500）' : ''}`;
  tb.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => openAdd(b.dataset.add)));
}

// ---------- 庫存 ----------
function productByCode(code) {
  return store.getProducts().find((p) => p.code === code);
}

function riskDot(ratio) {
  if (ratio == null) return '';
  const c = ratio >= 1.5 ? 'green' : ratio >= 1.0 ? 'yellow' : 'red';
  return `<span class="dot ${c}"></span>`;
}

async function renderInventory() {
  const inv = store.getInventory();
  const overrides = store.getOverrides();
  const settings = store.getSettings();
  const wrap = $('invWrap');
  if (!inv.length) {
    wrap.innerHTML = '<div class="empty">尚無庫存。到下方搜尋商品並按「加入」。</div>';
    $('totals').innerHTML = '';
    return;
  }

  const calcRows = inv.map((pos) => {
    const p = productByCode(pos.productCode);
    const calc = p ? computePosition(p, pos.lots, pos.cost, overrides[pos.productCode]) : null;
    return { pos, p, calc };
  });

  wrap.innerHTML = `<div class="scroll"><table>
    <thead><tr>
      <th class="lcol">商品</th><th>方向</th><th>口數</th><th>成本</th>
      <th>契約價值</th><th>原始保證金</th><th>維持保證金</th><th>槓桿</th>
      ${settings.livePrice ? '<th>現價</th><th>未實現損益</th><th>維持率</th><th>斷頭價</th>' : ''}
      <th></th>
    </tr></thead><tbody>
    ${calcRows
      .map(({ pos, p, calc }) => {
        if (!p) return `<tr><td class="lcol">${esc(pos.productCode)} <span class="err">商品已不在清單，請更新</span></td><td colspan="20"><button class="sm danger" data-del="${pos.id}">刪除</button></td></tr>`;
        return `<tr>
          <td class="lcol">${esc(p.name)}<div class="dim" style="font-size:11px">${esc(p.code)}</div></td>
          <td><select class="sm" data-side="${pos.id}"><option value="long"${pos.side !== 'short' ? ' selected' : ''}>多</option><option value="short"${pos.side === 'short' ? ' selected' : ''}>空</option></select></td>
          <td><input class="num" style="width:60px" type="number" min="1" value="${pos.lots}" data-lots="${pos.id}"></td>
          <td><input class="num" style="width:90px" type="number" step="any" value="${pos.cost ?? ''}" placeholder="—" data-cost="${pos.id}"></td>
          <td class="num">${fmtNTD(calc.contractValue)}</td>
          <td class="num">${fmtNTD(calc.initialMargin)}</td>
          <td class="num">${fmtNTD(calc.maintMargin)}</td>
          <td class="num lev">${calc.leverage != null ? fmtLev(calc.leverage) : '<span class="dim">需乘數/成本</span>'}</td>
          ${settings.livePrice ? liveCells(pos) : ''}
          <td><button class="sm danger" data-del="${pos.id}">刪除</button></td>
        </tr>`;
      })
      .join('')}
    </tbody></table></div>`;

  // 總計
  const port = computePortfolio(calcRows.map((r) => r.calc).filter(Boolean));
  $('totals').innerHTML = `
    <div><div class="k">總契約價值</div><div class="v">${fmtNTD(port.contractValue)}</div></div>
    <div><div class="k">總原始保證金</div><div class="v">${fmtNTD(port.initialMargin)}</div></div>
    <div><div class="k">總維持保證金</div><div class="v">${fmtNTD(port.maintMargin)}</div></div>
    <div><div class="k">整體槓桿</div><div class="v">${fmtLev(port.leverage)}</div></div>
    ${settings.principal ? `<div><div class="k">本金</div><div class="v">${fmtNTD(settings.principal)}</div></div>` : ''}`;

  // 綁定
  wrap.querySelectorAll('[data-lots]').forEach((el) => (el.onchange = () => { store.updatePosition(el.dataset.lots, { lots: Math.max(1, Number(el.value) || 1) }); renderInventory(); }));
  wrap.querySelectorAll('[data-cost]').forEach((el) => (el.onchange = () => { store.updatePosition(el.dataset.cost, { cost: el.value === '' ? null : Number(el.value) }); renderInventory(); }));
  wrap.querySelectorAll('[data-side]').forEach((el) => (el.onchange = () => { store.updatePosition(el.dataset.side, { side: el.value }); renderInventory(); }));
  wrap.querySelectorAll('[data-del]').forEach((el) => (el.onclick = () => { store.removePosition(el.dataset.del); renderInventory(); }));

  if (settings.livePrice) refreshLive(calcRows);
}

function liveCells(pos) {
  return `<td class="num" data-live-price="${pos.id}">…</td><td class="num" data-live-pnl="${pos.id}"></td><td class="num" data-live-ratio="${pos.id}"></td><td class="num" data-live-liq="${pos.id}"></td>`;
}

// 即時報價（選配）：逐部位抓 Fugle，回填 cell。
async function refreshLive(calcRows) {
  const s = store.getSettings();
  if (!s.fugleKey) return;
  for (const { pos, calc } of calcRows) {
    if (!pos.symbol) continue;
    const px = await fetchLastPrice(pos.symbol, s.fugleKey, true);
    const live = px != null && calc ? computeLive(pos, calc, px) : null;
    const set = (k, v) => { const el = document.querySelector(`[data-live-${k}="${pos.id}"]`); if (el) el.innerHTML = v; };
    if (!live) { set('price', '<span class="dim">無價</span>'); continue; }
    set('price', fmtNTD(live.lastPrice));
    set('pnl', `<span style="color:${live.pnl >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtNTD(live.pnl)}</span>`);
    set('ratio', `${riskDot(live.marginRatio)}${fmtPct(live.marginRatio)}`);
    set('liq', fmtNTD(live.liqPrice));
  }
}

// ---------- 加入庫存 dialog ----------
let addingCode = null;
function openAdd(code) {
  const p = productByCode(code);
  if (!p) return;
  addingCode = code;
  $('addTitle').textContent = `加入：${p.name}（${p.code}）`;
  $('addLots').value = 1;
  $('addCost').value = '';
  $('addSide').value = 'long';
  const needMult = p.marginModel === 'amount' && p.multiplier == null && !store.getOverrides()[code];
  $('addMultWrap').style.display = needMult ? 'grid' : 'none';
  $('addMult').value = '';
  $('addDlg').showModal();
}
$('addDlg').addEventListener('close', () => {
  if ($('addDlg').returnValue !== 'ok' || !addingCode) return;
  const mult = $('addMult').value;
  if ($('addMultWrap').style.display !== 'none' && mult !== '') store.setOverride(addingCode, mult);
  store.addPosition({
    productCode: addingCode,
    lots: Math.max(1, Number($('addLots').value) || 1),
    cost: $('addCost').value === '' ? null : Number($('addCost').value),
    side: $('addSide').value,
  });
  addingCode = null;
  renderInventory();
});

// ---------- 更新保證金 ----------
async function doRefresh(fromPaste) {
  const btn = $('btnRefresh');
  const st = $('status');
  btn.disabled = true;
  st.textContent = '';
  $('meta').textContent = '更新中…';
  try {
    let result;
    if (fromPaste) result = parseHtml(fromPaste.index, fromPaste.stock, MULTI);
    else result = await fetchProducts(MULTI);
    if (!result.products.length) throw new Error('解析到 0 筆，頁面格式可能變動');
    store.saveProducts(result.products, result.dataDate);
    renderMeta();
    renderProducts();
    renderInventory();
  } catch (e) {
    st.textContent = `更新失敗：${e.message}（可改用「手動貼上」）`;
    renderMeta();
  } finally {
    btn.disabled = false;
  }
}

// ---------- 匯出 / 匯入 ----------
function exportInv() {
  const blob = new Blob([JSON.stringify({ inventory: store.getInventory(), overrides: store.getOverrides() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `futures-inventory-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
function importInv(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (Array.isArray(d.inventory)) store.replaceInventory(d.inventory);
      if (d.overrides) Object.entries(d.overrides).forEach(([k, v]) => store.setOverride(k, v));
      renderInventory();
    } catch (e) {
      $('status').textContent = `匯入失敗：${e.message}`;
    }
  };
  r.readAsText(file);
}

// ---------- 事件綁定 ----------
function bind() {
  $('btnRefresh').onclick = () => doRefresh();
  $('search').oninput = renderProducts;
  $('tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    tab = b.dataset.t;
    $('tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderProducts();
  }));
  $('btnExport').onclick = exportInv;
  $('btnImport').onclick = () => $('importFile').click();
  $('importFile').onchange = (e) => e.target.files[0] && importInv(e.target.files[0]);
  $('btnPaste').onclick = () => $('pasteDlg').showModal();
  $('pasteDlg').addEventListener('close', () => {
    if ($('pasteDlg').returnValue === 'ok') doRefresh({ index: $('pasteIndex').value, stock: $('pasteStock').value });
  });
  // 設定
  const s = store.getSettings();
  $('principal').value = s.principal || '';
  $('livePrice').checked = !!s.livePrice;
  $('fugleKey').value = s.fugleKey || '';
  $('btnSaveSettings').onclick = () => {
    store.saveSettings({ principal: Number($('principal').value) || 0, livePrice: $('livePrice').checked, fugleKey: $('fugleKey').value.trim() });
    renderInventory();
  };
}

// ---------- init ----------
async function init() {
  try {
    MULTI = await (await fetch('data/multipliers.json')).json();
  } catch {
    $('status').textContent = '無法載入 multipliers.json（請以 http server 開啟，非 file://）';
  }
  bind();
  renderMeta();
  renderProducts();
  renderInventory();
}
init();

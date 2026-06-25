// app.js — 進入點：載入資料、事件綁定、render。
import { store } from './store.js';
import { fetchProducts, parseHtml } from './taifex.js';
import { computePosition, computePortfolio, computeLive } from './calc.js';
import { fetchLastPrice } from './fugle.js';
import { computeSim } from './simulator.js';

let MULTI = { index: {}, stockLotDefault: 2000, stockLotSmall: 100, etfUnitsDefault: 10000, etfUnitsSmall: 1000 };
let tab = 'all';
const $ = (id) => document.getElementById(id);

// ---------- 格式化 ----------
const fmtNTD = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmtLev = (n) => (n == null ? '—' : `${n.toFixed(2)}x`);
const fmtPct = (n) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 最小跳動值：個股/ETF 依台股 tick 表（隨價格分級），指數查 multipliers.json（預設 1 點）
function equityTick(price) {
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 500) return 0.5;
  if (price < 1000) return 1;
  return 5;
}
function tickSizeOf(product, price) {
  if (product.type === 'stock' || product.type === 'etf') return equityTick(price);
  return MULTI.index?.[product.name]?.tick ?? 1;
}

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

function dotForRisk(pct) {
  if (pct == null) return '';
  const c = pct >= 50 ? 'green' : pct >= 25 ? 'yellow' : 'red';
  return `<span class="dot ${c}"></span>`;
}

// 風險等級：依操作槓桿（=部位市值/權益）分級
function gradeOf(opLev) {
  if (opLev < 2) return { t: '保守', c: 'green' };
  if (opLev < 5) return { t: '穩健', c: 'green' };
  if (opLev < 10) return { t: '積極', c: 'yellow' };
  if (opLev < 20) return { t: '高風險', c: 'orange' };
  return { t: '極高風險', c: 'red' };
}
const GRADE_HINT = '依操作槓桿(部位市值÷權益)分級：<2x 保守、2–5x 穩健、5–10x 積極、10–20x 高風險、≥20x 極高風險'; // 單品試算 native title 用
const GRADE_HTML = `操作槓桿 = 部位市值 ÷ 權益，分級：<br>
  <span style="color:var(--green)">&lt;2x 保守</span><br>
  <span style="color:var(--green)">2–5x 穩健</span><br>
  <span style="color:var(--yellow)">5–10x 積極</span><br>
  <span style="color:var(--orange)">10–20x 高風險</span><br>
  <span style="color:var(--red)">≥20x 極高風險</span>`;

let livePrices = {}; // symbol -> { price, error }，由 fetchAllLive 填，render 時同步讀取

function renderInventory() {
  const inv = store.getInventory();
  const overrides = store.getOverrides();
  const settings = store.getSettings();
  const live = !!settings.livePrice;
  const wrap = $('invWrap');
  if (!inv.length) {
    wrap.innerHTML = '<div class="empty">尚無庫存。到下方搜尋商品並按「加入」。</div>';
    $('totals').innerHTML = '';
    renderEquity([]);
    return;
  }

  const calcRows = inv.map((pos) => {
    const p = productByCode(pos.productCode);
    const calc = p ? computePosition(p, pos.lots, pos.cost, overrides[pos.productCode]) : null;
    const q = pos.symbol ? livePrices[pos.symbol] : null;
    const lv = live && calc && q && q.price != null ? computeLive(pos, calc, q.price) : null;
    return { pos, p, calc, q, lv };
  });

  const port = computePortfolio(calcRows.map((r) => r.calc).filter(Boolean));
  const sumPnl = calcRows.reduce((a, r) => a + (r.lv ? r.lv.pnl : 0), 0);

  wrap.innerHTML = `<div class="scroll"><table>
    <thead><tr>
      <th class="lcol">商品</th><th>方向</th><th>口數</th><th>成本</th>
      <th>契約價值</th><th>原始保證金</th><th>維持保證金</th><th>槓桿</th><th>每跳損益</th>
      ${live ? '<th>合約代碼</th><th>現價</th><th>未實現損益</th>' : ''}
      <th title="標的漲停(+10%)到該價的總損益">漲停損益</th><th title="標的跌停(−10%)到該價的總損益">跌停損益</th>
      <th></th>
    </tr></thead><tbody>
    ${calcRows.map((r) => rowHtml(r, live)).join('')}
    </tbody><tfoot><tr class="foot">
      <td class="lcol">帳戶合計</td><td></td><td></td><td></td>
      <td class="num">${fmtNTD(port.contractValue)}</td><td class="num">${fmtNTD(port.initialMargin)}</td><td class="num">${fmtNTD(port.maintMargin)}</td>
      <td class="num lev">${fmtLev(port.leverage)}</td><td></td>
      ${live ? `<td></td><td></td><td class="num ${pnlCls(sumPnl)}">${fmtNTD(sumPnl)}</td>` : ''}
      <td></td><td></td>
      <td></td>
    </tr></tfoot></table></div>`;

  $('totals').innerHTML = `
    <div><div class="k">總契約價值</div><div class="v">${fmtNTD(port.contractValue)}</div></div>
    <div><div class="k">總原始保證金</div><div class="v">${fmtNTD(port.initialMargin)}</div></div>
    <div><div class="k">總維持保證金</div><div class="v">${fmtNTD(port.maintMargin)}</div></div>
    <div><div class="k">整體槓桿</div><div class="v">${fmtLev(port.leverage)}</div></div>`;

  bindInvEvents(wrap);
  renderEquity(calcRows);
}

function rowHtml(r, live) {
  const { pos, p, calc, q, lv } = r;
  if (!p)
    return `<tr><td class="lcol">${esc(pos.productCode)} <span class="err">商品已不在清單，請更新</span></td><td colspan="20"><button class="sm danger" data-del="${pos.id}">刪除</button></td></tr>`;
  const isShort = pos.side === 'short';
  let liveTd = '';
  if (live) {
    const sym = `<td><input class="num" style="width:80px" value="${esc(pos.symbol || '')}" placeholder="TXFG6" data-symbol="${pos.id}"></td>`;
    const priceCell = lv
      ? `<td class="num">${fmtNTD(lv.lastPrice)}</td>`
      : `<td class="num dim">${esc(q && q.error ? q.error : pos.symbol ? '—' : '填代碼')}</td>`;
    const pnlCell = lv
      ? `<td class="num ${lv.pnl > 0 ? 'up' : lv.pnl < 0 ? 'down' : ''}">${fmtNTD(lv.pnl)}</td>`
      : '<td class="num dim">—</td>';
    liveTd = sym + priceCell + pnlCell;
  }
  const tick = tickValueOf(r);
  const up = scenPnl(r, 0.1);
  const down = scenPnl(r, -0.1);
  return `<tr>
    <td class="lcol">${esc(p.name)}<div class="dim" style="font-size:11px">${esc(p.code)}</div></td>
    <td><button class="dir ${isShort ? 'short' : 'long'}" data-side="${pos.id}">${isShort ? '空' : '多'}</button></td>
    <td><input class="num" style="width:60px" type="number" min="1" value="${pos.lots}" data-lots="${pos.id}"></td>
    <td><input class="num" style="width:90px" type="number" step="any" value="${pos.cost ?? ''}" placeholder="—" data-cost="${pos.id}"></td>
    <td class="num">${fmtNTD(calc.contractValue)}</td>
    <td class="num">${fmtNTD(calc.initialMargin)}</td>
    <td class="num">${fmtNTD(calc.maintMargin)}</td>
    <td class="num lev">${calc.leverage != null ? fmtLev(calc.leverage) : '<span class="dim">需乘數/成本</span>'}</td>
    <td class="num">${tick ? `${fmtNTD(tick.val)} <span class="dim" style="font-size:11px">/${tick.sz}</span>` : '—'}</td>
    ${liveTd}
    <td class="num ${pnlCls(up)}">${up == null ? '—' : fmtNTD(up)}</td>
    <td class="num ${pnlCls(down)}">${down == null ? '—' : fmtNTD(down)}</td>
    <td><button class="sm danger" data-del="${pos.id}">刪除</button></td>
  </tr>`;
}

function bindInvEvents(wrap) {
  wrap.querySelectorAll('[data-lots]').forEach((el) => (el.onchange = () => { store.updatePosition(el.dataset.lots, { lots: Math.max(1, Number(el.value) || 1) }); renderInventory(); }));
  wrap.querySelectorAll('[data-cost]').forEach((el) => (el.onchange = () => { store.updatePosition(el.dataset.cost, { cost: el.value === '' ? null : Number(el.value) }); renderInventory(); }));
  wrap.querySelectorAll('button[data-side]').forEach((el) => (el.onclick = () => { const cur = store.getInventory().find((p) => p.id === el.dataset.side); store.updatePosition(el.dataset.side, { side: cur && cur.side === 'short' ? 'long' : 'short' }); renderInventory(); }));
  wrap.querySelectorAll('[data-symbol]').forEach((el) => (el.onchange = () => { store.updatePosition(el.dataset.symbol, { symbol: el.value.trim().toUpperCase() || null }); fetchAllLive(); }));
  wrap.querySelectorAll('[data-del]').forEach((el) => (el.onclick = () => { store.removePosition(el.dataset.del); renderInventory(); }));
}

// 權益數（模擬期貨商帳戶權益）
function renderEquity(calcRows) {
  const s = store.getSettings();
  const el = $('equity');
  const rows = calcRows.filter((r) => r.calc);
  const port = computePortfolio(rows.map((r) => r.calc));
  const pnl = rows.reduce((a, r) => a + (r.lv ? r.lv.pnl : 0), 0);
  const principal = Number(s.principal) || 0;
  const equityTotal = principal + pnl;
  const marketValue = rows.reduce(
    (a, r) => a + (r.lv ? r.lv.lastPrice * r.calc.multiplier * (Number(r.pos.lots) || 0) : r.calc.contractValue || 0),
    0,
  );
  const excess = equityTotal - port.initialMargin;
  const risk = port.initialMargin > 0 && principal > 0 ? (equityTotal / port.initialMargin) * 100 : null;
  const callable = principal > 0 && equityTotal < port.maintMargin;
  // 帳戶層級緩衝：整體還能虧多少 / 整體再逆向幾% 才斷頭（混多空用淨曝險）
  const dirOf = (pos) => (pos.side === 'short' ? -1 : 1);
  const netExposure = rows.reduce((a, r) => {
    const mv = r.lv ? r.lv.lastPrice * r.calc.multiplier * (Number(r.pos.lots) || 0) : r.calc.contractValue || 0;
    return a + mv * dirOf(r.pos);
  }, 0);
  const cushionCall = principal > 0 ? equityTotal - port.maintMargin : null;
  const cushionLiq = principal > 0 ? equityTotal - 0.25 * port.initialMargin : null;
  const toCallPct = cushionCall != null && netExposure !== 0 ? (cushionCall / Math.abs(netExposure)) * 100 : null;
  const toLiqPct = cushionLiq != null && netExposure !== 0 ? (cushionLiq / Math.abs(netExposure)) * 100 : null;
  const opLev = equityTotal > 0 ? marketValue / equityTotal : null; // 操作槓桿（對權益）
  const util = equityTotal > 0 ? (port.initialMargin / equityTotal) * 100 : null; // 保證金使用率
  const grade = opLev == null ? null : gradeOf(opLev);

  const er = (k, v, hl = false) => `<div class="er ${hl ? 'hl' : ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  el.innerHTML = `<div class="equity">
    ${er('期初權益（本金）', principal ? fmtNTD(principal) : '<span class="sub">未輸入本金</span>')}
    ${er('浮動損益', `<span class="${pnl > 0 ? 'up' : pnl < 0 ? 'down' : ''}">${fmtNTD(pnl)}</span>${!s.livePrice ? ' <span class="sub">未開即時</span>' : ''}`)}
    ${er('權益總值', principal ? fmtNTD(equityTotal) : '—', true)}
    ${er('操作槓桿（對權益）', opLev == null ? '<span class="sub">需本金</span>' : fmtLev(opLev), true)}
    ${er('風險等級', grade == null ? '<span class="sub">需本金</span>' : `<span style="color:var(--${grade.c})">${grade.t}</span> <span class="tip sub">ⓘ<span class="tipbox">${GRADE_HTML}</span></span>`)}
    ${er('原始保證金', fmtNTD(port.initialMargin))}
    ${er('維持保證金', fmtNTD(port.maintMargin))}
    ${er('保證金使用率', util == null ? '<span class="sub">需本金</span>' : `<span class="${util >= 100 ? 'neg' : ''}">${util.toFixed(0)}%</span>`)}
    ${er('可動用（超額）保證金', principal ? `<span class="${excess < 0 ? 'neg' : ''}">${fmtNTD(excess)}</span>` : '—')}
    ${er('風險指標', risk == null ? '<span class="sub">需本金</span>' : `${dotForRisk(risk)}${risk.toFixed(0)}%`, true)}
    ${er('距追繳金額', cushionCall == null ? '<span class="sub">需本金</span>' : `<span class="${cushionCall < 0 ? 'neg' : ''}">${fmtNTD(cushionCall)}</span>${toCallPct != null ? ` <span class="sub">(再逆向 ${toCallPct.toFixed(1)}%)</span>` : ''}`)}
    ${er('距斷頭金額', cushionLiq == null ? '<span class="sub">需本金</span>' : `<span class="${cushionLiq < 0 ? 'neg' : ''}">${fmtNTD(cushionLiq)}</span>${toLiqPct != null ? ` <span class="sub">(再逆向 ${toLiqPct.toFixed(1)}%)</span>` : ''}`, true)}
  </div>
  ${callable ? '<p class="err" style="margin-top:8px">⚠ 權益總值低於維持保證金 → 將被追繳保證金</p>' : ''}
  ${risk != null && risk < 25 ? '<p class="err" style="margin-top:4px">⚠ 風險指標 &lt; 25% → 多數期貨商盤中將代為沖銷（斷頭）</p>' : ''}`;
}

// ---------- 漲跌停損益 / 每跳損益 helpers ----------
// 標的漲跌 s（±0.1=漲跌停）→ 到該價位的總未實現損益。基準價 = 現價(無即時則成本)。
function scenPnl(r, s) {
  if (!r.calc || r.pos.cost == null || r.calc.multiplier == null) return null;
  const base = r.lv ? r.lv.lastPrice : Number(r.pos.cost);
  const dir = r.pos.side === 'short' ? -1 : 1;
  return (base * (1 + s) - Number(r.pos.cost)) * r.calc.multiplier * (Number(r.pos.lots) || 0) * dir;
}
function tickValueOf(r) {
  const price = r.lv ? r.lv.lastPrice : r.pos.cost;
  if (!r.calc || r.calc.multiplier == null || price == null || price === '') return null;
  const sz = tickSizeOf(r.p, Number(price));
  return { sz, val: sz * r.calc.multiplier * (Number(r.pos.lots) || 0) };
}
function pnlCls(v) {
  return v == null ? 'dim' : v > 0 ? 'up' : v < 0 ? 'down' : '';
}

// 自動輪詢：啟用即時報價時每 15 秒抓一次現價。
let liveTimer = null;
const LIVE_INTERVAL = 15000;
function scheduleLive() {
  clearInterval(liveTimer);
  liveTimer = null;
  if (store.getSettings().livePrice) liveTimer = setInterval(() => fetchAllLive(true), LIVE_INTERVAL);
}

// 抓所有部位現價，填 livePrices，再重繪。silent=自動輪詢（不顯示「抓取中」、不打斷其他訊息）。
async function fetchAllLive(silent = false) {
  const s = store.getSettings();
  const st = $('status');
  const info = (m) => { st.style.color = 'var(--muted)'; st.textContent = m; };
  if (!s.livePrice) { if (!silent) info('未啟用即時報價：請勾「Fugle 即時報價」後按「儲存並計算」'); scheduleLive(); renderInventory(); return; }
  if (!s.fugleKey) { if (!silent) info('未填 Fugle API key'); renderInventory(); return; }
  const symbols = [...new Set(store.getInventory().map((p) => p.symbol).filter(Boolean))];
  if (!symbols.length) { if (!silent) info('庫存無合約代碼：請在部位的「合約代碼」欄填近月碼（如 TXFG6）'); renderInventory(); return; }
  if (!silent) info(`抓取現價中…（${symbols.length} 檔）`);
  await Promise.all(symbols.map(async (sym) => { livePrices[sym] = await fetchLastPrice(sym, s.fugleKey); }));
  const bad = symbols.find((x) => livePrices[x]?.error);
  const t = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  st.style.color = 'var(--muted)';
  st.textContent = bad ? `現價失敗：${livePrices[bad].error}` : `現價更新於 ${t}（每 15 秒自動）`;
  renderInventory();
}

// ---------- 合約代碼（Fugle symbol）----------
// Fugle 月碼 A–L = 1–12 月；年碼取西元末碼。近月：過了結算日（每月第 3 個週三）就跳次月。
function thirdWednesday(y, m) {
  const dow = new Date(y, m - 1, 1).getDay(); // 0=日
  return 1 + ((3 - dow + 7) % 7) + 14; // 第一個週三 + 14
}
function rootOf(p) {
  return /^[A-Z0-9]+$/.test(p.code) ? p.code : null; // 中文名（無 Fugle 根代碼）→ null
}
function contractMonths(root, n = 8) {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth() + 1;
  if (now.getDate() > thirdWednesday(y, m)) { m++; if (m > 12) { m = 1; y++; } }
  const out = [];
  for (let i = 0; i < n; i++) {
    const mm = ((m - 1 + i) % 12) + 1;
    const yy = y + Math.floor((m - 1 + i) / 12);
    const sym = `${root}${String.fromCharCode(64 + mm)}${yy % 10}`;
    out.push({ symbol: sym, label: `${yy}/${String(mm).padStart(2, '0')}（${sym}）${i === 0 ? ' 近月' : ''}`, near: i === 0 });
  }
  return out;
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
  const root = rootOf(p);
  const sel = $('addSymbol');
  if (root) {
    sel.innerHTML = contractMonths(root).map((o) => `<option value="${o.symbol}"${o.near ? ' selected' : ''}>${o.label}</option>`).join('');
    sel.disabled = false;
  } else {
    sel.innerHTML = '<option value="">（此商品無 Fugle 自動代碼）</option>';
    sel.disabled = true;
  }
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
    symbol: $('addSymbol').value.trim().toUpperCase() || null,
  });
  addingCode = null;
  fetchAllLive();
});

// ---------- 更新保證金 ----------
const CACHE_TTL = 3600000; // 1 小時：期間內手動更新沿用快取，不重打期交所

async function doRefresh(fromPaste) {
  const btn = $('btnRefresh');
  const st = $('status');
  if (!fromPaste) {
    const meta = store.getMeta();
    const age = meta.lastRefreshed ? Date.now() - new Date(meta.lastRefreshed).getTime() : Infinity;
    if (age < CACHE_TTL && store.getProducts().length) {
      st.style.color = 'var(--muted)';
      st.textContent = `已是 ${Math.round(age / 60000)} 分鐘前快取（1 小時內不重抓，需強制可用「手動貼上」）`;
      return;
    }
  }
  btn.disabled = true;
  st.style.color = '';
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
    populateSimProduct();
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

// ---------- 單品試算 ----------
function populateSimProduct() {
  const sel = $('simProduct');
  if (!sel) return;
  const cur = sel.value;
  const q = ($('simSearch')?.value || '').trim().toLowerCase();
  const list = store.getProducts().filter((p) => !q || [p.code, p.name, p.underlying].some((x) => String(x).toLowerCase().includes(q)));
  sel.innerHTML = list.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}（${esc(p.code)}）</option>`).join('');
  if (cur && list.some((p) => p.code === cur)) sel.value = cur;
}

function renderSim() {
  const out = $('simOut');
  const products = store.getProducts();
  if (!products.length) {
    out.innerHTML = '<div class="empty">請先到「多檔持倉」按「更新保證金」載入商品。</div>';
    return;
  }
  if (!$('simProduct').options.length) populateSimProduct();
  const product = products.find((p) => p.code === $('simProduct').value) || products[0];
  const s = computeSim(
    product,
    { equity: $('simEquity').value, price: $('simPrice').value, lots: $('simLots').value, drawdownPct: $('simDrawdown').value },
    store.getOverrides()[product.code],
  );
  const px = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
  const pct = (n) => (n == null ? '—' : `${n.toFixed(2)}%`);
  const spec = (lbl, val, warn) => `<div class="spec${warn ? ' warn' : ''}"><div class="lbl">${lbl}</div><div class="val">${val}</div></div>`;
  const grade = s.opLev == null ? null : gradeOf(s.opLev);
  const gradeTxt = (g) => `<span style="color:var(--${g.c})" title="${GRADE_HINT}">${g.t}</span>`;

  out.innerHTML = `
    <div class="speccols">
      <div class="speccol"><h3>原始商品合約規格（單口）</h3>
        ${spec('契約價值', px(s.one.contractValue))}
        ${spec('原始保證金', px(s.one.initialMargin))}
        ${spec('每點價值', px(s.perPt))}
        ${spec('商品槓桿', s.prodLev == null ? '—' : fmtLev(s.prodLev))}
        ${spec('漲停價 (+10%)', s.price == null ? '—' : (s.price * 1.1).toLocaleString('en-US', { maximumFractionDigits: 2 }))}
        ${spec('跌停價 (−10%)', s.price == null ? '—' : (s.price * 0.9).toLocaleString('en-US', { maximumFractionDigits: 2 }))}
      </div>
      <div class="speccol"><h3>帳戶操作合約規格（${s.lots} 口）</h3>
        ${spec('總契約價值', px(s.many.contractValue))}
        ${spec('使用保證金', `${px(s.many.initialMargin)}${s.util != null ? ` <span class="sub">${s.util.toFixed(1)}%</span>` : ''}`, s.util != null && s.util > 100)}
        ${spec('每點價值（總）', px(s.totalPt))}
        ${spec('操作槓桿', s.opLev == null ? '—' : fmtLev(s.opLev))}
      </div>
      <div class="speccol"><h3>自訂風險承受能力（回檔 ${s.dd}%）</h3>
        ${spec('回檔上限（點）', px(s.ddPts))}
        ${spec('回檔上限（%）', pct(s.ddPctPrice))}
        ${spec('預估損失金額', px(s.estLoss))}
        ${spec('維持保證金', px(s.many.maintMargin))}
      </div>
      <div class="speccol"><h3>最大風險承受能力</h3>
        ${spec('低於維持保證金（點）', px(s.maintPts), true)}
        ${spec('低於維持保證金（%）', pct(s.maintPct), true)}
        ${spec('超額損失（點）', px(s.zeroPts), true)}
        ${spec('超額損失（%）', pct(s.zeroPct), true)}
      </div>
    </div>
    <h2 style="margin-top:24px">目前槓桿</h2>
    <div class="scroll"><table><thead><tr>
      <th class="lcol">槓桿</th><th class="lcol">風險等級</th><th>口數</th><th>總契約價值</th><th>使用保證金</th><th>保證金使用率</th><th>回檔上限(點)</th><th>回檔上限(%)</th>
    </tr></thead><tbody><tr>
      <td class="lcol lev">${s.opLev == null ? '—' : fmtLev(s.opLev)}</td>
      <td class="lcol">${grade ? gradeTxt(grade) : '—'}</td>
      <td class="num">${s.lots}</td>
      <td class="num">${px(s.many.contractValue)}</td>
      <td class="num">${px(s.many.initialMargin)}</td>
      <td class="num">${s.util == null ? '—' : s.util.toFixed(1) + '%'}</td>
      <td class="num">${px(s.ddPts)}</td>
      <td class="num">${pct(s.ddPctPrice)}</td>
    </tr></tbody></table></div>
    <h2 style="margin-top:24px">槓桿對照表</h2>
    <div class="scroll"><table><thead><tr>
      <th class="lcol">目標槓桿</th><th class="lcol">風險等級</th><th>口數</th><th>總契約價值</th><th>使用保證金</th><th>保證金使用率</th><th>回檔上限(點)</th><th>回檔上限(%)</th>
    </tr></thead><tbody>
      ${s.table
        .filter((r) => r.lots != null)
        .map((r) => {
          const g = gradeOf(r.opLev);
          return `<tr>
            <td class="lcol lev">${r.target}x</td>
            <td class="lcol">${gradeTxt(g)}</td>
            <td class="num">${r.lots}</td>
            <td class="num">${px(r.totalCV)}</td>
            <td class="num">${px(r.used)}</td>
            <td class="num ${r.util != null && r.util > 100 ? 'neg' : ''}">${r.util == null ? '—' : r.util.toFixed(1) + '%'}</td>
            <td class="num">${px(r.ddPts)}</td>
            <td class="num">${pct(r.ddPct)}</td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="8" class="empty">輸入收盤價後顯示</td></tr>'}
    </tbody></table></div>`;
}

function switchView(v) {
  $('view-portfolio').hidden = v !== 'portfolio';
  $('view-sim').hidden = v !== 'sim';
  document.querySelectorAll('.viewtabs button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
  if (v === 'sim') renderSim();
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
  const persistSettings = () => store.saveSettings({ principal: Number($('principal').value) || 0, livePrice: $('livePrice').checked, fugleKey: $('fugleKey').value.trim() });
  $('btnSaveSettings').onclick = () => { persistSettings(); scheduleLive(); fetchAllLive(); };
  $('btnRefreshLive').onclick = () => { persistSettings(); scheduleLive(); fetchAllLive(); };
  // 視圖切換 + 單品試算
  document.querySelectorAll('.viewtabs button').forEach((b) => (b.onclick = () => switchView(b.dataset.v)));
  ['simEquity', 'simPrice', 'simLots'].forEach((id) => ($(id).oninput = renderSim));
  $('simProduct').onchange = renderSim;
  $('simSearch').oninput = () => { populateSimProduct(); renderSim(); };
  $('simDrawdown').oninput = () => { $('simDrawdownVal').textContent = `${$('simDrawdown').value}%`; renderSim(); };
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
  populateSimProduct();
  if (store.getSettings().livePrice) { scheduleLive(); fetchAllLive(); }
}
init();

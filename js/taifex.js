// taifex.js — 抓期交所保證金頁 + 解析成統一商品 schema。
// 純前端會被 CORS 擋 → 透過公開 proxy。期交所看到 proxy IP，使用者 IP 不會被黑名單。

const PAGES = {
  index: 'https://www.taifex.com.tw/cht/5/indexMarging',
  stock: 'https://www.taifex.com.tw/cht/5/stockMargining',
};

// 多個 proxy 依序嘗試，前者掛了用後者。
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

const num = (s) => Number(String(s).replace(/[,\s]/g, '')) || 0;
const pct = (s) => num(String(s).replace('%', '')) / 100;
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function fetchViaProxy(url) {
  let lastErr;
  for (const make of PROXIES) {
    try {
      const res = await fetch(make(url), { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      // 期交所這兩頁是 UTF-8；保留 big5 fallback（亂碼偵測）。
      let html = new TextDecoder('utf-8').decode(buf);
      if (html.includes('�') && html.match(/�/g).length > 20) {
        html = new TextDecoder('big5').decode(buf);
      }
      return html;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`所有 proxy 皆失敗：${lastErr?.message || lastErr}`);
}

function parseDoc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

// 指數類：商品別 | 結算 | 維持 | 原始（固定 NTD）
function parseIndexTables(doc, multipliers) {
  const out = [];
  for (const table of doc.querySelectorAll('table')) {
    const head = txt(table);
    if (!head.includes('商品別') || !head.includes('原始保證金')) continue;
    for (const tr of table.querySelectorAll('tr')) {
      const c = [...tr.querySelectorAll('td')].map(txt);
      if (c.length < 4) continue;
      const name = c[0];
      if (!name || name === '商品別' || name.includes('選擇權')) continue;
      const m = multipliers.index[name] || {};
      out.push({
        type: 'index',
        marginModel: 'amount',
        code: m.code || name,
        name,
        underlying: '',
        settle: num(c[1]),
        maintenance: num(c[2]),
        initial: num(c[3]),
        multiplier: m.multiplier ?? null,
        lot: null,
        tier: '',
      });
    }
  }
  return out;
}

// 股票類：個股(百分比) + ETF(固定 NTD)。略過選擇權表。
function parseStockTables(doc, multipliers) {
  const out = [];
  for (const table of doc.querySelectorAll('table')) {
    const head = txt(table);
    if (head.includes('選擇權')) continue;
    const isPercent = head.includes('適用比例');
    const isEtf = !isPercent && head.includes('結算保證金') && head.includes('英文代碼');
    if (!isPercent && !isEtf) continue;

    for (const tr of table.querySelectorAll('tr')) {
      const c = [...tr.querySelectorAll('td')].map(txt);
      if (c.length < 8) continue;
      const code = c[1];
      const name = c[3];
      if (!code || code === '股票期貨英文代碼' || /[^A-Z]/.test(code)) continue; // 表頭/非代碼略過
      const underlying = c[4] || '';
      // 比例/金額一律取最後三欄：結算, 維持, 原始（避免級距欄空白造成位移）
      const settle = c[c.length - 3];
      const maint = c[c.length - 2];
      const initial = c[c.length - 1];
      const small = name.includes('小型');

      if (isPercent) {
        out.push({
          type: 'stock',
          marginModel: 'percent',
          code,
          name,
          underlying,
          settle: pct(settle),
          maintenance: pct(maint),
          initial: pct(initial),
          multiplier: null,
          lot: small ? multipliers.stockLotSmall : multipliers.stockLotDefault,
          tier: c[5] && c[5].includes('級距') ? c[5] : '',
        });
      } else {
        out.push({
          type: 'etf',
          marginModel: 'amount',
          code,
          name,
          underlying,
          settle: num(settle),
          maintenance: num(maint),
          initial: num(initial),
          multiplier: small ? multipliers.etfUnitsSmall : multipliers.etfUnitsDefault,
          lot: null,
          tier: '',
        });
      }
    }
  }
  return out;
}

// 嘗試從頁面文字抓「異動/適用日期」(民國)。抓不到回 null。
function extractDataDate(html) {
  const m = html.match(/(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) return null;
  const y = Number(m[1]) + (Number(m[1]) < 1911 ? 1911 : 0);
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

/** 從已下載的兩段 HTML 解析（手動貼上 fallback 共用）。 */
export function parseHtml(indexHtml, stockHtml, multipliers) {
  const products = [
    ...parseIndexTables(parseDoc(indexHtml), multipliers),
    ...parseStockTables(parseDoc(stockHtml), multipliers),
  ];
  const dataDate = extractDataDate(indexHtml) || extractDataDate(stockHtml);
  return { products, dataDate };
}

/** 主流程：透過 proxy 抓兩頁並解析。 */
export async function fetchProducts(multipliers) {
  const [indexHtml, stockHtml] = await Promise.all([
    fetchViaProxy(PAGES.index),
    fetchViaProxy(PAGES.stock),
  ]);
  return parseHtml(indexHtml, stockHtml, multipliers);
}

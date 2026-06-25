// fugle.js — (選配) Fugle 即時期貨行情。預設關閉；核心成本制槓桿不依賴它。
//
// 端點：https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote/{symbol}
//   header: X-API-KEY: <你的金鑰>
//   symbol：完整月份合約，如 TXFC5（TXF + 月碼 + 年末碼），非根代碼 TXF。
//   文件：https://developer.fugle.tw/docs/data-futopt/http-api/intraday/quote/
//
// 實測 Fugle 允許瀏覽器直連（純前端可用）。常見錯誤：404＝合約代碼錯、401＝金鑰錯；
// 只有 "Failed to fetch"（無 HTTP status）才是 CORS/網路問題。

const BASE = 'https://api.fugle.tw/marketdata/v1.0/futopt/intraday/quote';

/**
 * 取單一合約最後成交價。
 * @returns {Promise<{price:number|null, error:string|null}>}
 */
export async function fetchLastPrice(symbol, apiKey) {
  if (!symbol) return { price: null, error: '未填合約代碼' };
  if (!apiKey) return { price: null, error: '未填 API key' };
  const url = `${BASE}/${encodeURIComponent(symbol)}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey },
    });
    if (!res.ok) {
      return { price: null, error: `HTTP ${res.status}${res.status === 401 ? '（金鑰無效）' : res.status === 404 ? '（合約代碼錯誤）' : ''}` };
    }
    const d = await res.json();
    // Fugle futopt quote 常見價格欄位，依序容錯。
    const p =
      d.lastPrice ??
      d.lastTrade?.price ??
      d.closePrice ??
      d.previousClose ??
      d.lastTrial?.price ??
      null;
    return { price: p == null ? null : Number(p), error: p == null ? '回應無價格欄位' : null };
  } catch (e) {
    console.error('[live] fetch error', symbol, e);
    return { price: null, error: `CORS/網路（${e.message}）` };
  }
}

// WebSocket 即時串流（tick-by-tick）。協定取自官方 SDK：
//   連線後送 {event:auth,data:{apikey}} → 收 {event:authenticated} → 送 subscribe(trades) →
//   收 {event:data,data:{symbol,price,...}}。斷線自動重連。
const WS_URL = 'wss://api.fugle.tw/marketdata/v1.0/futopt/streaming';
export function connectFugleStream(apiKey, symbols, onTick, onStatus) {
  let ws;
  let closed = false;
  let retry = 0;
  const open = () => {
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      onStatus?.('error', e.message);
      return;
    }
    ws.onopen = () => ws.send(JSON.stringify({ event: 'auth', data: { apikey: apiKey } }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.event === 'authenticated') {
        retry = 0;
        onStatus?.('connected');
        for (const s of symbols) ws.send(JSON.stringify({ event: 'subscribe', data: { channel: 'trades', symbol: s } }));
      } else if (m.event === 'error') {
        onStatus?.('error', m.data?.message || '');
      } else if (m.event === 'data') {
        const d = m.data || {};
        const p = d.price ?? d.lastPrice ?? d.close ?? d.closePrice;
        if (d.symbol && p != null) onTick(d.symbol, Number(p));
      }
    };
    ws.onclose = () => {
      if (closed) return;
      retry += 1;
      onStatus?.('reconnecting');
      setTimeout(open, Math.min(10000, 1500 * retry));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  };
  open();
  return { close() { closed = true; try { ws.close(); } catch { /* noop */ } } };
}

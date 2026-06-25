// fugle.js — (選配) Fugle dapi 即時報價。預設關閉；核心成本制槓桿不依賴它。
//
// ⚠ 注意：Fugle 期權(futopt)行情 endpoint / symbol 格式請對照官方文件確認：
//   https://developer.fugle.tw/docs/data-futopt/intro/
// 下方依 Fugle marketdata REST 既有型態(stock quote)推導 futopt，欄位若對不上請在此調整。
//
// symbol 需「完整月份合約代碼」(如 TXFG5)，非根代碼(TXF)。multipliers.json 只存根代碼，
// 故近月合約字串由使用者於部位上補（pos.symbol），未填則無法取價。

const BASE = 'https://api.fugle.tw/marketdata/v1.0/futopt/quote';
const PROXY = (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`;

/**
 * 取單一合約最後成交價。回傳 number 或 null。
 * @param symbol 完整合約代碼，如 'TXFG5'
 * @param apiKey Fugle X-API-KEY
 * @param useProxy 若直連被 CORS 擋則設 true
 */
export async function fetchLastPrice(symbol, apiKey, useProxy = false) {
  if (!symbol || !apiKey) return null;
  const url = `${BASE}/${encodeURIComponent(symbol)}`;
  const headers = { 'X-API-KEY': apiKey };
  try {
    // proxy 模式下 header 可能被丟棄，改用 query key（Fugle 也支援 ?apiToken=）
    const finalUrl = useProxy ? PROXY(`${url}?apiToken=${apiKey}`) : url;
    const res = await fetch(finalUrl, { headers: useProxy ? {} : headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // 容錯抓常見欄位名
    const p =
      data.lastPrice ??
      data.closePrice ??
      data.price ??
      data?.data?.quote?.lastPrice ??
      data?.quote?.lastPrice ??
      null;
    return p == null ? null : Number(p);
  } catch (e) {
    console.warn('Fugle quote failed', symbol, e);
    return null;
  }
}

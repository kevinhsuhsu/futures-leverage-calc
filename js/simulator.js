// simulator.js — 單品試算（下單前 position sizing / 風險規劃）。純計算。
// 公式對照 alpha.futures-ai.com/leverage-simulator 並以其數字反推驗證：
//   回檔上限點 = 預估損失 / (每點價值×口數)；低於維持點 = (權益−總維持) / (每點×口數)；
//   超額損失點 = 權益 / (每點×口數)；對照表口數 = round(目標槓桿×權益 / 單口契約值)。
import { computePosition } from './calc.js';

export function computeSim(product, params, override) {
  const equity = Number(params.equity) || 0;
  const price = params.price === '' || params.price == null ? null : Number(params.price);
  const lots = Math.max(1, Number(params.lots) || 1);
  const dd = Number(params.drawdownPct) || 0;

  const one = computePosition(product, 1, price, override);
  const many = computePosition(product, lots, price, override);
  const perPt = one.multiplier; // 每點(每 1 價格單位)價值/口；個股=股數
  const has = price != null && perPt != null;
  const totalPt = has ? perPt * lots : null;

  const prodLev = one.initialMargin > 0 && one.contractValue != null ? one.contractValue / one.initialMargin : null;
  const opLev = equity > 0 && many.contractValue != null ? many.contractValue / equity : null;
  const util = equity > 0 ? (many.initialMargin / equity) * 100 : null;

  const estLoss = (dd / 100) * equity;
  const ddPts = totalPt ? estLoss / totalPt : null;
  const ddPctPrice = ddPts != null && price ? (ddPts / price) * 100 : null;
  const maintPts = totalPt ? (equity - many.maintMargin) / totalPt : null;
  const maintPct = maintPts != null && price ? (maintPts / price) * 100 : null;
  const zeroPts = totalPt ? equity / totalPt : null;
  const zeroPct = zeroPts != null && price ? (zeroPts / price) * 100 : null;

  const table = [10, 20, 30].map((L) => {
    if (!has || !one.contractValue) return { target: L, lots: null };
    const n = Math.max(1, Math.round((L * equity) / one.contractValue));
    const m = computePosition(product, n, price, override);
    const pt = perPt * n;
    return {
      target: L,
      lots: n,
      totalCV: m.contractValue,
      used: m.initialMargin,
      util: equity > 0 ? (m.initialMargin / equity) * 100 : null,
      opLev: equity > 0 ? m.contractValue / equity : null,
      ddPts: estLoss / pt,
      ddPct: price ? (estLoss / pt / price) * 100 : null,
    };
  });

  return { one, many, perPt, totalPt, prodLev, opLev, util, estLoss, ddPts, ddPctPrice, maintPts, maintPct, zeroPts, zeroPct, table, equity, price, lots, dd };
}

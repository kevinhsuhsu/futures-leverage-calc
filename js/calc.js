// calc.js — 槓桿/保證金核心公式。純函式，依 marginModel 分流。
//
// 兩種保證金制度（期交所原始資料）：
//   percent : 個股期貨。原始/維持為「契約價值的比例」(0.135 = 13.5%)。
//             契約價值 = 成本 × 股數 × 口數；槓桿 = 1/原始比例（與價格無關）。
//   amount  : 指數/ETF 期貨。原始/維持為「每口固定 NTD」。
//             契約價值 = 成本 × 契約乘數 × 口數；槓桿 = 契約價值 / 原始保證金總額。

/**
 * 解析該商品實際採用的契約乘數（amount 制）或每口股數（percent 制）。
 * override 優先於商品內建乘數。
 */
export function effectiveMultiplier(product, override) {
  if (product.marginModel === 'percent') return product.lot; // 股數
  return override != null ? override : product.multiplier; // 指數/ETF 乘數
}

/**
 * 單一部位計算。
 * @param product 正規化商品
 * @param lots 口數 (>0)
 * @param cost 成本價；可為 null（percent 制仍能算槓桿）
 * @param override 手動乘數覆寫（amount 制）
 * @returns { contractValue, initialMargin, maintMargin, leverage, multiplier }
 */
export function computePosition(product, lots, cost, override) {
  const n = Number(lots) || 0;
  const px = cost == null || cost === '' ? null : Number(cost);
  const mult = effectiveMultiplier(product, override);

  let contractValue = null;
  let initialMargin = null;
  let maintMargin = null;
  let leverage = null;

  if (product.marginModel === 'percent') {
    // initial / maintenance 存的是比例 (fraction)
    leverage = product.initial > 0 ? 1 / product.initial : null; // 不需價格
    if (px != null && mult != null) {
      contractValue = px * mult * n;
      initialMargin = contractValue * product.initial;
      maintMargin = contractValue * product.maintenance;
    }
  } else {
    // amount：initial / maintenance 存的是每口 NTD
    initialMargin = product.initial * n;
    maintMargin = product.maintenance * n;
    if (px != null && mult != null) {
      contractValue = px * mult * n;
      leverage = initialMargin > 0 ? contractValue / initialMargin : null;
    }
  }

  return { contractValue, initialMargin, maintMargin, leverage, multiplier: mult };
}

/**
 * 組合彙總：總契約價值、總原始/維持保證金、整體槓桿。
 * 整體槓桿 = Σ契約價值 / Σ原始保證金（僅計入兩者皆有值的部位）。
 */
export function computePortfolio(rows) {
  let cv = 0;
  let im = 0;
  let mm = 0;
  let cvForLev = 0;
  let imForLev = 0;
  for (const r of rows) {
    if (r.contractValue != null) cv += r.contractValue;
    if (r.initialMargin != null) im += r.initialMargin;
    if (r.maintMargin != null) mm += r.maintMargin;
    if (r.contractValue != null && r.initialMargin != null) {
      cvForLev += r.contractValue;
      imForLev += r.initialMargin;
    }
  }
  return {
    contractValue: cv,
    initialMargin: im,
    maintMargin: mm,
    leverage: imForLev > 0 ? cvForLev / imForLev : null,
  };
}

/**
 * 即時報價衍生（選配，需現價）。
 * 未實現損益 = (現價 - 成本) × 乘數 × 口數 × 方向(多1/空-1)
 * 權益 = 投入保證金(原始) + 未實現損益
 * 維持率 = 權益 / 維持保證金
 * 強制平倉價 = 反推使 權益 = 維持保證金 的價格
 */
export function computeLive(pos, calc, lastPrice) {
  if (lastPrice == null || calc.multiplier == null || calc.initialMargin == null) return null;
  const dir = pos.side === 'short' ? -1 : 1;
  const n = Number(pos.lots) || 0;
  const cost = Number(pos.cost);
  const pnl = (lastPrice - cost) * calc.multiplier * n * dir;
  const equity = calc.initialMargin + pnl;
  const marginRatio = calc.maintMargin > 0 ? equity / calc.maintMargin : null;
  // 斷頭：equity 降到 maintMargin。equity = initial + (P-cost)*mult*n*dir
  // 解 P：P = cost + (maint - initial) / (mult*n*dir)
  const denom = calc.multiplier * n * dir;
  const liqPrice = denom !== 0 ? cost + (calc.maintMargin - calc.initialMargin) / denom : null;
  return { lastPrice, pnl, equity, marginRatio, liqPrice };
}

// store.js — localStorage 持久層。所有資料單機保存，無雲端。
const K = {
  products: 'flc.products',
  meta: 'flc.meta',
  inventory: 'flc.inventory',
  overrides: 'flc.overrides', // { [productCode]: multiplier } 手動乘數覆寫
  settings: 'flc.settings', // { fugleKey, livePrice, principal }
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const store = {
  // --- products + meta（refresh 寫入）---
  getProducts: () => read(K.products, []),
  getMeta: () => read(K.meta, { lastRefreshed: null, dataDate: null }),
  saveProducts(products, dataDate) {
    write(K.products, products);
    write(K.meta, { lastRefreshed: new Date().toISOString(), dataDate: dataDate || null });
  },

  // --- inventory CRUD ---
  getInventory: () => read(K.inventory, []),
  addPosition(pos) {
    const inv = read(K.inventory, []);
    pos.id = `p_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
    inv.push(pos);
    write(K.inventory, inv);
    return pos.id;
  },
  updatePosition(id, patch) {
    const inv = read(K.inventory, []).map((p) => (p.id === id ? { ...p, ...patch } : p));
    write(K.inventory, inv);
  },
  removePosition(id) {
    write(K.inventory, read(K.inventory, []).filter((p) => p.id !== id));
  },
  replaceInventory(inv) {
    write(K.inventory, Array.isArray(inv) ? inv : []);
  },

  // --- 乘數覆寫 ---
  getOverrides: () => read(K.overrides, {}),
  setOverride(code, multiplier) {
    const o = read(K.overrides, {});
    if (multiplier == null || multiplier === '') delete o[code];
    else o[code] = Number(multiplier);
    write(K.overrides, o);
  },

  // --- 設定 ---
  getSettings: () => read(K.settings, { fugleKey: '', livePrice: false, principal: 0 }),
  saveSettings(patch) {
    write(K.settings, { ...read(K.settings, {}), ...patch });
  },
};

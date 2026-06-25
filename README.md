# 台股期貨槓桿計算機

純前端（無後端、無 build、無 toolchain）的台股期貨槓桿/保證金計算機。資料存瀏覽器 localStorage，單機保存。

## 功能

- **更新保證金**：一鍵從期交所抓全部商品保證金存 local（手動觸發，低頻，避免黑名單）。
- **搜尋**：依代碼／名稱／標的，分類（指數／個股／ETF）。
- **庫存 CRUD**：新增／刪除、即時改口數與成本、多空方向。
- **顯示**：契約價值、原始保證金、維持保證金、槓桿，及組合總計與整體槓桿。
- **匯出／匯入**庫存 JSON（換機備份）。
- **（選配）Fugle 即時報價**：未實現損益、維持率、強制平倉價。

## 跑起來

純前端但用到 `fetch` 載入 `data/multipliers.json`（ES module），**必須用 http server 開啟，不能直接 `file://`**：

```bash
cd ~/Code/futures-leverage-calc
python3 -m http.server 8000
# 開 http://localhost:8000
```

## 資料來源與 CORS

保證金來自期交所兩頁：
- 指數類 <https://www.taifex.com.tw/cht/5/indexMarging>
- 股票類 <https://www.taifex.com.tw/cht/5/stockMargining>

瀏覽器直接抓會被 CORS 擋，故透過公開 proxy（allorigins / corsproxy）轉。**附帶好處**：期交所看到 proxy IP，你的 IP 不會被黑名單。

> ⚠ 公開 proxy 可能不穩或限流。掛掉時用標題列「**手動貼上**」：開上面兩個頁面、檢視原始碼貼進去，解析邏輯相同。

## 兩種保證金制度（核心）

| 類別 | 制度 | 槓桿公式 |
|---|---|---|
| 個股期貨 | 百分比（原始/維持為契約價值比例） | **1 / 原始比例**（與價格無關） |
| 指數 / ETF 期貨 | 固定金額（每口 NTD） | **契約價值 / 原始保證金**（需成本×乘數） |

- 個股 1 口＝2000 股（小型 100 股）。
- 指數/ETF 算槓桿需**契約乘數**，期交所頁不提供 → 內建 `data/multipliers.json`（大台 200／小台 50／微台 10／電子 4000／金融 1000／非金電 100…）；其餘（中型100、櫃買、外國指數等 FX 計價）乘數留空，加入庫存時可**手動覆寫**。

## 已知限制

- 保證金為**單式相加，未計入 SPAN 組合保證金抵減** → 實際所需可能更低（介面有標註）。
- 不含股票/ETF 選擇權。
- Fugle 即時報價的 endpoint 與合約代碼（如 `TXFG5` 近月）請對照官方文件確認：<https://developer.fugle.tw/docs/data-futopt/intro/>。`js/fugle.js` 依 Fugle marketdata REST 型態實作，欄位若不符在該檔調整。
- 保證金每季調整，逾 90 天未更新會提示。

## 結構

```
index.html            單頁 UI
css/styles.css
js/store.js           localStorage CRUD
js/calc.js            槓桿/保證金公式（純函式）
js/taifex.js          proxy 抓取 + DOMParser 解析
js/fugle.js           （選配）即時報價
js/app.js             進入點、render、事件
data/multipliers.json 契約乘數/股數對照
```

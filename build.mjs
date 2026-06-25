// build.mjs — 把多檔 ES module 專案打包成單一可分享的靜態 HTML。
// 用法：node build.mjs  → 產出 dist/leverage-calc.html（雙擊即可開，無需 http server）。
// 作法：inline CSS、串接 JS 模組（去掉 import/export）、把 multipliers.json 內嵌成物件。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('.', import.meta.url).pathname;
const read = (p) => readFileSync(root + p, 'utf8');

// 去掉 import 行與 export 關鍵字，讓各模組合併到同一個 <script> 作用域。
const strip = (js) =>
  js
    .split('\n')
    .filter((l) => !/^\s*import\s/.test(l))
    .join('\n')
    .replace(/^export\s+/gm, '');

let app = read('js/app.js');
// 內嵌 multipliers.json（取代執行期 fetch），雙擊 file:// 也能跑。
const multi = read('data/multipliers.json').trim();
app = app.replace(
  "MULTI = await (await fetch('data/multipliers.json')).json();",
  `MULTI = ${multi};`,
);

const modules = ['js/store.js', 'js/calc.js', 'js/fugle.js', 'js/taifex.js', 'js/simulator.js'];
const bundle = modules.map(read).map(strip).join('\n\n') + '\n\n' + strip(app);

let html = read('index.html');
html = html.replace(
  '<link rel="stylesheet" href="css/styles.css" />',
  `<style>\n${read('css/styles.css')}\n</style>`,
);
html = html.replace(
  '<script type="module" src="js/app.js"></script>',
  `<script>\n${bundle}\n</script>`,
);

mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/leverage-calc.html', html);
console.log(`✓ dist/leverage-calc.html (${(html.length / 1024).toFixed(0)} KB) — 單檔可分享`);

// アイコンの作成：icon.svg → icon-192.png / icon-512.png / apple-touch-icon.png（180）
// sharp は report-pdf の node_modules を使う（このアプリには追加のインストールなし）
const path = require('path');
const sharp = require('C:/Users/user/.claude/tools/report-pdf/node_modules/sharp');
const ROOT = path.join(__dirname, '..');
const svg = path.join(ROOT, 'icon.svg');
(async () => {
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(path.join(ROOT, name));
    console.log('ok', name);
  }
})();

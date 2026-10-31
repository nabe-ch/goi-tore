// アイコンの作成：icon.svg → icon-192.png / icon-512.png / apple-touch-icon.png（180）／ icon.ico（デスクトップのショートカット用）
// sharp は report-pdf の node_modules を使う（このアプリには追加のインストールなし）
const fs = require('fs');
const path = require('path');
const sharp = require('C:/Users/user/.claude/tools/report-pdf/node_modules/sharp');
const ROOT = path.join(__dirname, '..');
const svg = path.join(ROOT, 'icon.svg');
(async () => {
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    await sharp(svg, { density: 300 }).resize(size, size).png().toFile(path.join(ROOT, name));
    console.log('ok', name);
  }
  // ICO（中身はPNG）を組み立てる：ヘッダー6バイト＋項目16バイト×枚数＋画像（実況ノートの make-icon.js と同じ作り）
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) pngs.push(await sharp(svg, { density: 384 }).resize(s, s).png().toBuffer());
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const entries = []; let offset = 6 + 16 * pngs.length;
  pngs.forEach((buf, i) => {
    const e = Buffer.alloc(16); const s = sizes[i];
    e.writeUInt8(s >= 256 ? 0 : s, 0); e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    offset += buf.length; entries.push(e);
  });
  fs.writeFileSync(path.join(ROOT, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
  console.log('ok icon.ico');
})();

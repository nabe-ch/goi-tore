// Claude用：メモの言葉を調べて登録するための道具（データの置き場所：C:\Users\user\Desktop\code\goi-tore-words\data.json）
// 使い方：
//   node tools/apply.js list            … GitHubから最新を取り、メモを「調べる必要あり／登録済み・調べ済み（調べずに消す）」に分けて表示
//   node tools/apply.js add <file.json> … 調べた結果（[{word, reading, meaning, example, related:[2つ], lines:[2つ], category, source}]）を登録し、
//                                          登録した言葉と、登録済み・調べ済みの言葉をメモから消して、GitHubへ送る
//   node tools/apply.js update <file.json> … 登録済みの言葉に項目を足す（[{word, related, lines, ...}]。指定した項目だけ上書き）
// 注意：始める前に必ず GitHub の最新にそろえる（このパソコンの取り込み先には、独自の変更を置かない運用）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_DIR = 'C:\\Users\\user\\Desktop\\code\\goi-tore-words';
const FILE = path.join(DATA_DIR, 'data.json');
const CATS = ['心理学', '生活', '漫画', '歴史', '最新技術', 'ことわざ・慣用句', '科学', 'ゲーム', 'スポーツ', '食べ物', 'その他'];
const norm = (s) => String(s || '').normalize('NFKC').trim().toLowerCase();
const git = (...a) => execFileSync('git', ['-C', DATA_DIR, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hasRemote = () => { try { return !!git('remote', 'get-url', 'origin'); } catch (e) { return false; } };

// GitHubの最新にそろえる（アプリからの変更を取り込む）
function sync() {
  if (!hasRemote()) return;
  git('fetch', 'origin');
  git('reset', '--hard', 'origin/main');
}
const read = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const write = (d) => { d.updatedAt = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(d, null, 2) + '\n', 'utf8'); };

// 登録済み・過去に調べた言葉かどうか
const known = (d) => new Set([...d.words.map((w) => norm(w.word)), ...(d.researched || []).map(norm)]);

function list() {
  sync();
  const d = read(); const k = known(d);
  const todo = d.memo.filter((m) => !k.has(norm(m.word)));
  const skip = d.memo.filter((m) => k.has(norm(m.word)));
  console.log(JSON.stringify({ todo: todo.map((m) => m.word), skip: skip.map((m) => m.word), words: d.words.length }, null, 2));
}

function add(file) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    sync();
    const d = read(); d.researched = d.researched || [];
    const k = known(d);
    const added = [], dup = [];
    for (const e of entries) {
      if (!e.word || !e.meaning) throw new Error('word と meaning は必須: ' + JSON.stringify(e));
      if (!CATS.includes(e.category)) throw new Error('大項目が一覧にありません: ' + e.category);
      if (!Array.isArray(e.related) || e.related.length !== 2) throw new Error('related（一緒に話せる言葉）は2つ: ' + e.word);
      if (!Array.isArray(e.lines) || e.lines.length !== 2) throw new Error('lines（ユニークな言い回し）は2つ: ' + e.word);
      if (k.has(norm(e.word))) { dup.push(e.word); continue; }
      d.words.push({ id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), word: e.word.trim(), reading: (e.reading || '').trim(), meaning: e.meaning.trim(), example: (e.example || '').trim(), related: e.related, lines: e.lines, category: e.category, source: (e.source || '').trim(), uses: [], createdAt: new Date().toISOString() });
      d.researched.push(e.word.trim()); k.add(norm(e.word)); added.push(e.word);
    }
    // メモから消す：今回登録した言葉＋登録済み・調べ済みの言葉（調べ直さない）
    const before = d.memo.map((m) => m.word);
    d.memo = d.memo.filter((m) => !k.has(norm(m.word)));
    const removed = before.filter((w) => !d.memo.some((m) => m.word === w));
    write(d);
    if (!hasRemote()) { console.log(JSON.stringify({ added, dup, removedFromMemo: removed, pushed: false }, null, 2)); return; }
    git('add', 'data.json');
    git('commit', '-m', `語彙とれ：${added.length}語を登録（メモから${removed.length}件削除）`);
    try { git('push', 'origin', 'HEAD:main'); console.log(JSON.stringify({ added, dup, removedFromMemo: removed, pushed: true }, null, 2)); return; }
    catch (e) { console.log('送信がぶつかったので、最新を取り直してやり直します'); }
  }
  throw new Error('3回やり直しても送れませんでした');
}

function update(file) {
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 3; attempt++) {
    sync();
    const d = read(); const done = [];
    for (const e of entries) {
      const w = d.words.find((x) => norm(x.word) === norm(e.word));
      if (!w) throw new Error('登録されていません: ' + e.word);
      for (const k of Object.keys(e)) if (k !== 'word' && k !== 'id') w[k] = e[k];
      done.push(w.word);
    }
    write(d);
    if (!hasRemote()) { console.log(JSON.stringify({ updated: done, pushed: false })); return; }
    git('add', 'data.json');
    git('commit', '-m', `語彙とれ：${done.length}語に項目を追加`);
    try { git('push', 'origin', 'HEAD:main'); console.log(JSON.stringify({ updated: done, pushed: true })); return; }
    catch (e) { console.log('送信がぶつかったので、最新を取り直してやり直します'); }
  }
  throw new Error('3回やり直しても送れませんでした');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'list') list();
else if (cmd === 'add' && arg) add(arg);
else if (cmd === 'update' && arg) update(arg);
else console.log('使い方: node tools/apply.js list | add <file.json> | update <file.json>');

// 語彙とれ：実況で使える言葉を集めて、一覧で見て、意味から言葉を当てる練習をするアプリ
// - データは1つのJSONファイル（data.json）。公開のGitHubリポジトリ goi-tore-words に置き、PCとスマホで同じものを使う
// - 合い鍵（GitHubのトークン）を入れた端末は、読み書きできる。合い鍵なしの端末は「見るだけ」（データのリポジトリは公開）。スマホへは、PCの設定画面のQRで渡せる（2026-11-02 ユーザー決定）
// - 書き込みは「最新を読む → 変更を当てる → sha（版の番号）つきで保存」。ほかの端末と同時に保存してぶつかったら、読み直してやり直す
'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 同じ言葉かどうかの比較用（全角・半角や前後の空白の違いをそろえる）
const norm = (s) => String(s || '').normalize('NFKC').trim().toLowerCase();

const DEFAULT_CATEGORIES = ['心理学', '生活', '漫画', '歴史', '最新技術', 'ことわざ・慣用句', '科学', 'ゲーム', 'スポーツ', '食べ物', 'その他'];
const emptyData = () => ({ version: 1, updatedAt: '', categories: DEFAULT_CATEGORIES.slice(), words: [], memo: [], phrases: [], researched: [] });

// ---------- 設定（端末ごと） ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても続ける */ } },
};
// データの置き場所は公開の goi-tore-words（2026-10-31に、非公開の goi-tore-data から移した。古い設定は読み替える）
const cfg = () => { const c = LS.get('goiCfg', { owner: 'nabe-ch', repo: 'goi-tore-words', path: 'data.json', token: '' }); if (c.repo === 'goi-tore-data') c.repo = 'goi-tore-words'; return c; };
const isCloud = () => !!cfg().token;

// ---------- GitHub とのやりとり ----------
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function apiUrl() { const c = cfg(); return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path}`; }
function headers() {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (cfg().token) h.Authorization = `Bearer ${cfg().token}`;
  return h;
}
// 保存の記録に付ける名前とメール（個人のメールアドレスを公開しないため、GitHubの匿名用アドレス）
const AUTHOR = { name: 'nabe-ch', email: 'nabe-ch@users.noreply.github.com' };

// 合い鍵なしの読み込み先。APIは同じ回線で1時間60回までなので、回数の上限がない公開ファイルの配信を使う（更新の反映は最大5分ほど遅れる）
function rawUrl() { const c = cfg(); return `https://raw.githubusercontent.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/main/${c.path}`; }

// 読み込み：{ data, sha }。合い鍵なしでも、公開のデータを読む
async function load() {
  if (!isCloud()) {
    const r = await fetch(rawUrl(), { cache: 'no-store' });
    if (r.status === 404) throw new Error('データが読めません。設定のユーザー名・リポジトリ名を確認してください');
    if (!r.ok) throw new Error('読み込みに失敗しました（' + r.status + '）');
    return { data: { ...emptyData(), ...(await r.json()) }, sha: null };
  }
  const r = await fetch(apiUrl() + '?t=' + Date.now(), { headers: headers(), cache: 'no-store' });
  // 404：リポジトリが無い、または合い鍵にこのリポジトリの権限が無い（GitHubは権限が無いときも404を返す）
  if (r.status === 404) throw new Error('データが読めません。合い鍵で「goi-tore-words」を選んでいるか、設定のユーザー名・リポジトリ名を確認してください');
  if (r.status === 401) throw new Error('合い鍵が正しくないか、期限切れです');
  if (r.status === 403 || r.status === 429) throw new Error('合い鍵に読み取りの権限がありません（Contents）');
  if (!r.ok) throw new Error('読み込みに失敗しました（' + r.status + '）');
  const j = await r.json();
  return { data: { ...emptyData(), ...JSON.parse(b64ToUtf8(j.content)) }, sha: j.sha };
}

// 変更：mutate(data) を最新のデータに当てて保存。ぶつかったら3回までやり直す
async function change(mutate, message) {
  if (!isCloud()) throw new Error('この端末は見るだけです。追加・変更は、合い鍵を入れた端末で行ってください');
  for (let i = 0; i < 3; i++) {
    const { data, sha } = await load();
    const result = mutate(data);
    if (result === false) { state.data = data; render(); return false; } // 変更なし
    data.updatedAt = new Date().toISOString();
    const body = { message: message || '語彙とれ：更新', content: utf8ToB64(JSON.stringify(data, null, 2)), author: AUTHOR, committer: AUTHOR };
    if (sha) body.sha = sha;
    const r = await fetch(apiUrl(), { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { state.data = data; LS.set('goiCache', data); render(); setStatus(); return true; }
    if (r.status === 403 || r.status === 404) throw new Error('保存できません。合い鍵の権限を「Contents：Read and write」にしてください');
    if (r.status === 401) throw new Error('合い鍵が正しくないか、期限切れです');
    if (r.status !== 409 && r.status !== 422) throw new Error('保存に失敗しました（' + r.status + '）');
  }
  throw new Error('ほかの端末と同時に保存されたため、保存できませんでした。もう一度お試しください');
}

// ---------- 画面の状態 ----------
const state = {
  view: 'list', data: LS.get('goiCache', null) || emptyData(), q: '', cat: 'all', sort: 'new', open: null,
  quiz: { cat: 'all', id: null, shown: false }, loading: false, error: '',
  drafts: {}, composing: false, pendingRender: false, qrUntil: 0, qrTimer: null,
};

// ---------- 合い鍵のQR（スマホへ渡す） ----------
const QR_MS = 60000;
// 録画・配信に映らないよう、ボタンを押したときだけ、60秒だけ表示する。QRはこの端末の中で作り、外へは送らない
function showQr() {
  if (!confirm('録画・配信・画面共有を止めていますか？\nQRが映ると、合い鍵を読み取られます。')) return;
  state.qrUntil = Date.now() + QR_MS;
  clearTimeout(state.qrTimer);
  state.qrTimer = setTimeout(hideQr, QR_MS);
  render();
}
function hideQr() {
  if (!state.qrUntil) return;
  state.qrUntil = 0;
  clearTimeout(state.qrTimer);
  render();
}
function qrSvg() {
  const q = qrcode(0, 'M');
  q.addData(cfg().token, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function setStatus(text) {
  $('#status').textContent = text || (isCloud() ? `同期中のデータ（${(state.data.updatedAt || '').slice(5, 16).replace('T', ' ') || '—'}）` : '見るだけ（合い鍵なし）');
}
async function refresh(silent) {
  try {
    state.loading = true; if (!silent) setStatus('読み込み中…');
    const { data } = await load();
    state.data = data; state.error = '';
    LS.set('goiCache', data);
  } catch (e) { state.error = e.message; }
  state.loading = false; setStatus(state.error ? '⚠ ' + state.error : ''); render();
}
async function run(fn) {
  try { await fn(); } catch (e) { toast(e.message || '失敗しました'); setStatus('⚠ ' + (e.message || '')); }
}

// ---------- 画面 ----------
const INPUTS = ['q', 'mWord', 'pText'];
function render() {
  if (state.composing) { state.pendingRender = true; return; }
  const a = document.activeElement;
  const keep = a && INPUTS.includes(a.id) ? { id: a.id, start: a.selectionStart, end: a.selectionEnd } : null;
  INPUTS.filter((id) => id !== 'q').forEach((id) => { const el = document.getElementById(id); if (el) state.drafts[id] = el.value; });
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.view));
  const memoBtn = document.querySelector('#tabs button[data-v="memo"]');
  memoBtn.innerHTML = 'メモ' + (state.data.memo.length ? `<span class="cnt">${state.data.memo.length}</span>` : '');
  const v = { list: viewList, quiz: viewQuiz, memo: viewMemo, phrases: viewPhrases, settings: viewSettings }[state.view];
  $('#app').innerHTML = v();
  bind();
  INPUTS.filter((id) => id !== 'q').forEach((id) => { const el = document.getElementById(id); if (el && state.drafts[id]) el.value = state.drafts[id]; });
  if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch (e) { /* 検索欄など、位置を指定できない入力欄 */ } } }
}

function filtered() {
  const q = norm(state.q);
  let ws = state.data.words.filter((w) => (state.cat === 'all' || w.category === state.cat) && (!q || norm(w.word + ' ' + (w.reading || '') + ' ' + w.meaning).includes(q)));
  if (state.sort === 'new') ws.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (state.sort === 'kana') ws.sort((a, b) => (a.reading || a.word).localeCompare(b.reading || b.word, 'ja'));
  // ジャンル別：大項目の並びの順に。同じ大項目の中は新しい順
  if (state.sort === 'genre') {
    const rank = (w) => { const i = state.data.categories.indexOf(w.category || 'その他'); return i < 0 ? state.data.categories.length : i; };
    ws.sort((a, b) => rank(a) - rank(b) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  return ws;
}
// 一覧の行。ジャンル別のときは、大項目ごとに見出しを入れる
function wordRows(ws) {
  if (state.sort !== 'genre') return ws.map(wordItem).join('');
  const genre = (w) => w.category || 'その他';
  return ws.map((w, i) => (i === 0 || genre(ws[i - 1]) !== genre(w) ? `<li class="w-group">${esc(genre(w))}<i>${ws.filter((x) => genre(x) === genre(w)).length}語</i></li>` : '') + wordItem(w)).join('');
}
function chips(cur, attr) {
  const count = (c) => state.data.words.filter((w) => w.category === c).length;
  const cats = state.data.categories.filter((c) => count(c) > 0 || cur === c);
  return `<div class="chips"><button ${attr}="all" class="${cur === 'all' ? 'on' : ''}">すべて<i>${state.data.words.length}</i></button>${cats.map((c) => `<button ${attr}="${esc(c)}" class="${cur === c ? 'on' : ''}">${esc(c)}<i>${count(c)}</i></button>`).join('')}</div>`;
}

function viewList() {
  const ws = filtered();
  return `<div class="card">
    <h2>語彙の一覧</h2>
    <div class="row search"><input type="search" id="q" placeholder="言葉・意味で探す" value="${esc(state.q)}">
      <select id="sort" style="flex:0 0 auto;width:auto"><option value="new">新しい順</option><option value="kana">あいうえお順</option><option value="genre">ジャンル別</option></select></div>
    ${chips(state.cat, 'data-cat')}
    <div class="count">${ws.length}語${state.cat !== 'all' || state.q ? ` / 全${state.data.words.length}語` : ''}</div>
    <ul class="words">${ws.length ? wordRows(ws) : `<li class="empty">${state.data.words.length ? '当てはまる言葉がありません' : 'まだ言葉がありません。「メモ」に言葉を入れて、Claudeに「語彙とれのメモを調べて」と頼んでください'}</li>`}</ul>
  </div>`;
}
function wordItem(w) {
  const open = state.open === w.id;
  return `<li data-open="${esc(w.id)}">
    <div class="w-head"><span class="w-word">${esc(w.word)}</span>${w.reading ? `<span class="w-read">${esc(w.reading)}</span>` : ''}<span class="tag">${esc(w.category || 'その他')}</span><span class="w-used"><span class="w-arrow">${open ? '▲' : '▼'}</span></span></div>
    <div class="w-mean">${esc(w.meaning)}</div>
    ${open ? `<div class="w-detail" data-stop="1">
      ${w.example ? `<div class="note">実況での使い方</div><div class="ex">${esc(w.example)}</div>` : ''}
      ${(w.related || []).length ? `<div class="note">一緒に話せる言葉</div><ul class="pair">${w.related.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${(w.lines || []).length ? `<div class="note">ユニークな言い回し</div><ul class="pair">${w.lines.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="uses">${(w.uses || []).length ? '使った動画：' + w.uses.slice(-5).reverse().map((u) => `${esc(u.date)} ${esc(u.video)}`).join('／') : 'まだ動画で使っていません'}</div>
      ${w.source ? `<div class="note">意味の出典：${esc(w.source)}</div>` : ''}
      ${isCloud() ? '' : '<div class="note">「動画で使った」の記録・修正は、合い鍵を入れた端末で行えます</div>'}
      ${isCloud() ? `<div class="acts"><button class="btn red sm" data-use="${esc(w.id)}">動画で使った</button><button class="btn sm" data-edit="${esc(w.id)}">直す</button><button class="btn sm ghost" data-del="${esc(w.id)}">削除</button></div>` : ''}
    </div>` : ''}
  </li>`;
}

function viewQuiz() {
  const pool = state.data.words.filter((w) => state.quiz.cat === 'all' || w.category === state.quiz.cat);
  let w = pool.find((x) => x.id === state.quiz.id);
  if (!w && pool.length) { w = pick(pool); state.quiz.id = w.id; state.quiz.shown = false; }
  return `<div class="card">
    <h2>練習：意味から言葉を当てる</h2>
    <p class="sub">意味を読んで、言葉を思い浮かべてから「答えを見る」。実況中に「この状況を表す言葉は？」とすぐ出せるようにする練習です</p>
    ${chips(state.quiz.cat, 'data-qcat')}
    ${w ? `<div class="quiz">
      <div class="q">${esc(w.meaning)}</div>
      ${state.quiz.shown ? `<div class="a">${esc(w.word)}</div>${w.reading ? `<div class="w-read">${esc(w.reading)}</div>` : ''}${w.example ? `<div class="ex" style="text-align:left;margin:12px auto;max-width:560px;border-left:3px solid var(--red);padding-left:10px">${esc(w.example)}</div>` : ''}` : ''}
      <div class="acts">${state.quiz.shown ? '<button class="btn red" id="qNext">次の問題</button>' : '<button class="btn red" id="qShow">答えを見る</button><button class="btn" id="qNext">とばす</button>'}</div>
    </div>` : '<div class="empty">言葉が登録されると、練習できます</div>'}
  </div>`;
}
function pick(pool) { return pool[Math.floor(Math.random() * pool.length)]; }

function viewMemo() {
  return `<div class="card">
    <h2>追加してほしい言葉（メモ）</h2>
    <p class="sub">言葉だけ入れてください。意味・大項目・例文は、Claudeに「語彙とれのメモを調べて」と頼んだときに調べて登録し、メモから消します</p>
    ${isCloud() ? '' : '<div class="warnbox">この端末は<b>見るだけ</b>です。追加するには、「設定」で合い鍵を入れてください（PCの設定画面のQRで渡せます）。</div>'}
    ${!isCloud() ? '' : `<div class="row"><input type="text" id="mWord" placeholder="例：目から鱗" maxlength="60" enterkeyhint="done"><button class="btn red" id="mAdd" style="flex:0 0 auto">追加</button></div>`}
    <ul class="memo">${state.data.memo.length ? state.data.memo.slice().reverse().map((m) => `<li><span>${esc(m.word)}</span><small>${esc((m.addedAt || '').slice(5, 10).replace('-', '/'))}</small>${isCloud() ? `<button class="icon" data-mdel="${esc(m.id)}" title="メモから消す">✕</button>` : ''}</li>`).join('') : '<li class="empty" style="justify-content:center">メモは空です</li>'}</ul>
  </div>`;
}

// 思いついた言い回しを、そのまま残すだけのページ（Claudeは調べない）
function viewPhrases() {
  const ps = state.data.phrases || [];
  return `<div class="card">
    <h2>使いたい言い回し（メモ）</h2>
    <p class="sub">思いついた言い回しを、そのまま残すページです。Claudeは調べません。データは公開なので、個人情報は書かないでください</p>
    ${isCloud() ? `<div class="row"><input type="text" id="pText" placeholder="例：弾の使い方が、給料日前の財布" maxlength="200" enterkeyhint="done"><button class="btn red" id="pAdd" style="flex:0 0 auto">追加</button></div>` : '<div class="warnbox">この端末は<b>見るだけ</b>です。追加するには、「設定」で合い鍵を入れてください（PCの設定画面のQRで渡せます）。</div>'}
    <ul class="memo">${ps.length ? ps.slice().reverse().map((p) => `<li><span>${esc(p.text)}</span><small>${esc((p.addedAt || '').slice(5, 10).replace('-', '/'))}</small>${isCloud() ? `<button class="icon" data-pdel="${esc(p.id)}" title="消す">✕</button>` : ''}</li>`).join('') : '<li class="empty" style="justify-content:center">まだありません</li>'}</ul>
  </div>`;
}

function viewSettings() {
  const c = cfg();
  return `<div class="card">
    <h2>同期の設定（この端末）</h2>
    ${isCloud() ? '' : '<div class="warnbox">この端末は<b>見るだけ</b>です（一覧・練習・メモの確認ができます）。追加・変更をするには、下に合い鍵（GitHubのトークン「goitore」）を貼り付けてください。PCの設定画面のQRで渡せます。</div>'}
    <label class="f">GitHubのユーザー名</label><input type="text" id="sOwner" value="${esc(c.owner)}" autocomplete="off">
    <label class="f">データを置くリポジトリ（公開）</label><input type="text" id="sRepo" value="${esc(c.repo)}" autocomplete="off">
    <label class="f">合い鍵（GitHubのトークン。このリポジトリの「Contents：読み書き」だけを許可したもの）</label>
    <input type="password" id="sToken" value="" placeholder="${c.token ? '設定済み（変えるときだけ入力）' : '未設定'}" autocomplete="off">
    <div class="row" style="margin-top:12px"><button class="btn red" id="sSave">保存して読み込む</button>${c.token ? '<button class="btn ghost" id="sClear">合い鍵を消す</button>' : ''}</div>
    <p class="note">合い鍵はこの端末のブラウザの中にだけ保存され、アプリの公開ページには含まれません。</p>
  </div>
  ${!isCloud() ? '' : `<div class="card">
    <h2>スマホに合い鍵を渡す</h2>
    ${state.qrUntil ? `<div class="qrbox">${qrSvg()}</div>
    <ol class="note"><li>スマホのカメラでQRを読み、出てきた文字をコピーする</li><li>スマホの語彙とれの「設定」で、合い鍵の欄に貼り付ける</li><li>「保存して読み込む」を押す</li></ol>
    <p class="note">60秒で消えます。</p>
    <button class="btn" id="sQrHide">QRを消す</button>` : `<p class="note">QRは押したときだけ、60秒表示します。録画・配信中は使わないでください。</p>
    <button class="btn" id="sQr">QRを表示する</button>`}
  </div>`}
  <div class="card">
    <h2>データ</h2>
    <p class="note">言葉 ${state.data.words.length}語／メモ ${state.data.memo.length}件／最終更新 ${esc((state.data.updatedAt || '—').replace('T', ' ').slice(0, 16))}</p>
    <div class="row"><button class="btn" id="dReload">いま読み込み直す</button><button class="btn" id="dExport">ファイルに書き出す（バックアップ）</button></div>
  </div>`;
}

// ---------- 操作 ----------
// 保存は順番に行う（続けて追加しても、ぶつからないように）
let saveChain = Promise.resolve();
const enqueue = (fn) => { saveChain = saveChain.then(() => run(fn)); return saveChain; };
// 保存に失敗したら、消えないように入力欄へ戻す
const giveBack = (id, text) => { const el = document.getElementById(id); if (el && !el.value) el.value = text; else if (!el) state.drafts[id] = text; };
// Enterかどうか。日本語の変換を確定するEnterは除く（keyCode 229 は変換中のキー）
const isEnter = (e) => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
function bind() {
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
  on('#q', 'oninput', (e) => { state.q = e.target.value; render(); });
  const sort = $('#sort'); if (sort) { sort.value = state.sort; sort.onchange = (e) => { state.sort = e.target.value; render(); }; }
  document.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { state.cat = b.dataset.cat; render(); });
  document.querySelectorAll('[data-qcat]').forEach((b) => b.onclick = () => { state.quiz.cat = b.dataset.qcat; state.quiz.id = null; render(); });
  document.querySelectorAll('[data-open]').forEach((li) => li.onclick = (e) => {
    if (e.target.closest('[data-stop]')) return;
    state.open = state.open === li.dataset.open ? null : li.dataset.open; render();
  });
  document.querySelectorAll('[data-use]').forEach((b) => b.onclick = () => run(async () => {
    const video = prompt('どの動画で使いましたか？（例：救助隊DX ＃3）', '');
    if (video === null) return;
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    await change((d) => { const w = d.words.find((x) => x.id === b.dataset.use); if (!w) return false; (w.uses = w.uses || []).push({ date: day, video: video.trim().slice(0, 60) }); }, '使った記録');
    toast('記録しました');
  }));
  document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => run(async () => {
    const w = state.data.words.find((x) => x.id === b.dataset.edit); if (!w) return;
    const meaning = prompt('意味', w.meaning); if (meaning === null) return;
    const example = prompt('実況での使い方の例文', w.example || ''); if (example === null) return;
    const category = prompt('大項目（' + state.data.categories.join('・') + '）', w.category || 'その他'); if (category === null) return;
    await change((d) => { const x = d.words.find((y) => y.id === w.id); if (!x) return false; x.meaning = meaning.trim(); x.example = example.trim(); x.category = d.categories.includes(category.trim()) ? category.trim() : x.category; }, '言葉の修正');
    toast('直しました');
  }));
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => run(async () => {
    const w = state.data.words.find((x) => x.id === b.dataset.del); if (!w || !confirm(`「${w.word}」を削除しますか？`)) return;
    await change((d) => { const n = d.words.length; d.words = d.words.filter((x) => x.id !== w.id); if (d.words.length === n) return false; }, '言葉の削除');
    state.open = null; toast('削除しました');
  }));
  on('#qShow', 'onclick', () => { state.quiz.shown = true; render(); });
  on('#qNext', 'onclick', () => { state.quiz.id = null; render(); });
  const takeInput = (id) => { const i = document.getElementById(id); const v = i ? i.value.trim() : ''; if (i) { i.value = ''; i.focus(); } state.drafts[id] = ''; return v; };
  const addMemo = () => {
    const word = takeInput('mWord').slice(0, 60); if (!word) return;
    const k = norm(word);
    if (state.data.words.some((w) => norm(w.word) === k)) { toast(`「${word}」は登録済みです（一覧にあります）`); return; }
    toast('保存しています…');
    enqueue(async () => {
      let dup = false;
      try { await change((d) => { if (d.memo.some((m) => norm(m.word) === k)) { dup = true; return false; } d.memo.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), word, addedAt: new Date().toISOString() }); }, 'メモの追加'); }
      catch (e) { giveBack('mWord', word); throw e; }
      toast(dup ? 'すでにメモにあります' : `「${word}」を入れました`);
    });
  };
  on('#mAdd', 'onclick', addMemo);
  on('#mWord', 'onkeydown', (e) => { if (isEnter(e)) addMemo(); });
  const addPhrase = () => {
    const text = takeInput('pText').slice(0, 200); if (!text) return;
    toast('保存しています…');
    enqueue(async () => {
      try { await change((d) => { d.phrases = d.phrases || []; d.phrases.push({ id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, addedAt: new Date().toISOString() }); }, '言い回しの追加'); }
      catch (e) { giveBack('pText', text); throw e; }
      toast('言い回しを入れました');
    });
  };
  on('#pAdd', 'onclick', addPhrase);
  on('#pText', 'onkeydown', (e) => { if (isEnter(e)) addPhrase(); });
  document.querySelectorAll('[data-pdel]').forEach((b) => b.onclick = () => enqueue(async () => {
    await change((d) => { const n = (d.phrases || []).length; d.phrases = (d.phrases || []).filter((p) => p.id !== b.dataset.pdel); if (d.phrases.length === n) return false; }, '言い回しの削除');
  }));
  document.querySelectorAll('[data-mdel]').forEach((b) => b.onclick = () => run(async () => {
    await change((d) => { const n = d.memo.length; d.memo = d.memo.filter((m) => m.id !== b.dataset.mdel); if (d.memo.length === n) return false; }, 'メモの削除');
  }));
  on('#sSave', 'onclick', () => {
    const c = cfg(); const t = $('#sToken').value.trim();
    LS.set('goiCfg', { ...c, owner: $('#sOwner').value.trim() || c.owner, repo: $('#sRepo').value.trim() || c.repo, token: t || c.token });
    toast('保存しました'); refresh();
  });
  on('#sClear', 'onclick', () => { if (!confirm('この端末の合い鍵を消しますか？（データは消えません。見るだけになります）')) return; LS.set('goiCfg', { ...cfg(), token: '' }); state.qrUntil = 0; clearTimeout(state.qrTimer); toast('消しました'); refresh(); });
  on('#sQr', 'onclick', showQr);
  on('#sQrHide', 'onclick', hideQr);
  on('#dReload', 'onclick', () => refresh());
  on('#dExport', 'onclick', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' }));
    a.download = `goi-tore_${new Date().toLocaleDateString('sv-SE')}.json`; a.click();
  });
}

document.querySelectorAll('#tabs button').forEach((b) => b.onclick = () => { state.view = b.dataset.v; state.qrUntil = 0; clearTimeout(state.qrTimer); render(); });
document.addEventListener('compositionstart', () => { state.composing = true; });
document.addEventListener('compositionend', () => { state.composing = false; if (state.pendingRender || document.activeElement?.id === 'q') { state.pendingRender = false; const q = $('#q'); if (q) state.q = q.value; render(); } });
// ほかの端末で変わっていれば反映する（画面に戻ったとき・1分ごと）
document.addEventListener('visibilitychange', () => { if (document.hidden) hideQr(); else refresh(true); });
setInterval(() => { if (!document.hidden && isCloud()) refresh(true); }, 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
setStatus(); render(); refresh();

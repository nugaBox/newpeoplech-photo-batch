// 공동체 앨범(PHOTO) 전체 게시글을 읽기 전용으로 수집해 로컬 행사 폴더와 비교한다. 게시판은 변경하지 않는다.
// 결과: board-audit.json
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { scanFolders, loadConfig } = require('./scanFolders');
const { collectPhotosFromFolder } = require('./lib/photoFiles');
const { loginToBoard } = require('./lib/boardAuth');

const BASE = 'https://www.newpeoplech.com';
const LIST_URL = `${BASE}/boardList.do?boardId=PHOTO&pageId=www37`;

const norm = (n) => n.normalize('NFC').toLowerCase();

async function collectPostUrls(page) {
  const seqs = new Map();
  await gotoWithRetry(page, LIST_URL);
  const text = await page.innerText('body');
  const total = Number(text.match(/전체게시글\s*:\s*(\d+)/)[1]);
  const pages = Number(text.match(/전체페이지\s*:\s*(\d+)/)[1]);
  for (let n = 1; n <= pages; n++) {
    await gotoWithRetry(page, `${LIST_URL}&movePage=${n}&recordCnt=9`);
    const hrefs = await page.$$eval('a[href*="boardView.do"]', (as) => as.map((a) => a.getAttribute('href')));
    for (const h of hrefs) {
      const seq = new URL(h, BASE).searchParams.get('seq');
      if (seq && !seqs.has(seq)) seqs.set(seq, new URL(h, BASE).href);
    }
    await page.waitForTimeout(150);
  }
  return { total, urls: [...seqs.entries()] };
}

async function gotoWithRetry(page, url) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await page.waitForTimeout(3000);
    }
  }
}

async function readPost(page, seq, url) {
  await gotoWithRetry(page, url);
  const text = await page.innerText('body');
  const before = text.split('작성자 :')[0].trim().split('\n').map((s) => s.trim()).filter(Boolean);
  const date = (text.match(/행사일자\s*\n?\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const regDt = (text.match(/작성일 : (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/) || [])[1] || null;
  const files = await page.$$eval('a[href*="fileDownload.do"]', (as) =>
    as.filter((a) => !/action=zip/.test(a.getAttribute('href'))).map((a) => a.innerText.trim())
  );
  const sizes = {};
  for (const m of text.matchAll(/^(.+?) \[size: ([\d.]+) (KB|MB|GB|Bytes?)/gm)) {
    const unit = { KB: 1024, MB: 1048576, GB: 1073741824 }[m[3]] || 1;
    sizes[norm(m[1].trim())] = Number(m[2]) * unit;
  }
  return { seq, title: before[before.length - 1], date, regDt, files, sizes, url };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const items = scanFolders(loadConfig(path.join(root, 'config.json')), root);
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const posts = [];
  let total;
  try {
    await loginToBoard(page, process.env.BOARD_ID, process.env.BOARD_PW);
    await page.route('**/imageView/**', (route) => route.abort());
    const r = await collectPostUrls(page);
    total = r.total;
    console.log(`목록 ${total}건 / 수집 URL ${r.urls.length}건`);
    for (const [seq, url] of r.urls) {
      posts.push(await readPost(page, seq, url));
      if (posts.length % 25 === 0) console.log(`  ${posts.length}건`);
      await page.waitForTimeout(100);
    }
  } finally {
    await browser.close();
  }

  const byKey = new Map();
  for (const p of posts) {
    const k = `${p.date}_${p.title}`.normalize('NFC');
    byKey.set(k, [...(byKey.get(k) || []), p]);
  }
  const result = { total, collected: posts.length, match: [], mismatch: [], missingOnBoard: [], duplicates: [], boardOnly: [], posts };
  const used = new Set();
  for (const it of items) {
    const key = `${it.date}_${it.eventName}`.normalize('NFC');
    const localPaths = collectPhotosFromFolder(it.targetPath).photos;
    const local = localPaths.map((p) => path.basename(p));
    const found = byKey.get(key) || [];
    used.add(key);
    if (found.length > 1) result.duplicates.push({ key, seqs: found.map((p) => p.seq), counts: found.map((p) => p.files.length) });
    if (found.length === 0) {
      result.missingOnBoard.push({ key, localCount: local.length });
      continue;
    }
    const board = found[0].files;
    const bs = new Set(board.map(norm));
    const ls = new Set(local.map(norm));
    const onlyLocal = local.filter((n) => !bs.has(norm(n)));
    const onlyBoard = board.filter((n) => !ls.has(norm(n)));
    // 이름이 같아도 내용이 다를 수 있어 표시 크기를 비교한다 (표시값 반올림 오차 2% 허용)
    const sizeDiff = localPaths
      .filter((p) => found[0].sizes[norm(path.basename(p))] !== undefined)
      .filter((p) => Math.abs(fs.statSync(p).size - found[0].sizes[norm(path.basename(p))]) > fs.statSync(p).size * 0.02)
      .map((p) => path.basename(p));
    const row = { key, seq: found[0].seq, localCount: local.length, boardCount: board.length, onlyLocal, onlyBoard, sizeDiff };
    if (onlyLocal.length || onlyBoard.length || sizeDiff.length || board.length !== local.length) result.mismatch.push(row);
    else result.match.push({ key, seq: found[0].seq, count: local.length });
  }
  for (const [k, ps] of byKey) if (!used.has(k)) result.boardOnly.push(...ps.map((p) => ({ key: k, seq: p.seq, count: p.files.length, regDt: p.regDt })));

  fs.writeFileSync(path.join(root, 'board-audit.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`일치 ${result.match.length} / 불일치 ${result.mismatch.length} / 게시판에 없음 ${result.missingOnBoard.length} / 중복 ${result.duplicates.length} / 폴더 없는 글 ${result.boardOnly.length}`);
}

main().catch((err) => {
  console.error('감사 실패:', err);
  process.exit(1);
});

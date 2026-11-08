// 기존 게시글의 첨부를 로컬 행사 폴더와 일치시킨다 (폴더에 없는 첨부는 삭제, 게시글에 없는 사진은 추가).
// API에 첨부 수정이 없어 관리자 수정 화면을 Playwright로 조작한다. 삭제 전 첨부를 downloads/board-removed/ 에 백업한다.
// 사용: node scripts/syncBoardFiles.js [--dry-run] [--seq <seq>]  (대상은 board-audit.json의 mismatch)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { scanFolders, loadConfig } = require('./scanFolders');
const { collectPhotosFromFolder } = require('./lib/photoFiles');
const { loginToBoard } = require('./lib/boardAuth');

const BASE = 'https://www.newpeoplech.com';
const updateUrl = (seq) => `${BASE}/board.do?action=update&pageId=www37&boardId=PHOTO&seq=${seq}&movePage=1&recordCnt=9`;
const norm = (n) => n.normalize('NFC').toLowerCase();

function parseArgs(argv) {
  const args = { dryRun: false, seq: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--seq' && argv[i + 1]) args.seq = argv[++i];
  }
  return args;
}

async function syncPost(page, context, row, localPhotos, root, args) {
  await page.goto(updateUrl(row.seq), { waitUntil: 'load', timeout: 60000 });
  const existing = await page.$$eval('.fileInfo', (els) =>
    els
      .map((el) => ({
        name: el.querySelector('input[name="fileOldNm[]"]').value,
        href: el.querySelector('.fileView a').getAttribute('href'),
        delId: el.querySelector('input[name="fileDelChk[]"]').id,
      }))
      .filter((f) => f.name) // 첨부가 없는 글의 빈 템플릿 행 제외
  );
  const localNames = new Set(localPhotos.map((p) => norm(path.basename(p))));
  const boardNames = new Set(existing.map((e) => norm(e.name)));
  const toDelete = existing.filter((e) => !localNames.has(norm(e.name)));
  const toAdd = localPhotos.filter((p) => !boardNames.has(norm(path.basename(p))));
  console.log(`${row.key} (seq ${row.seq}): 첨부 ${existing.length}, 삭제 ${toDelete.length}, 추가 ${toAdd.length}`);
  if (args.dryRun || (!toDelete.length && !toAdd.length)) return;

  const backupDir = path.join(root, 'downloads', 'board-removed', `${row.seq}_${row.key.replace(/[\/:*?"<>|]/g, '_')}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const f of toDelete) {
    const res = await context.request.get(new URL(f.href, BASE).href);
    if (!res.ok()) throw new Error(`백업 실패: ${f.name} (${res.status()})`);
    fs.writeFileSync(path.join(backupDir, f.name), await res.body());
    await page.check(`#${f.delId}`);
  }
  for (const p of toAdd) {
    // 첨부가 없는 글은 fileNm0 빈 칸이 이미 있으므로 그 칸부터 쓴다.
    const index = await page.locator('input[type="file"].file').count();
    const slotIsFree = existing.length === 0 && p === toAdd[0];
    if (!slotIsFree) await page.click('button.fileAdd');
    const slot = slotIsFree ? 0 : index;
    await page.locator(`input[name="fileNm${slot}"]`).setInputFiles(p);
    await page.locator(`#insrtFile${slot}`).check();
  }
  const delFlags = await page.$$eval('input[name="fileDelAt[]"]', (els) => els.filter((e) => e.value === 'Y').length);
  if (delFlags !== toDelete.length) throw new Error(`삭제 표시 수 불일치: ${delFlags}/${toDelete.length}`);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {}),
    page.locator('input[type="submit"].siiru-btn-primary').click(),
  ]);
  await page.waitForTimeout(1500);
  if (page.url().includes('action=update')) throw new Error('저장 후에도 수정 페이지에 머물러 있습니다.');
}

async function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..');
  const audit = JSON.parse(fs.readFileSync(path.join(root, 'board-audit.json'), 'utf8'));
  const items = scanFolders(loadConfig(path.join(root, 'config.json')), root);
  const rows = audit.mismatch.filter((m) => !args.seq || m.seq === args.seq);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  try {
    await loginToBoard(page, process.env.BOARD_ID, process.env.BOARD_PW);
    for (const row of rows) {
      const item = items.find((it) => `${it.date}_${it.eventName}`.normalize('NFC') === row.key);
      if (!item) throw new Error(`폴더를 찾지 못했습니다: ${row.key}`);
      await syncPost(page, context, row, collectPhotosFromFolder(item.targetPath).photos, root, args);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('동기화 실패:', err);
  process.exit(1);
});

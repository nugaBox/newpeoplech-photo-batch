// work-list.json의 pending 항목을 순회하며 Synology Photos 타임라인에서 날짜별 사진을 "압축 JPEG"로 다운로드한다.
// 실패하거나 사진이 없는 항목은 건너뛰고 계속 진행한다 (전체 중단 금지).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const config = require('../config.json');
const { loginIfNeeded, goToTimeline } = require('./lib/synologyAuth');
const {
  filterToYearMonth,
  scrollGridToLoadAll,
  getItemCount,
  readExactDatesForAllItems,
  selectItemsByDate,
  downloadSelectedCompressed,
  ensureLightboxClosed,
} = require('./lib/timeline');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeForFolderName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

async function processItem(page, item, tempDownloadDir) {
  const [year, month] = item.date.split('-');

  await ensureLightboxClosed(page);
  await filterToYearMonth(page, year, month);
  const count = await scrollGridToLoadAll(page);

  if (count === 0) {
    return { status: 'skipped', reason: 'no_photos_found' };
  }

  const dates = await readExactDatesForAllItems(page, count);
  const matched = await selectItemsByDate(page, dates, item.date);

  if (matched === 0) {
    return { status: 'skipped', reason: `해당 날짜(${item.date}) 사진을 이 달(${year}-${month}) 안에서 찾지 못함` };
  }

  const itemDownloadDir = path.join(tempDownloadDir, `${item.date}_${sanitizeForFolderName(item.eventName)}`);
  fs.mkdirSync(itemDownloadDir, { recursive: true });
  const downloadedPath = await downloadSelectedCompressed(page, itemDownloadDir);

  return { status: 'downloaded', downloadedPath, matchedCount: matched };
}

async function main(yearFilter) {
  const projectRoot = path.resolve(__dirname, '..');
  const workListPath = path.resolve(projectRoot, config.workListFile);
  const tempDownloadDir = path.resolve(projectRoot, config.tempDownloadDir);
  const authProfileDir = path.resolve(projectRoot, config.authProfileDir);
  fs.mkdirSync(tempDownloadDir, { recursive: true });

  const items = JSON.parse(fs.readFileSync(workListPath, 'utf8'));
  const pendingItems = items.filter(
    (i) => i.status === 'pending' && (!yearFilter || i.date.startsWith(yearFilter))
  );

  console.log(`다운로드 대상 ${pendingItems.length}건`);
  if (pendingItems.length === 0) {
    console.log('처리할 pending 항목이 없습니다.');
    return;
  }

  const context = await chromium.launchPersistentContext(authProfileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  const page = context.pages()[0] || (await context.newPage());

  await loginIfNeeded(page);
  await goToTimeline(page);

  let done = 0;
  for (const item of pendingItems) {
    console.log(`[${++done}/${pendingItems.length}] ${item.date} ${item.eventName} 처리 중...`);
    try {
      const result = await processItem(page, item, tempDownloadDir);
      Object.assign(item, result);
      if (result.status === 'downloaded') {
        console.log(`  -> 다운로드 완료: ${result.downloadedPath} (${result.matchedCount}장)`);
      } else {
        console.log(`  -> ${result.status}: ${result.reason}`);
      }
    } catch (err) {
      item.status = 'error';
      item.reason = err.message;
      console.error(`  -> 에러: ${err.message}`);
    }

    fs.writeFileSync(workListPath, JSON.stringify(items, null, 2), 'utf8');
    await sleep(config.requestDelayMs);
  }

  await context.close();
  console.log('downloadByDate.js 완료');
}

if (require.main === module) {
  const yearArg = process.argv.find((a) => a.startsWith('--year='));
  const yearFilter = yearArg ? yearArg.split('=')[1] : undefined;
  main(yearFilter).catch((err) => {
    console.error('downloadByDate.js 실패:', err);
    process.exit(1);
  });
}

module.exports = { processItem, main };

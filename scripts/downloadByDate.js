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
  getVideoFlags,
  readExactDatesForAllItems,
  selectItemsByDate,
  downloadSelectedCompressed,
  ensureLightboxClosed,
} = require('./lib/timeline');

function isBrowserClosedError(err) {
  return /Target page, context or browser has been closed|Target closed|Browser has been closed/.test(err.message);
}

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
  const videoFlags = await getVideoFlags(page);
  const videoCount = videoFlags.filter(Boolean).length;
  const matched = await selectItemsByDate(page, dates, item.date, videoFlags);

  if (videoCount > 0) {
    console.log(`  (동영상 ${videoCount}개는 다운로드에서 제외)`);
  }

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

  let context = await chromium.launchPersistentContext(authProfileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  });
  let page = context.pages()[0] || (await context.newPage());
  await loginIfNeeded(page);
  await goToTimeline(page);

  let done = 0;
  const total = pendingItems.length;
  for (const item of pendingItems) {
    console.log(`[${++done}/${total}] ${item.date} ${item.eventName} 처리 중...`);
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

      // 브라우저/탭 자체가 죽은 경우(장시간 실행 중 크래시 등) 남은 항목이 전부 연쇄 실패하므로
      // 새 브라우저를 띄워 재로그인하고 이어서 진행한다.
      if (isBrowserClosedError(err)) {
        console.log('  브라우저가 종료된 것으로 보여 새로 띄워 이어서 진행합니다...');
        await context.close().catch(() => {});
        context = await chromium.launchPersistentContext(authProfileDir, {
          headless: false,
          viewport: { width: 1440, height: 900 },
          acceptDownloads: true,
        });
        page = context.pages()[0] || (await context.newPage());
        await loginIfNeeded(page);
        await goToTimeline(page);
      }
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

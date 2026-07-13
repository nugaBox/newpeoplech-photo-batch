// 로컬 행사 폴더 사진을 공동체 앨범(PHOTO) 게시판에 순차 업로드한다.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { scanFolders, loadConfig } = require('./scanFolders');
const { collectPhotosFromFolder } = require('./lib/photoFiles');
const { loginToBoard } = require('./lib/boardAuth');

const INSERT_URL =
  'https://www.newpeoplech.com/board.do?action=insert&pageId=www37&boardId=PHOTO&movePage=1&recordCnt=6';
const BOARD_LIST_URL =
  'https://www.newpeoplech.com/boardList.do?boardId=PHOTO&pageId=www37';

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: Infinity,
    testOne: false,
    resume: true,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--test-one') args.testOne = true;
    else if (argv[i] === '--no-resume') args.resume = false;
    else if (argv[i] === '--limit' && argv[i + 1]) args.limit = Number(argv[++i]);
  }
  return args;
}

function loadUploadLog(logPath) {
  if (!fs.existsSync(logPath)) return { uploaded: {}, skipped: {}, errors: {} };
  return JSON.parse(fs.readFileSync(logPath, 'utf8'));
}

function saveUploadLog(logPath, log) {
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
}

function buildEventList(projectRoot, config) {
  const items = scanFolders(config, projectRoot);
  const events = [];

  for (const item of items) {
    const { photos, skipped } = collectPhotosFromFolder(item.targetPath);
    events.push({
      date: item.date,
      eventName: item.eventName,
      targetPath: item.targetPath,
      photos,
      skippedFiles: skipped,
      folderStatus: item.status,
    });
  }

  return events;
}

async function ensureFileSlots(page, count) {
  const current = await page.locator('input[type="file"].file').count();
  for (let i = current; i < count; i++) {
    await page.click('button.fileAdd');
    await page.waitForTimeout(200);
  }
}

async function uploadEvent(page, event) {
  await page.goto(INSERT_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#boardSj');

  await page.fill('#boardSj', event.eventName);
  await page.fill('#etc1', event.date);

  const fileCount = event.photos.length;
  await ensureFileSlots(page, fileCount);

  for (let i = 0; i < fileCount; i++) {
    const fileInput = page.locator(`input[name="fileNm${i}"]`);
    await fileInput.setInputFiles(event.photos[i]);

    const insrtCheckbox = page.locator(`#insrtFile${i}`);
    await insrtCheckbox.check();
    await page.evaluate((idx) => {
      const cb = document.querySelector(`#insrtFile${idx}`);
      const layer = cb?.closest('.fileLayer');
      const hidden = layer?.querySelector('input[name="insrtAt[]"]');
      if (hidden) hidden.value = 'Y';
    }, i);
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 120000 }).catch(() => {}),
    page.locator('input[type="submit"].siiru-btn-primary').click(),
  ]);
  await page.waitForTimeout(1500);

  const url = page.url();
  if (url.includes('action=insert')) {
    throw new Error('저장 후에도 등록 페이지에 머물러 있습니다.');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(__dirname, '..');
  const config = loadConfig(path.join(projectRoot, 'config.json'));
  const logPath = path.join(projectRoot, 'upload-log.json');

  const userId = process.env.BOARD_ID;
  const password = process.env.BOARD_PW;
  if (!userId || !password) {
    throw new Error('.env에 BOARD_ID, BOARD_PW를 설정하세요.');
  }

  const allEvents = buildEventList(projectRoot, config);
  const uploadLog = loadUploadLog(logPath);

  const withPhotos = allEvents.filter((e) => e.photos.length > 0);
  const emptyFolders = allEvents.filter((e) => e.photos.length === 0);

  console.log('=== 공동체 앨범 업로드 ===');
  console.log(`총 행사 폴더: ${allEvents.length}`);
  console.log(`사진 있는 행사: ${withPhotos.length}`);
  console.log(`빈 폴더: ${emptyFolders.length}`);
  console.log(
    `총 유효 사진: ${withPhotos.reduce((n, e) => n + e.photos.length, 0)}`
  );
  console.log(
    `건너뛴 파일(영상/손상): ${withPhotos.reduce((n, e) => n + e.skippedFiles.length, 0)}`
  );

  let targets = withPhotos.filter((e) => {
    const key = `${e.date}_${e.eventName}`;
    return !(args.resume && uploadLog.uploaded[key]);
  });

  if (args.testOne) targets = targets.slice(0, 1);
  if (Number.isFinite(args.limit)) targets = targets.slice(0, args.limit);

  console.log(`이번 실행 대상: ${targets.length}개 행사`);

  if (args.dryRun) {
    for (const e of targets) {
      console.log(`[DRY] ${e.date} | ${e.eventName} | ${e.photos.length}장`);
    }
    return;
  }

  if (targets.length === 0) {
    console.log('업로드할 행사가 없습니다.');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loginToBoard(page, userId, password);
    console.log('로그인 성공');

    for (let i = 0; i < targets.length; i++) {
      const event = targets[i];
      const key = `${event.date}_${event.eventName}`;
      console.log(
        `[${i + 1}/${targets.length}] ${event.date} ${event.eventName} (${event.photos.length}장)`
      );

      try {
        await uploadEvent(page, event);
        uploadLog.uploaded[key] = {
          date: event.date,
          eventName: event.eventName,
          photoCount: event.photos.length,
          skippedFiles: event.skippedFiles,
          uploadedAt: new Date().toISOString(),
        };
        saveUploadLog(logPath, uploadLog);
        console.log('  -> 완료');
      } catch (err) {
        uploadLog.errors[key] = {
          date: event.date,
          eventName: event.eventName,
          error: err.message,
          at: new Date().toISOString(),
        };
        saveUploadLog(logPath, uploadLog);
        console.error(`  -> 실패: ${err.message}`);
      }

      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close();
  }

  const doneCount = Object.keys(uploadLog.uploaded).length;
  const errorCount = Object.keys(uploadLog.errors).length;
  console.log('');
  console.log('=== 업로드 완료 ===');
  console.log(`성공: ${doneCount}, 실패: ${errorCount}`);
  console.log(`로그: ${logPath}`);
}

main().catch((err) => {
  console.error('업로드 스크립트 실패:', err);
  process.exit(1);
});

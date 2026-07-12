// 전체 동기화 파이프라인 통합 실행: (스캔 →) 다운로드 → 압축 해제/이동 → 로그/요약
// --dry-run: 실제 다운로드 없이 대상 목록만 출력
// --only-pending: scanFolders를 다시 돌리지 않고 기존 work-list.json의 pending 항목만 재시도
const fs = require('fs');
const path = require('path');

const config = require('../config.json');
const { scanFolders, loadConfig } = require('./scanFolders');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    onlyPending: args.includes('--only-pending'),
  };
}

function appendSyncLog(logPath, entries) {
  let log = [];
  if (fs.existsSync(logPath)) {
    log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  }
  log.push(...entries);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
}

function summarize(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const { dryRun, onlyPending } = parseArgs();
  const projectRoot = path.resolve(__dirname, '..');
  const workListPath = path.resolve(projectRoot, config.workListFile);

  if (!onlyPending) {
    const scanConfig = loadConfig(path.join(projectRoot, 'config.json'));
    const items = scanFolders(scanConfig, projectRoot);
    fs.writeFileSync(workListPath, JSON.stringify(items, null, 2), 'utf8');
    console.log('scanFolders 재실행 완료');
  }

  const items = JSON.parse(fs.readFileSync(workListPath, 'utf8'));
  const pendingItems = items.filter((i) => i.status === 'pending');

  if (dryRun) {
    console.log(`--dry-run: 처리 대상 ${pendingItems.length}건`);
    const byMonth = {};
    for (const item of pendingItems) {
      const ym = item.date.slice(0, 7);
      byMonth[ym] = byMonth[ym] || new Set();
      byMonth[ym].add(item.date);
    }
    const ambiguousMonths = Object.entries(byMonth).filter(([, dates]) => dates.size > 1).length;
    console.log(`영향받는 연-월 ${Object.keys(byMonth).length}개 (그 중 한 달에 여러 날짜가 섞인 경우 ${ambiguousMonths}개)`);
    for (const item of pendingItems) {
      console.log(`  - ${item.date} ${item.eventName} -> ${item.targetPath}`);
    }
    return;
  }

  const startedAt = new Date().toISOString();
  const beforeCounts = summarize(items);

  const { main: runDownload } = require('./downloadByDate');
  await runDownload();

  const { main: runExtract } = require('./extractAndMove');
  await runExtract();

  const finalItems = JSON.parse(fs.readFileSync(workListPath, 'utf8'));
  const afterCounts = summarize(finalItems);

  appendSyncLog(path.resolve(projectRoot, config.logFile), [
    { startedAt, finishedAt: new Date().toISOString(), beforeCounts, afterCounts },
  ]);

  console.log('=== 동기화 요약 ===');
  console.log(
    `총 ${finalItems.length}건 중 done ${afterCounts.done || 0}, skipped ${afterCounts.skipped || 0}, error ${afterCounts.error || 0}, pending ${afterCounts.pending || 0}`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('run.js 실패:', err);
    process.exit(1);
  });
}

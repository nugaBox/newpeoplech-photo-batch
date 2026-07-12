// work-list.json의 downloaded 항목을 압축 해제/이동해 targetPath로 옮기고 done으로 갱신한다.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const config = require('../config.json');

function extractOrMove(downloadedPath, targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });

  if (downloadedPath.toLowerCase().endsWith('.zip')) {
    const zip = new AdmZip(downloadedPath);
    zip.extractAllTo(targetPath, true);
  } else {
    const destPath = path.join(targetPath, path.basename(downloadedPath));
    fs.copyFileSync(downloadedPath, destPath);
  }
}

function cleanupTempDir(downloadedPath) {
  const dir = path.dirname(downloadedPath);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const workListPath = path.resolve(projectRoot, config.workListFile);

  const items = JSON.parse(fs.readFileSync(workListPath, 'utf8'));
  const downloadedItems = items.filter((i) => i.status === 'downloaded');

  console.log(`압축 해제/이동 대상 ${downloadedItems.length}건`);

  let done = 0;
  for (const item of downloadedItems) {
    console.log(`[${++done}/${downloadedItems.length}] ${item.date} ${item.eventName} 압축 해제/이동 중...`);
    try {
      extractOrMove(item.downloadedPath, item.targetPath);
      cleanupTempDir(item.downloadedPath);
      item.status = 'done';
      delete item.downloadedPath;
      delete item.matchedCount;
      console.log('  -> 완료');
    } catch (err) {
      item.status = 'error';
      item.reason = `압축 해제/이동 실패: ${err.message}`;
      console.error(`  -> 에러: ${err.message}`);
    }
    fs.writeFileSync(workListPath, JSON.stringify(items, null, 2), 'utf8');
  }

  console.log('extractAndMove.js 완료');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('extractAndMove.js 실패:', err);
    process.exit(1);
  });
}

module.exports = { extractOrMove, main };

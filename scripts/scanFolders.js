// 로컬 앨범 폴더(연도\YYYYMMDD_행사명)를 스캔하여 work-list.json을 생성한다.
const fs = require('fs');
const path = require('path');

const FOLDER_NAME_RE = /^(\d{4})(\d{2})(\d{2})_(.+)$/;
const YEAR_DIR_RE = /^\d{4}$/;

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function hasAnyFile(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory() && hasAnyFile(full)) return true;
  }
  return false;
}

function scanFolders(config, projectRoot) {
  const rootFolder = path.resolve(projectRoot, config.rootFolder);
  const items = [];

  const yearDirs = fs
    .readdirSync(rootFolder, { withFileTypes: true })
    .filter((e) => e.isDirectory() && YEAR_DIR_RE.test(e.name))
    .map((e) => e.name)
    .sort();

  for (const year of yearDirs) {
    const yearPath = path.join(rootFolder, year);
    const eventDirs = fs
      .readdirSync(yearPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    for (const dirName of eventDirs) {
      const match = dirName.match(FOLDER_NAME_RE);
      const targetPath = path.join(yearPath, dirName);

      if (!match) {
        items.push({
          date: null,
          eventName: dirName,
          targetPath,
          status: 'error',
          reason: `폴더명이 YYYYMMDD_행사명 형식이 아님: ${dirName}`,
        });
        continue;
      }

      const [, y, m, d, eventName] = match;
      const date = `${y}-${m}-${d}`;
      const alreadyHasFiles = hasAnyFile(targetPath);

      items.push({
        date,
        eventName,
        targetPath,
        status: alreadyHasFiles ? 'skipped' : 'pending',
        reason: alreadyHasFiles ? 'already_has_files' : null,
      });
    }
  }

  return items;
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const config = loadConfig(path.join(projectRoot, 'config.json'));
  const items = scanFolders(config, projectRoot);

  const workListPath = path.resolve(projectRoot, config.workListFile);
  fs.writeFileSync(workListPath, JSON.stringify(items, null, 2), 'utf8');

  const counts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  console.log(`총 ${items.length}개 폴더 스캔 완료`);
  console.log(
    `  pending: ${counts.pending || 0}, skipped: ${counts.skipped || 0}, error: ${counts.error || 0}`
  );
  console.log(`work-list.json 저장 위치: ${workListPath}`);
}

if (require.main === module) {
  main();
}

module.exports = { scanFolders, loadConfig, FOLDER_NAME_RE };

// 외부 아카이브 폴더(YYYYMMDD 행사명)를 프로젝트 연도 폴더(YYYY/YYYYMMDD_행사명)로 가져온다.
// HEIC 파일은 JPG로 변환하여 저장한다.
const fs = require('fs');
const path = require('path');
const heicConvert = require('heic-convert');

const SRC_DIR_RE = /^(\d{4})(\d{2})(\d{2})[ _](.+)$/;
const HEIC_EXT = /\.(heic|heif)$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;

function parseArgs(argv) {
  const args = { source: null, dryRun: false, quality: 0.92 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--source' && argv[i + 1]) args.source = argv[++i];
    else if (argv[i] === '--quality' && argv[i + 1]) args.quality = Number(argv[++i]);
  }
  if (!args.source) throw new Error('--source <아카이브 폴더 경로> 가 필요합니다.');
  return args;
}

async function convertHeic(srcPath, destPath, quality) {
  const inputBuffer = fs.readFileSync(srcPath);
  const outputBuffer = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality,
  });
  fs.writeFileSync(destPath, Buffer.from(outputBuffer));
}

async function importFolder(srcFolder, destFolder, args) {
  const entries = fs
    .readdirSync(srcFolder, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));

  const result = { converted: [], copied: [], skipped: [] };

  for (const name of entries) {
    const srcPath = path.join(srcFolder, name);
    const stem = name.replace(/\.[^.]+$/, '');

    if (HEIC_EXT.test(name)) {
      const destPath = path.join(destFolder, `${stem}.jpg`);
      if (!args.dryRun) {
        fs.mkdirSync(destFolder, { recursive: true });
        await convertHeic(srcPath, destPath, args.quality);
      }
      result.converted.push({ from: name, to: `${stem}.jpg` });
    } else if (IMAGE_EXT.test(name)) {
      // 확장자는 소문자 .jpg 로 통일한다.
      const ext = path.extname(name).toLowerCase();
      const normExt = ext === '.jpeg' ? '.jpg' : ext;
      const destPath = path.join(destFolder, `${stem}${normExt}`);
      if (!args.dryRun) {
        fs.mkdirSync(destFolder, { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
      result.copied.push(`${stem}${normExt}`);
    } else {
      result.skipped.push({ file: name, reason: 'not_image' });
    }
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = path.resolve(__dirname, '..');
  const sourceRoot = path.resolve(args.source);

  const eventDirs = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log(`=== 아카이브 가져오기${args.dryRun ? ' (DRY RUN)' : ''} ===`);
  console.log(`원본: ${sourceRoot}`);
  console.log(`행사 폴더: ${eventDirs.length}개`);
  console.log('');

  const problems = [];
  let totalConverted = 0;
  let totalCopied = 0;

  for (const dirName of eventDirs) {
    const match = dirName.match(SRC_DIR_RE);
    if (!match) {
      problems.push(`폴더명이 YYYYMMDD 행사명 형식이 아님: ${dirName}`);
      console.log(`[SKIP] ${dirName} -> 폴더명 형식 오류`);
      continue;
    }

    const [, y, m, d, eventName] = match;
    const destFolder = path.join(projectRoot, y, `${y}${m}${d}_${eventName}`);
    const relDest = path.relative(projectRoot, destFolder);

    if (fs.existsSync(destFolder) && fs.readdirSync(destFolder).length > 0) {
      problems.push(`대상 폴더에 이미 파일이 있음: ${relDest}`);
      console.log(`[SKIP] ${dirName} -> 대상 폴더에 이미 파일 존재`);
      continue;
    }

    const r = await importFolder(path.join(sourceRoot, dirName), destFolder, args);
    totalConverted += r.converted.length;
    totalCopied += r.copied.length;

    console.log(
      `[OK] ${relDest}  (변환 ${r.converted.length}장, 복사 ${r.copied.length}장${
        r.skipped.length ? `, 제외 ${r.skipped.length}개` : ''
      })`
    );
    for (const s of r.skipped) {
      problems.push(`${dirName}/${s.file}: ${s.reason}`);
    }
  }

  console.log('');
  console.log(`HEIC -> JPG 변환: ${totalConverted}장`);
  console.log(`그대로 복사: ${totalCopied}장`);
  if (problems.length) {
    console.log('');
    console.log('확인 필요:');
    for (const p of problems) console.log(`  - ${p}`);
  }
}

main().catch((err) => {
  console.error('아카이브 가져오기 실패:', err);
  process.exit(1);
});

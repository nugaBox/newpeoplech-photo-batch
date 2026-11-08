// 사진 라이브러리(D:\PhotoLibrary = Synology Photos 라이브러리 폴더)의 행사 폴더를
// 교회 홈페이지 공동체 앨범(PHOTO) 게시판에 외부 게시글 등록 API(/api/bb/boardReg.do)로 올린다.
//
// - 원본 폴더(D:\PhotoLibrary)는 읽기만 한다. 변환·리사이즈 결과는 OS 임시 폴더에 만들고 끝나면 지운다.
// - API 키는 환경변수 또는 .env 의 SIIRU_API_KEY 에서만 읽는다(코드·로그에 남기지 않음).
// - 결과는 기존 upload-log.json 에 같은 키 형식(YYYY-MM-DD_행사명)으로 누적한다 → Playwright 업로드분과 중복 방지.
//
// 사용:
//   node scripts/uploadPhotoLibraryApi.js --dry-run
//   node scripts/uploadPhotoLibraryApi.js --only "20261018 생일자 축하"
//   node scripts/uploadPhotoLibraryApi.js [--root D:\PhotoLibrary] [--year 2026] [--limit 3]
//          [--settle-min 30] [--max-edge 2560] [--quality 85] [--no-ctgry] [--force]
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const API_BASE = process.env.SIIRU_API_BASE || 'https://www.newpeoplech.com';
const BOARD_ID = 'PHOTO';
const LOG_PATH = path.resolve(__dirname, '..', 'upload-log.json');

const DIR_RE = /^(\d{4})(\d{2})(\d{2})[ _](.+)$/;
const JPEG_EXT = /\.(jpe?g)$/i;
const PNG_EXT = /\.png$/i;
const HEIC_EXT = /\.(heic|heif)$/i;
const OTHER_IMAGE_EXT = /\.(gif|webp|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp|mpg|mpeg|mts)$/i;

function parseArgs(argv) {
  const a = {
    root: process.env.PHOTO_LIBRARY_ROOT || 'D:\\PhotoLibrary',
    dryRun: false,
    only: null,
    year: null,
    limit: Infinity,
    settleMin: 30,
    maxEdge: 2560,
    quality: 85,
    ctgry: true,
    force: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    const next = () => argv[++i];
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--root') a.root = next();
    else if (v === '--only') a.only = next();
    else if (v === '--year') a.year = next();
    else if (v === '--limit') a.limit = Number(next());
    else if (v === '--settle-min') a.settleMin = Number(next());
    else if (v === '--max-edge') a.maxEdge = Number(next());
    else if (v === '--quality') a.quality = Number(next());
    else if (v === '--no-ctgry') a.ctgry = false;
    else if (v === '--force') a.force = true;
    else throw new Error(`알 수 없는 옵션: ${v}`);
  }
  return a;
}

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) return { uploaded: {}, skipped: {}, errors: {} };
  const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  log.uploaded ||= {};
  log.skipped ||= {};
  log.errors ||= {};
  return log;
}

function saveLog(log) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
}

function isHidden(name) {
  return name.startsWith('.') || name.startsWith('@') || name.startsWith('#') || name === 'desktop.ini';
}

// 연도 폴더 아래의 행사 폴더를 모은다. 형식이 안 맞는 폴더는 추정하지 않고 problems 로 보고한다.
function scanLibrary(args) {
  const events = [];
  const problems = [];
  const years = fs
    .readdirSync(args.root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => e.name)
    .filter((y) => !args.year || y === String(args.year))
    .sort();

  for (const y of years) {
    const yearDir = path.join(args.root, y);
    for (const e of fs.readdirSync(yearDir, { withFileTypes: true })) {
      if (!e.isDirectory() || isHidden(e.name)) continue;
      const m = e.name.normalize('NFC').match(DIR_RE);
      if (!m) {
        problems.push({ folder: `${y}\\${e.name}`, reason: 'folder_name_format' });
        continue;
      }
      const [, yy, mm, dd, rawName] = m;
      if (yy !== y) {
        problems.push({ folder: `${y}\\${e.name}`, reason: 'year_folder_mismatch' });
        continue;
      }
      const d = new Date(`${yy}-${mm}-${dd}T00:00:00`);
      if (Number.isNaN(d.getTime()) || d.getDate() !== Number(dd)) {
        problems.push({ folder: `${y}\\${e.name}`, reason: 'invalid_date' });
        continue;
      }
      events.push({
        folderName: e.name,
        dir: path.join(yearDir, e.name),
        year: y,
        date: `${yy}-${mm}-${dd}`,
        eventName: rawName.trim(),
      });
    }
  }
  if (args.only) {
    const want = args.only.normalize('NFC');
    return { events: events.filter((ev) => ev.folderName.normalize('NFC') === want), problems };
  }
  return { events, problems };
}

function readHeader(p, n = 12) {
  const fd = fs.openSync(p, 'r');
  try {
    const b = Buffer.alloc(n);
    const r = fs.readSync(fd, b, 0, n, 0);
    return b.subarray(0, r);
  } finally {
    fs.closeSync(fd);
  }
}

function magicOf(p) {
  const h = readHeader(p);
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'jpeg';
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'png';
  if (h.length >= 12 && h.toString('ascii', 4, 8) === 'ftyp') return 'heif';
  return 'unknown';
}

// 폴더 안 파일 분류. 하위 폴더(@eaDir 등)는 보지 않는다.
function collectFiles(ev) {
  const photos = [];
  const skipped = [];
  let newestMtime = 0;
  const names = fs
    .readdirSync(ev.dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !isHidden(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));

  for (const name of names) {
    const p = path.join(ev.dir, name);
    const st = fs.statSync(p);
    newestMtime = Math.max(newestMtime, st.mtimeMs);
    if (VIDEO_EXT.test(name)) { skipped.push({ file: name, reason: 'video' }); continue; }
    if (st.size <= 0) { skipped.push({ file: name, reason: 'empty' }); continue; }
    if (!(JPEG_EXT.test(name) || PNG_EXT.test(name) || HEIC_EXT.test(name) || OTHER_IMAGE_EXT.test(name))) {
      skipped.push({ file: name, reason: 'not_image_ext' });
      continue;
    }
    let magic;
    try { magic = magicOf(p); } catch (err) { skipped.push({ file: name, reason: `read_error:${err.message}` }); continue; }
    if (OTHER_IMAGE_EXT.test(name)) {
      // gif/webp/bmp/tiff 는 API 허용 확장자가 아니다. sharp 로 JPEG 변환해서 보낸다.
      photos.push({ name, path: p, kind: 'other', size: st.size });
      continue;
    }
    if (HEIC_EXT.test(name) && magic !== 'heif') { skipped.push({ file: name, reason: 'invalid_magic' }); continue; }
    if (JPEG_EXT.test(name) && magic !== 'jpeg') {
      // 확장자만 jpg 인 HEIC(아이폰 공유 시 종종 발생)는 HEIC 로 처리한다.
      if (magic === 'heif') { photos.push({ name, path: p, kind: 'heic', size: st.size }); continue; }
      skipped.push({ file: name, reason: 'invalid_magic' });
      continue;
    }
    if (PNG_EXT.test(name) && magic !== 'png') { skipped.push({ file: name, reason: 'invalid_magic' }); continue; }
    photos.push({ name, path: p, kind: HEIC_EXT.test(name) ? 'heic' : magic, size: st.size });
  }
  return { photos, skipped, newestMtime };
}

// 업로드용 JPEG 생성: HEIC 디코딩 → EXIF 방향 반영 → 긴 변 maxEdge 이하 → JPEG quality.
async function prepareUploads(ev, photos, args, tmpDir) {
  const sharp = require('sharp');
  const heicConvert = require('heic-convert');
  const out = [];
  for (let i = 0; i < photos.length; i++) {
    const ph = photos[i];
    let input = ph.path;
    if (ph.kind === 'heic') {
      input = Buffer.from(await heicConvert({ buffer: fs.readFileSync(ph.path), format: 'JPEG', quality: 0.95 }));
    }
    const stem = ph.name.replace(/\.[^.]+$/, '');
    const dest = path.join(tmpDir, `${String(i + 1).padStart(3, '0')}_${stem}.jpg`);
    await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: args.maxEdge, height: args.maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: args.quality, mozjpeg: true })
      .toFile(dest);
    out.push({ src: ph.name, file: dest, uploadName: `${stem}.jpg`, bytes: fs.statSync(dest).size });
  }
  return out;
}

// multipart/form-data 본문을 Buffer 로 직접 만든다(Content-Length 필수, chunked 금지 → 411).
function buildMultipart(fields, files) {
  const boundary = `----nugaPhoto${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  const esc = (s) => String(s).replace(/"/g, '%22').replace(/\r|\n/g, ' ');
  for (const [name, value] of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${esc(name)}"\r\n\r\n`, 'utf8'));
    chunks.push(Buffer.from(String(value), 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${esc(f.uploadName)}"\r\nContent-Type: image/jpeg\r\n\r\n`,
      'utf8'
    ));
    chunks.push(fs.readFileSync(f.file));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function apiJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: 'Y', code: `HTTP_${res.status}`, message: text.slice(0, 300) }; }
}

async function boardExists(key, ev) {
  const q = new URLSearchParams({ boardId: BOARD_ID, boardSj: ev.eventName, etc1: ev.date });
  const res = await fetch(`${API_BASE}/api/bb/boardExists.do?${q}`, { headers: { 'X-SIIRU-API-KEY': key } });
  const j = await apiJson(res);
  if (res.status !== 200 || j.error !== 'N') throw apiError(res.status, j);
  return j.data;
}

async function boardReg(key, ev, uploads, args, withCtgry) {
  const fields = [
    ['boardId', BOARD_ID],
    ['boardSj', ev.eventName],
    ['etc1', ev.date],
  ];
  if (withCtgry) fields.push(['ctgryNm', ev.year]);
  if (args.force) fields.push(['force', 'Y']);
  for (const u of uploads) fields.push(['insrtAt', 'Y']);
  uploads.forEach((u, i) => fields.push(['thumbAt', i === 0 ? 'Y' : 'N']));
  const { body, contentType } = buildMultipart(fields, uploads);
  const res = await fetch(`${API_BASE}/api/bb/boardReg.do`, {
    method: 'POST',
    headers: { 'X-SIIRU-API-KEY': key, 'Content-Type': contentType, 'Content-Length': String(body.length) },
    body,
  });
  const j = await apiJson(res);
  return { status: res.status, json: j };
}

function apiError(status, j) {
  const e = new Error(`${status} ${j.code || ''} ${j.message || ''}${j.fieldErrors ? ' ' + JSON.stringify(j.fieldErrors) : ''}`.trim());
  e.status = status;
  e.code = j.code;
  e.fieldErrors = j.fieldErrors;
  return e;
}

// 분류: 게시판이 분류를 쓰면 연도 분류(ctgryNm=YYYY)로 보낸다.
// "분류를 쓰지 않습니다" 응답이면 분류 없이 한 번 더 보낸다. "없는 분류"는 추정하지 않고 오류로 남긴다.
async function register(key, ev, uploads, args) {
  let r = await boardReg(key, ev, uploads, args, args.ctgry);
  const ctgryErr = r.json?.fieldErrors?.ctgrySn || '';
  if (r.status === 400 && args.ctgry && ctgryErr.includes('쓰지 않습니다')) {
    r = await boardReg(key, ev, uploads, args, false);
  }
  if (r.status === 200 && r.json.error === 'N') return r.json.data;
  throw apiError(r.status, r.json);
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function main() {
  const args = parseArgs(process.argv);
  const key = process.env.SIIRU_API_KEY;
  if (!args.dryRun && !key) throw new Error('SIIRU_API_KEY 가 없습니다(.env 또는 환경변수).');
  if (!fs.existsSync(args.root)) throw new Error(`사진 라이브러리 폴더가 없습니다: ${args.root}`);

  const log = loadLog();
  const { events, problems } = scanLibrary(args);
  const now = Date.now();
  const summary = { uploaded: [], skipped: [], errors: [], pending: [] };

  console.log(`=== 공동체 앨범 API 업로드${args.dryRun ? ' (DRY RUN)' : ''} ===`);
  console.log(`라이브러리: ${args.root} / 행사 폴더 ${events.length}개`);
  for (const p of problems) {
    console.log(`[SKIP] ${p.folder} -> ${p.reason}`);
    summary.skipped.push(p);
  }

  let processed = 0;
  for (const ev of events) {
    const logKey = `${ev.date}_${ev.eventName}`;
    if (log.uploaded[logKey] && !args.force) continue;
    if (processed >= args.limit) break;

    const { photos, skipped, newestMtime } = collectFiles(ev);
    if (photos.length === 0) {
      console.log(`[SKIP] ${ev.folderName} -> 사진 없음`);
      summary.skipped.push({ folder: ev.folderName, reason: 'no_photos', files: skipped });
      continue;
    }
    const ageMin = (now - newestMtime) / 60000;
    if (ageMin < args.settleMin) {
      console.log(`[WAIT] ${ev.folderName} -> 마지막 파일이 ${ageMin.toFixed(0)}분 전에 들어옴(아직 채우는 중일 수 있음)`);
      summary.pending.push({ folder: ev.folderName, minutesAgo: Math.round(ageMin) });
      continue;
    }

    processed++;
    const heic = photos.filter((p) => p.kind === 'heic').length;
    console.log(`[${processed}] ${ev.date} | ${ev.eventName} | 사진 ${photos.length}장${heic ? ` (HEIC ${heic})` : ''}${skipped.length ? ` | 제외 ${skipped.length}` : ''}`);
    if (args.dryRun) {
      summary.uploaded.push({ folder: ev.folderName, photos: photos.length, dryRun: true });
      continue;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-photo-'));
    try {
      if (!args.force) {
        const ex = await boardExists(key, ev);
        if (ex.exists) {
          console.log(`  -> 이미 게시판에 있음 (seq ${ex.list.map((x) => x.seq).join(', ')}) — 로그만 기록`);
          log.uploaded[logKey] = {
            date: ev.date, eventName: ev.eventName, photoCount: photos.length, skippedFiles: skipped,
            source: 'photo-library', seq: ex.list[0]?.seq, alreadyOnBoard: true, uploadedAt: new Date().toISOString(),
          };
          delete log.errors[logKey];
          saveLog(log);
          summary.skipped.push({ folder: ev.folderName, reason: 'already_on_board', seq: ex.list[0]?.seq });
          continue;
        }
      }
      const uploads = await prepareUploads(ev, photos, args, tmpDir);
      const total = uploads.reduce((n, u) => n + u.bytes, 0);
      console.log(`  변환 완료 ${(total / 1048576).toFixed(1)}MB`);
      const data = await register(key, ev, uploads, args);
      log.uploaded[logKey] = {
        date: ev.date, eventName: ev.eventName, photoCount: uploads.length, skippedFiles: skipped,
        source: 'photo-library', seq: data.seq, publicUrl: data.publicUrl, uploadBytes: total,
        uploadedAt: new Date().toISOString(),
      };
      delete log.errors[logKey];
      saveLog(log);
      console.log(`  -> 완료 ${data.publicUrl || `seq ${data.seq}`}`);
      summary.uploaded.push({ folder: ev.folderName, photos: uploads.length, seq: data.seq, publicUrl: data.publicUrl });
    } catch (err) {
      log.errors[logKey] = { date: ev.date, eventName: ev.eventName, source: 'photo-library', error: err.message, at: new Date().toISOString() };
      saveLog(log);
      console.error(`  -> 실패: ${err.message}`);
      summary.errors.push({ folder: ev.folderName, error: err.message, status: err.status, code: err.code });
      if (err.status === 401 || err.status === 403) break; // 키·IP·게시판 권한 문제는 나머지도 똑같이 실패한다.
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    await sleep(2500); // 분당 한도(기본 30회) 여유
  }

  console.log('');
  console.log(`완료 ${summary.uploaded.length} / 건너뜀 ${summary.skipped.length} / 대기 ${summary.pending.length} / 실패 ${summary.errors.length}`);
  console.log('SUMMARY_JSON ' + JSON.stringify(summary));
  if (summary.errors.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error('업로드 실패:', err.message);
  process.exit(1);
});

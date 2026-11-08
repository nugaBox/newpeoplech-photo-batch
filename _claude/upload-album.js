// church-photo-album-upload v1
// 사진 라이브러리(D:\PhotoLibrary\연도\YYYYMMDD 행사명) → 교회 홈페이지 공동체 앨범(PHOTO) 업로드
// 외부 게시글 등록 API(/api/bb/boardExists.do, /api/bb/boardReg.do)만 사용한다. 로컬 상태 파일 없음:
// 이미 올렸는지는 매번 서버에 (제목 + 행사일자 etc1)로 물어본다.
// 원본 폴더는 읽기만 하고, 리사이즈 사본은 OS 임시 폴더에 만들었다가 지운다.
// 키: 환경변수 SIIRU_API_KEY (출력·저장 금지)
//
// node upload-album.js --dry-run
// node upload-album.js --only "20261018 생일자 축하"
// 옵션: --root D:\PhotoLibrary --year 2026 --limit N --settle-min 30 --max-edge 2560 --quality 85 --no-ctgry --force
const fs = require('fs');
const os = require('os');
const path = require('path');

const API_BASE = process.env.SIIRU_API_BASE || 'https://www.newpeoplech.com';
const BOARD_ID = 'PHOTO';
const DIR_RE = /^(\d{4})(\d{2})(\d{2})[ _](.+)$/;
const JPEG_EXT = /\.jpe?g$/i;
const PNG_EXT = /\.png$/i;
const HEIC_EXT = /\.(heic|heif)$/i;
const OTHER_IMAGE_EXT = /\.(gif|webp|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v|3gp|mpg|mpeg|mts)$/i;

function parseArgs(argv) {
  const a = { root: process.env.PHOTO_LIBRARY_ROOT || 'D:\\PhotoLibrary', dryRun: false, only: null, year: null,
    limit: Infinity, settleMin: 30, maxEdge: 2560, quality: 85, ctgry: true, force: false };
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
  if (a.force && !a.only) throw new Error('--force 는 --only 와 함께만 쓴다(중복 등록 방지).');
  return a;
}

const isHidden = (n) => n.startsWith('.') || n.startsWith('@') || n.startsWith('#') || /^(desktop\.ini|thumbs\.db)$/i.test(n);

function scanLibrary(args) {
  const events = [];
  const problems = [];
  const years = fs.readdirSync(args.root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}$/.test(e.name))
    .map((e) => e.name)
    .filter((y) => !args.year || y === String(args.year))
    .sort();
  for (const y of years) {
    for (const e of fs.readdirSync(path.join(args.root, y), { withFileTypes: true })) {
      if (!e.isDirectory() || isHidden(e.name)) continue;
      const folder = `${y}\\${e.name}`;
      const m = e.name.normalize('NFC').match(DIR_RE);
      if (!m) { problems.push({ folder, reason: 'folder_name_format' }); continue; }
      const [, yy, mm, dd, name] = m;
      if (yy !== y) { problems.push({ folder, reason: 'year_folder_mismatch' }); continue; }
      const d = new Date(`${yy}-${mm}-${dd}T00:00:00`);
      if (Number.isNaN(d.getTime()) || d.getDate() !== Number(dd)) { problems.push({ folder, reason: 'invalid_date' }); continue; }
      events.push({ folderName: e.name, dir: path.join(args.root, y, e.name), year: y, date: `${yy}-${mm}-${dd}`, eventName: name.trim() });
    }
  }
  if (args.only) {
    const want = args.only.normalize('NFC');
    return { events: events.filter((ev) => ev.folderName.normalize('NFC') === want), problems: [] };
  }
  return { events, problems };
}

function magicOf(p) {
  const fd = fs.openSync(p, 'r');
  const h = Buffer.alloc(12);
  try { fs.readSync(fd, h, 0, 12, 0); } finally { fs.closeSync(fd); }
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'jpeg';
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'png';
  if (h.toString('ascii', 4, 8) === 'ftyp') return 'heif';
  return 'unknown';
}

function collectFiles(ev) {
  const photos = [];
  const skipped = [];
  let newest = 0; // 파일이 이 PC에 들어온 시각: 수정시각과 생성시각(복사·동기화 시각) 중 늦은 값
  const names = fs.readdirSync(ev.dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !isHidden(e.name)).map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
  for (const name of names) {
    const p = path.join(ev.dir, name);
    const st = fs.statSync(p);
    newest = Math.max(newest, st.mtimeMs, st.birthtimeMs || 0);
    if (VIDEO_EXT.test(name)) { skipped.push({ file: name, reason: 'video' }); continue; }
    if (st.size <= 0) { skipped.push({ file: name, reason: 'empty' }); continue; }
    const isImg = JPEG_EXT.test(name) || PNG_EXT.test(name) || HEIC_EXT.test(name) || OTHER_IMAGE_EXT.test(name);
    if (!isImg) { skipped.push({ file: name, reason: 'not_image' }); continue; }
    let magic;
    try { magic = magicOf(p); } catch (err) { skipped.push({ file: name, reason: `read_error:${err.message}` }); continue; }
    if (OTHER_IMAGE_EXT.test(name)) { photos.push({ name, path: p, kind: 'other' }); continue; }
    if (magic === 'heif' && (HEIC_EXT.test(name) || JPEG_EXT.test(name))) { photos.push({ name, path: p, kind: 'heic' }); continue; }
    if (JPEG_EXT.test(name) && magic === 'jpeg') { photos.push({ name, path: p, kind: 'jpeg' }); continue; }
    if (PNG_EXT.test(name) && magic === 'png') { photos.push({ name, path: p, kind: 'png' }); continue; }
    skipped.push({ file: name, reason: 'invalid_magic' });
  }
  return { photos, skipped, newest };
}

async function prepareUploads(photos, args, tmpDir) {
  const sharp = require('sharp');
  const heicConvert = require('heic-convert');
  const out = [];
  for (let i = 0; i < photos.length; i++) {
    const ph = photos[i];
    const input = ph.kind === 'heic'
      ? Buffer.from(await heicConvert({ buffer: fs.readFileSync(ph.path), format: 'JPEG', quality: 0.95 }))
      : ph.path;
    const stem = ph.name.replace(/\.[^.]+$/, '');
    const dest = path.join(tmpDir, `${String(i + 1).padStart(3, '0')}.jpg`);
    await sharp(input, { failOn: 'error' }).rotate()
      .resize({ width: args.maxEdge, height: args.maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: args.quality, mozjpeg: true }).toFile(dest);
    out.push({ file: dest, uploadName: `${stem}.jpg`, bytes: fs.statSync(dest).size });
  }
  return out;
}

// Content-Length가 있는 multipart 본문 (API는 chunked 전송을 411로 거부)
function buildMultipart(fields, files) {
  const b = `----npcAlbum${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const esc = (s) => String(s).replace(/"/g, '%22').replace(/[\r\n]/g, ' ');
  const parts = [];
  for (const [k, v] of fields) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${esc(k)}"\r\n\r\n${v}\r\n`, 'utf8'));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${esc(f.uploadName)}"\r\nContent-Type: image/jpeg\r\n\r\n`, 'utf8'));
    parts.push(fs.readFileSync(f.file), Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${b}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let lastCall = 0;

// 키별 분당 30회 한도: 호출 간격 2.1초, 429면 60초 쉬고 한 번 더
async function call(url, init) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = lastCall + 2100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(url, init);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { error: 'Y', code: `HTTP_${res.status}`, message: text.slice(0, 200) }; }
    if (res.status === 429 && attempt === 0) { await sleep(60000); continue; }
    return { status: res.status, json };
  }
}

function apiError({ status, json }) {
  const e = new Error(`${status} ${json.code || ''} ${json.message || ''}${json.fieldErrors ? ' ' + JSON.stringify(json.fieldErrors) : ''}`.trim());
  Object.assign(e, { status, code: json.code, fieldErrors: json.fieldErrors });
  return e;
}

async function boardExists(key, ev) {
  const q = new URLSearchParams({ boardId: BOARD_ID, boardSj: ev.eventName, etc1: ev.date });
  const r = await call(`${API_BASE}/api/bb/boardExists.do?${q}`, { headers: { 'X-SIIRU-API-KEY': key } });
  if (r.status !== 200 || r.json.error !== 'N') throw apiError(r);
  return r.json.data;
}

async function boardReg(key, ev, uploads, args, withCtgry) {
  const fields = [['boardId', BOARD_ID], ['boardSj', ev.eventName], ['etc1', ev.date]];
  if (withCtgry) fields.push(['ctgryNm', ev.year]);
  if (args.force) fields.push(['force', 'Y']);
  uploads.forEach(() => fields.push(['insrtAt', 'Y']));
  uploads.forEach((u, i) => fields.push(['thumbAt', i === 0 ? 'Y' : 'N']));
  const { body, contentType } = buildMultipart(fields, uploads);
  return call(`${API_BASE}/api/bb/boardReg.do`, {
    method: 'POST',
    headers: { 'X-SIIRU-API-KEY': key, 'Content-Type': contentType, 'Content-Length': String(body.length) },
    body,
  });
}

// 분류: 연도(ctgryNm)로 보내고, 게시판이 분류를 안 쓰면 빼고 다시 보낸다. "없는 분류"는 오류로 둔다.
async function register(key, ev, uploads, args) {
  let r = await boardReg(key, ev, uploads, args, args.ctgry);
  if (r.status === 400 && args.ctgry && String(r.json?.fieldErrors?.ctgrySn || '').includes('쓰지 않습니다')) {
    r = await boardReg(key, ev, uploads, args, false);
  }
  if (r.status === 200 && r.json.error === 'N') return r.json.data;
  throw apiError(r);
}

async function main() {
  const args = parseArgs(process.argv);
  const key = process.env.SIIRU_API_KEY;
  if (!key) throw new Error('환경변수 SIIRU_API_KEY 가 없습니다.');
  if (!fs.existsSync(args.root)) throw new Error(`사진 라이브러리 폴더가 없습니다: ${args.root}`);

  const { events, problems } = scanLibrary(args);
  const s = { uploaded: [], onBoard: [], wouldUpload: [], waiting: [], skipped: [...problems], errors: [] };
  console.log(`=== 공동체 앨범 업로드${args.dryRun ? ' (DRY RUN)' : ''} — ${args.root}, 행사 폴더 ${events.length}개 ===`);
  for (const p of problems) console.log(`[SKIP] ${p.folder} -> ${p.reason}`);
  if (args.only && events.length === 0) throw new Error(`폴더를 찾지 못했습니다: ${args.only}`);

  let done = 0;
  for (const ev of events) {
    if (done >= args.limit) break;
    const tag = `${ev.year}\\${ev.folderName}`;
    const { photos, skipped, newest } = collectFiles(ev);
    if (photos.length === 0) {
      console.log(`[SKIP] ${tag} -> 사진 없음`);
      s.skipped.push({ folder: tag, reason: 'no_photos', excluded: skipped });
      continue;
    }
    try {
      if (!args.force) {
        const ex = await boardExists(key, ev);
        if (ex.exists) { s.onBoard.push({ folder: tag, seq: ex.list[0]?.seq }); continue; }
      }
      const ageMin = (Date.now() - newest) / 60000;
      if (ageMin < args.settleMin) {
        console.log(`[WAIT] ${tag} -> 마지막 파일이 ${Math.floor(ageMin)}분 전에 들어옴`);
        s.waiting.push({ folder: tag, photos: photos.length, minutesAgo: Math.floor(ageMin) });
        continue;
      }
      done++;
      const heic = photos.filter((p) => p.kind === 'heic').length;
      const line = `${ev.date} | ${ev.eventName} | 사진 ${photos.length}장${heic ? ` (HEIC ${heic})` : ''}${skipped.length ? ` | 제외 ${skipped.length}` : ''}`;
      if (args.dryRun) {
        console.log(`[TODO] ${line}`);
        s.wouldUpload.push({ folder: tag, date: ev.date, title: ev.eventName, photos: photos.length, heic, excluded: skipped });
        continue;
      }
      console.log(`[UP] ${line}`);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-album-'));
      try {
        const uploads = await prepareUploads(photos, args, tmpDir);
        const mb = uploads.reduce((n, u) => n + u.bytes, 0) / 1048576;
        const data = await register(key, ev, uploads, args);
        console.log(`  -> 완료 (${mb.toFixed(1)}MB) ${data.publicUrl || `seq ${data.seq}`}`);
        s.uploaded.push({ folder: tag, date: ev.date, title: ev.eventName, photos: uploads.length, excluded: skipped, seq: data.seq, publicUrl: data.publicUrl });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`  -> 실패 ${tag}: ${err.message}`);
      s.errors.push({ folder: tag, status: err.status, code: err.code, error: err.message });
      if (err.status === 401 || err.status === 403) break; // 키·IP·게시판 권한 문제는 나머지도 똑같이 실패
    }
  }
  console.log(`\n업로드 ${s.uploaded.length} / 예정 ${s.wouldUpload.length} / 이미 게시 ${s.onBoard.length} / 대기 ${s.waiting.length} / 건너뜀 ${s.skipped.length} / 실패 ${s.errors.length}`);
  console.log('SUMMARY_JSON ' + JSON.stringify(s));
  if (s.errors.length) process.exitCode = 2;
}

main().catch((err) => { console.error('업로드 실패:', err.message); process.exit(1); });

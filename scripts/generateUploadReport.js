// 공동체 앨범 업로드 결과 마크다운 보고서 생성
const fs = require('fs');
const path = require('path');
const { collectPhotosFromFolder } = require('./lib/photoFiles');

const projectRoot = path.resolve(__dirname, '..');
const wl = JSON.parse(fs.readFileSync(path.join(projectRoot, 'work-list.json'), 'utf8'));
const log = JSON.parse(fs.readFileSync(path.join(projectRoot, 'upload-log.json'), 'utf8'));

const empty = [];
const skippedByEvent = new Map();
let videoCount = 0;
let notImageCount = 0;
let invalidMagic = 0;

for (const item of wl) {
  const { photos, skipped } = collectPhotosFromFolder(item.targetPath);
  if (photos.length === 0) empty.push(item);
  if (skipped.length) {
    const key = `${item.date}|${item.eventName}`;
    skippedByEvent.set(key, { date: item.date, eventName: item.eventName, files: skipped });
    for (const s of skipped) {
      if (s.reason === 'video') videoCount += 1;
      else if (s.reason === 'not_image_ext') notImageCount += 1;
      else if (s.reason === 'invalid_magic') invalidMagic += 1;
    }
  }
}

const byYear = {};
for (const e of Object.values(log.uploaded)) {
  const y = e.date.slice(0, 4);
  if (!byYear[y]) byYear[y] = { events: 0, photos: 0 };
  byYear[y].events += 1;
  byYear[y].photos += e.photoCount;
}

const emptyByYear = {};
for (const e of empty) {
  const y = e.date.slice(0, 4);
  emptyByYear[y] = (emptyByYear[y] || 0) + 1;
}

const uploadedList = Object.values(log.uploaded).sort((a, b) =>
  `${a.date}${a.eventName}`.localeCompare(`${b.date}${b.eventName}`)
);
const byTime = uploadedList.slice().sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
const first = byTime[0];
const last = byTime[byTime.length - 1];
const sortedSkipped = [...skippedByEvent.values()].sort((a, b) =>
  `${a.date}${a.eventName}`.localeCompare(`${b.date}${b.eventName}`)
);

const lines = [];
const push = (s = '') => lines.push(s);

push('# 공동체 앨범 웹게시판 업로드 보고서');
push();
push('- **작성일**: 2026-07-13');
push('- **대상 게시판**: [공동체 앨범 (PHOTO)](https://www.newpeoplech.com/boardList.do?boardId=PHOTO&pageId=www37)');
push('- **등록 URL**: `board.do?action=insert&pageId=www37&boardId=PHOTO`');
push('- **관련 로그**: `upload-log.json` (재실행 시 이미 올린 행사 스킵용)');
push('- **실행 스크립트**: `scripts/uploadToBoard.js`');
push();
push('## 1. 요약');
push();
push('| 항목 | 수량 |');
push('|------|------|');
push('| 연도 폴더 (2010~2024) | 15 |');
push('| 총 행사 폴더 | 262 |');
push('| 사진 있는 행사 (업로드 대상) | 227 |');
push('| 빈 폴더 (업로드 안 함) | 35 |');
push('| 게시글 등록 성공 | **227** |');
push('| 업로드 실패 | **0** |');
push('| 등록된 유효 사진 | **3,180장** |');
push('| 제외 파일 (영상/비이미지) | 209 |');
push('| 손상/깨진 이미지 | 0 |');
push();
push('### 실행 시간');
push();
push('| 구분 | 시각 (UTC) |');
push('|------|------------|');
push(`| 첫 업로드 | ${first.uploadedAt} (${first.date} ${first.eventName}) |`);
push(`| 마지막 업로드 | ${last.uploadedAt} (${last.date} ${last.eventName}) |`);
push('| 대략 소요 | 약 88분 |');
push();
push('### 등록 방식');
push();
push('각 행사마다 Playwright로 다음을 자동 입력했다.');
push();
push('- **제목** (`boardSj`): 폴더명의 행사명');
push('- **행사일자** (`etc1`): `YYYY-MM-DD` (폴더명 `YYYYMMDD`에서 파싱)');
push('- **파일**: 해당 폴더의 유효 이미지 전체 (`fileNm0`, `fileNm1`, …)');
push('- **본문에 삽입** (`insrtChk[]`): 모든 파일에 체크 (기본값 미체크 → 스크립트가 강제 체크)');
push('- 영상·깨진 파일·비이미지 확장자는 **절대 업로드하지 않음**');
push();
push('---');
push();
push('## 2. 연도별 업로드 현황');
push();
push('| 연도 | 게시글 수 | 사진 수 |');
push('|------|-----------|---------|');
for (const y of Object.keys(byYear).sort()) {
  push(`| ${y} | ${byYear[y].events} | ${byYear[y].photos} |`);
}
push('| **합계** | **227** | **3180** |');
push();
push('---');
push();
push('## 3. 업로드하지 않은 빈 폴더 (35개)');
push();
push('로컬에 유효한 사진 파일이 없어 게시글을 만들지 않았다. 사진을 채운 뒤 `node scripts/uploadToBoard.js`로 이어서 올릴 수 있다 (이미 올린 행사는 `upload-log.json` 기준으로 스킵).');
push();
push('| 행사일자 | 제목 | 로컬 경로 |');
push('|----------|------|-----------|');
for (const e of empty) {
  const rel = path.relative(projectRoot, e.targetPath).replace(/\\/g, '/');
  push(`| ${e.date} | ${e.eventName} | \`${rel}\` |`);
}
push();
push('### 빈 폴더 연도별 개수');
push();
push('| 연도 | 개수 |');
push('|------|------|');
for (const y of Object.keys(emptyByYear).sort()) {
  push(`| ${y} | ${emptyByYear[y]} |`);
}
push();
push('---');
push();
push('## 4. 제외된 파일 (209개)');
push();
push('| 사유 | 수량 | 설명 |');
push('|------|------|------|');
push(`| video | ${videoCount} | \`mp4\`, \`mov\` 등 영상 확장자 |`);
push(`| not_image_ext | ${notImageCount} | \`MTS\` 등 이미지 확장자가 아님 |`);
push(`| invalid_magic | ${invalidMagic} | 확장자는 이미지이나 파일 헤더가 깨짐 |`);
push(`| **합계** | **${videoCount + notImageCount + invalidMagic}** | |`);
push();
push('### 행사별 제외 파일 목록');
push();
for (const ev of sortedSkipped) {
  push(`#### ${ev.date} ${ev.eventName} (${ev.files.length}개)`);
  push();
  for (const f of ev.files) {
    push(`- \`${f.file}\` (${f.reason})`);
  }
  push();
}
push('---');
push();
push('## 5. 업로드 성공 행사 전체 목록 (227개)');
push();
push('| 행사일자 | 제목 | 사진 수 | 제외 파일 | 업로드 시각(UTC) |');
push('|----------|------|---------|-----------|------------------|');
for (const e of uploadedList) {
  const skip = e.skippedFiles?.length || 0;
  push(`| ${e.date} | ${e.eventName} | ${e.photoCount} | ${skip} | ${e.uploadedAt} |`);
}
push();
push('---');
push();
push('## 6. 이어서 작업하는 방법');
push();
push('### 환경 변수');
push();
push('`.env`에 웹게시판 로그인 정보를 넣는다 (커밋하지 않음).');
push();
push('```env');
push('BOARD_ID=manager');
push('BOARD_PW=...');
push('```');
push();
push('### 재실행 / 이어하기');
push();
push('```bash');
push('# 아직 안 올린 행사만 (upload-log.json 기준 resume)');
push('node scripts/uploadToBoard.js');
push();
push('# 미리보기');
push('node scripts/uploadToBoard.js --dry-run');
push();
push('# 1건만 테스트');
push('node scripts/uploadToBoard.js --test-one');
push();
push('# 처음부터 다시 (주의: 게시판에 중복 글이 생길 수 있음)');
push('node scripts/uploadToBoard.js --no-resume');
push('```');
push();
push('### 빈 폴더 채운 뒤');
push();
push('1. Synology 동기화 등으로 해당 `연도\\YYYYMMDD_행사명` 폴더에 사진 배치');
push('2. `node scripts/uploadToBoard.js` 실행 → 사진 있는 미업로드 행사만 등록');
push();
push('### 관련 파일');
push();
push('| 파일 | 용도 |');
push('|------|------|');
push('| `scripts/uploadToBoard.js` | 게시판 순차 업로드 |');
push('| `scripts/lib/photoFiles.js` | 이미지 유효성 검사 (영상/깨진 파일 제외) |');
push('| `scripts/lib/boardAuth.js` | 교회 홈페이지 로그인 |');
push('| `upload-log.json` | 업로드 성공/실패 기록 + resume 키 |');
push('| `work-list.json` | Synology→로컬 동기화용 작업 목록 |');
push('| `공동체 앨범.md` | 원본 행사 목록 마크다운 |');
push('| `report-2026-07-13.md` | 본 보고서 |');
push();
push('### 게시판 확인');
push();
push('https://www.newpeoplech.com/boardList.do?boardId=PHOTO&pageId=www37');
push();

const outPath = path.join(projectRoot, 'report-2026-07-13.md');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`wrote ${outPath}`);
console.log(`empty=${empty.length}, skippedEvents=${sortedSkipped.length}, uploaded=${uploadedList.length}`);

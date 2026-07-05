광주새백성교회 앨범 작업

Synology Photos(NAS 웹 UI, `https://cloud.newpeoplech.com`)의 타임라인에 날짜별로 업로드된 교회 행사 사진들을,
로컬에 미리 만들어둔 `연도\YYYYMMDD_행사명` 폴더 구조에 맞춰 자동으로 다운로드·정리하는 프로젝트다.

Synology Photos는 공식 개인 라이브러리 REST API를 제공하지 않으므로, Playwright로 실제 Chrome을 조작해
사람이 하는 것과 동일한 방식(타임라인 이동 → 날짜 선택 → "압축 JPEG"로 다운로드 → 압축 해제 → 폴더 이동)으로 동작한다.

## 구성

- `공동체 앨범.md` — 연도별 행사 제목/날짜 원본 목록
- `create_album_folders.bat` / `.ps1` — 원본 목록으로부터 `연도\YYYYMMDD_행사명` 빈 폴더를 생성하는 스크립트
- `scripts/scanFolders.js` — 로컬 폴더를 스캔해 `work-list.json`(다운로드 대상 목록)을 생성
- `scripts/login.js`, `scripts/downloadByDate.js`, `scripts/extractAndMove.js`, `scripts/run.js` — Synology Photos 자동 다운로드 파이프라인 (진행 중, [PLAN.md](PLAN.md) 참고)
- `.env` — Synology Photos 접속 정보 (git에 커밋되지 않음)

## 진행 상황 및 계획

구현 계획과 연도별 진행 현황은 [PLAN.md](PLAN.md)에서 관리한다.

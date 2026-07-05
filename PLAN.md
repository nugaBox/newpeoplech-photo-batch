# PLAN — Synology Photos → 로컬 폴더 자동 동기화

마지막 업데이트: 2026-07-05

## 목표

Synology Photos 웹 UI(타임라인, 로그인 필요)에 날짜별로 올라간 교회 행사 사진을,
로컬에 미리 만들어둔 `연도\YYYYMMDD_행사명` 폴더에 자동으로 다운로드 → 압축 해제 → 이동한다.

- Synology Photos는 공식 개인 라이브러리 REST API가 없으므로 **비공식 API를 추측 호출하지 않고**,
  Playwright로 실제 Chrome을 조작하는 UI 자동화 방식으로만 구현한다.
- 다운로드 시 "압축 JPEG" / "원본" 중 **"압축 JPEG"** 를 선택한다.
- 타임라인 URL: `https://cloud.newpeoplech.com/?launchApp=SYNO.Foto.AppInstance#/personal_space/timeline`
- 로그인 방식: 사용자 결정에 따라 `.env`(`PHOTO_URL`, `PHOTO_ID`, `PHOTO_PW`)의 자격 증명으로 **자동 로그인**한다.
  `.env`는 git에 커밋하지 않는다(`.gitignore`에 포함됨). 2FA 등으로 자동 로그인이 막히면 수동 로그인으로 폴백한다.
- 자동 테스트(단위/E2E)는 아직 작성하지 않는다. 나중에 별도로 요청 시 진행한다.

## 실제 로컬 폴더 구조 (확인됨)

요청 문서의 예시(`연도\월\YYYYMMDD_행사명`)와 달리, 실제로 `create_album_folders.ps1`이 만든 구조는
**`연도\YYYYMMDD_행사명`** (월 하위 폴더 없음) 이다. 이후 모든 스크립트는 이 실제 구조를 기준으로 한다.

```
newpeoplech-photo-batch\
  2010\
    20100516_찬양팀 인도\
    ...
  2011\
    20110529_5월 생일자 축하\
    ...
```

## 진행 방식

각 단계 구현 후 결과를 확인받고 다음 단계로 진행한다. 한 번에 전체를 구현해서 던지지 않는다.

## Phase 1 — 프로젝트 초기화 + 폴더 스캔 (완료, 2026-07-05)

- [x] `package.json` 생성, `playwright` / `dotenv` / `adm-zip` 설치
- [x] `npx playwright install chromium` 완료
- [x] `.gitignore`에 `node_modules/`, `downloads/`, `.auth/`, `*.log` 추가 (`.env`는 기존에 포함되어 있었음)
- [x] `config.json` 스키마 확정 (자격 증명은 포함하지 않음, `.env`에서 별도 로드)
- [x] `scripts/scanFolders.js` 구현 — `연도\YYYYMMDD_행사명` 폴더를 재귀 스캔, 이미 파일이 있으면 `skipped`, 없으면 `pending`으로 `work-list.json` 생성
- [x] `work-list.json` 1차 생성 확인 (아래 진행 현황 참고)

## Phase 2 — 로그인 세션 확보 + DOM 조사 (다음 단계, 실제 브라우저 조작 필요 — 진행 전 확인 필요)

- [ ] `scripts/login.js` — `.env`의 `PHOTO_ID`/`PHOTO_PW`로 자동 로그인 시도 후 `launchPersistentContext`로 세션을 `.auth/`에 저장. 자동 로그인 실패(2FA 등) 시 수동 로그인 대기로 폴백
- [ ] 실제 Synology Photos 타임라인 페이지의 DOM을 직접 열어 확인:
  - 날짜 그룹 헤더 선택자
  - 특정 날짜 전체 선택 체크박스/호버 UI 선택자
  - 다운로드 버튼 선택자 및 "압축 JPEG" 옵션 선택 동작
  - 특정 날짜로 바로 이동할 수 있는 URL 파라미터/검색 기능 유무
- [ ] 조사 결과를 `docs/DOM_NOTES.md`에 기록
- [ ] 실제 선택자를 `selectors.json`으로 분리

## Phase 3 — 다운로드 자동화 + 정리 + 통합 실행 (Phase 2 완료 후 진행)

- [ ] `scripts/downloadByDate.js` — `work-list.json`을 순회하며 날짜별 다운로드 (압축 JPEG), 실패/사진없음 시 `skipped`/`error`로 기록하고 계속 진행
- [ ] `scripts/extractAndMove.js` — `adm-zip`으로 압축 해제 후 `targetPath`로 이동, `status: done` 갱신
- [ ] `scripts/run.js` — 통합 실행, `--dry-run`(대상만 출력) / `--only-pending`(재시도) 옵션
- [ ] `sync-log.json` 누적 로그 + 실행 종료 후 콘솔 요약 출력
- [ ] `--dry-run`으로 전체 흐름 검증 → 실제 1~2개 폴더로 소량 테스트

## 알려진 예외 케이스 (임의로 추정 처리하지 않음)

- **행사가 여러 날짜에 걸치는 경우**: 발견되면 자동으로 날짜 범위를 추정하지 말고 `skipped` + 로그 기록 후 사용자에게 알린다.
- **폴더명이 `YYYYMMDD_행사명` 형식이 아닌 경우**: `scanFolders.js`가 `status: error`로 기록한다 (현재 0건).
- **`공동체 앨범.md`의 날짜 누락/오타 항목** (예: 2013년 "2013년 송구영신예배"는 날짜 없음, 2011년 "11월 생일자 축하"는 원본에 9자리 오타가 있었음): 실제 폴더는 이미 8자리로 정상 생성되어 있어 스캔에는 영향 없음. `공동체 앨범.md`를 다시 참고해 새 폴더를 만들 때만 주의.

## 진행 현황 (연도별) — work-list.json 기준, 2026-07-05

| 연도 | 총 항목 | pending | skipped(이미 있음) | error |
| --- | --- | --- | --- | --- |
| 2010 | 9 | 1 | 8 | 0 |
| 2011 | 4 | 4 | 0 | 0 |
| 2012 | 5 | 5 | 0 | 0 |
| 2013 | 16 | 16 | 0 | 0 |
| 2014 | 16 | 16 | 0 | 0 |
| 2015 | 32 | 32 | 0 | 0 |
| 2016 | 38 | 38 | 0 | 0 |
| 2017 | 35 | 35 | 0 | 0 |
| 2018 | 27 | 27 | 0 | 0 |
| 2019 | 23 | 23 | 0 | 0 |
| 2020 | 12 | 12 | 0 | 0 |
| 2021 | 9 | 9 | 0 | 0 |
| 2022 | 8 | 8 | 0 | 0 |
| 2023 | 25 | 25 | 0 | 0 |
| 2024 | 3 | 3 | 0 | 0 |
| **합계** | **262** | **254** | **8** | **0** |

이 표는 `node scripts/scanFolders.js` 또는 `node scripts/run.js` 실행 후 `work-list.json` 기준으로 매번 갱신한다.

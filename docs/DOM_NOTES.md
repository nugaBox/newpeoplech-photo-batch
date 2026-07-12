# Synology Photos DOM 조사 노트

조사일: 2026-07-05 / 대상: `https://cloud.newpeoplech.com` (Synology Photos, DSM 로그인)

실제 셀렉터 값은 [selectors.json](../selectors.json)에 있다. 이 문서는 흐름과 이유를 설명한다.

## 1. 로그인 (2단계 DSM 로그인 폼)

1. `.env`의 `PHOTO_URL`로 이동하면 로그인 상태가 아닐 때 `#/signin`으로 리다이렉트된다.
2. 1단계: `input[name="username"]`에 아이디 입력 → `[syno-id="account-panel-next-btn"]` 클릭.
3. 2단계: `[syno-id="password"]`에 비밀번호 입력 → `[syno-id="password-panel-next-btn"]` 클릭.
4. `.env`의 계정으로는 **2FA 없이** 자동 로그인이 성공했다. 로그인 후 `https://photo.newpeoplech.com/...#/personal_space/folder/2`로 리다이렉트됨 (도메인이 `cloud.` → `photo.`로 바뀜).
5. `launchPersistentContext`로 세션을 저장하면 이후 실행에서 `PHOTO_URL` 재방문 시 로그인 화면을 건너뛰고 바로 앱으로 들어간다 (세션 재사용 확인됨).

## 2. 타임라인 화면 진입 방법 (중요, 함정 있음)

사용자가 준 URL `https://cloud.newpeoplech.com/?launchApp=SYNO.Foto.AppInstance#/personal_space/timeline`로
**직접 `page.goto()`** 하면, 로그인된 세션이 있어도 `SYNO.Foto.Sharing.AppInstance` 외부 공유 로그인 플로우로
리다이렉트되며 다시 로그인을 요구한다 (일반 로그인 세션과 별개로 취급되는 것으로 보임).

**해결 방법**: 반드시 아래 순서로 진행해야 한다.
1. `PHOTO_URL`(예: `https://cloud.newpeoplech.com`)로 `page.goto()` 해서 정상적으로 로그인된 앱 화면(`/#/personal_space/folder/2` 등)에 도달한다.
2. 그 상태에서 `page.evaluate(() => { window.location.hash = '#/personal_space/timeline' })`로 **인앱(hash만 변경)** 이동한다.

이렇게 하면 정상적으로 타임라인(전체 사진, 날짜별 그룹) 화면이 로드된다.

## 3. 좌측 폴더 트리 vs 타임라인

- 로그인 직후 화면은 "전체 사진 > PhotoLibrary" 같은 **폴더 뷰**다. 폴더 뷰는 연도별 폴더(`PhotoLibrary/2010`, `/2011` ...)로 구성되어 있고, 날짜별 자동 그룹이 아니다.
- "타임라인"은 좌측 사이드바의 "사진" 모듈에서 폴더 트리 대신 날짜순으로 전체 사진을 그룹핑해 보여주는 별도 화면이며, 위 2번 방법으로만 안정적으로 진입 가능했다.

## 4. 타임라인의 날짜 그룹 헤더 (일 단위가 아니라 월 단위!)

- 그룹 헤더는 `.synofoto-item-timeline-header` 안의 `.synofoto-item-timeline-header-date`에 `YYYY-MM` 형식으로만 표시된다 (예: `2010-05`). **일(day) 단위 헤더는 없다.**
- 헤더에는 위치 정보(`.synofoto-item-timeline-header-first-geocoding` / `-second-geocoding`)도 함께 표시된다.
- 헤더에 마우스를 올리면 그룹 전체를 선택하는 체크박스(`.synofoto-selectable-checkbox`, 아이콘 클래스 `group-check-on-btn-icon`)가 나타난다.

## 5. 특정 연/월로 좁히는 방법 — 우측 필터 패널

1. 툴바의 `[data-tooltip-content="필터 표시"]` 버튼으로 필터 패널을 연다.
2. 기본으로는 최근 5개 연도만 보이므로 `text=더 보기`를 클릭해 전체 연도(2008~올해)를 펼친다.
3. 연도 라벨(`.synofoto-filter-tree-text-label`, 텍스트 `"2010"`)을 찾아 `.closest('.synofoto-form-checkbox').parentElement` 안의
   `.synofoto-treebeard-toggle`을 클릭하면 해당 연도의 월 목록이 펼쳐진다 (`"1월"` ~ `"12월"`, 실제 사진이 있는 달만 표시됨).
4. 월 라벨을 찾아 `.closest('label.synofoto-form-checkbox-label')`을 클릭하면 체크되고, 타임라인이 해당 연-월로 필터링된다.

**중요한 한계**: 필터 트리는 **연도 > 월까지만** 지원하고 일(day) 단위 필터는 없다.
같은 달에 서로 다른 날짜의 이벤트 사진이 섞여 있으면(예: 2010년 12월 25일 + 26일 사진이 모두 "2010-12" 한 그룹에 섞임),
필터+그룹만으로는 날짜를 구분할 수 없다. 이 경우 개별 사진을 열어(`더블클릭` → 정보 아이콘 `ⓘ`) 정확한 촬영일을 확인해야 한다
("자세히" 패널에 `YYYY-MM-DD` 형식으로 정확한 날짜가 표시됨). Phase 3 구현 시 이 케이스는 자동 추정하지 말고
`skipped` + 로그로 남기고 사용자에게 알리는 방향으로 처리할 계획이다 (PLAN.md 참고).

## 6. 사진 선택 / 다운로드 흐름

1. 사진 위에 마우스를 올리면 개별 체크박스(`.synofoto-item-timeline-item` 안의 `.synofoto-selectable-checkbox`)가 나타난다.
2. 하나 이상 선택하면 화면 하단에 선택 툴바가 뜨고 `[data-tooltip-content="다운로드"]` 버튼이 있다.
3. 다운로드 버튼을 클릭하면 작은 팝업 메뉴로 `원본` / `압축 JPEG` 두 옵션이 나타난다 (`text=압축 JPEG`로 클릭).
4. **다운로드 동작**:
   - 사진 1장만 선택 시 → 원본 파일명 그대로 즉시 다운로드됨 (zip 아님). 예: `IMG_0184.JPG_compressed.JPEG`.
   - 2장 이상 선택 시 → `download.zip`이라는 이름의 zip 파일 하나로 압축되어 다운로드됨.
   - 압축 JPEG 다운로드 파일명 규칙(`원본이름_compressed.JPEG`)이 이미 로컬에 받아둔 2010년 폴더의 파일들과 동일한 패턴이라 서로 호환된다.
5. `page.waitForEvent('download')`로 다운로드 완료를 기다리면 된다 (Playwright 공식 Downloads API로 정상 동작 확인됨).

## 7. 실측 검증 예시

- 2010년 5월(20100516_찬양팀 인도): 필터로 "2010 > 5월" 선택 → 헤더 "2010-05" 아래 11장 → 그룹 전체선택 체크박스 클릭 →
  다운로드 → 압축 JPEG → `download.zip` (11개 파일, `P1005160xx.jpg_compressed.JPEG` 패턴) 정상 다운로드 확인.
- 2010년 12월(20101225 + 20101226 x3 폴더): 필터로 "2010 > 12월" 선택 시 12/25, 12/26 사진이 한 그룹("2010-12")에 섞여 나옴 →
  이 필터만으로는 폴더별로 자동 분리할 수 없음이 확인됨 (5번 항목의 한계 참고).

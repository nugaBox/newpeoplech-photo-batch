// Synology Photos 타임라인 화면 조작 헬퍼 (docs/DOM_NOTES.md, selectors.json 참고)
const SELECTORS = require('../../selectors.json').timeline;

// SYNO.Foto.Search.Filter 응답이 아직 안 와서 "사용 가능한 조건 없음"으로 잠깐 비어있는 경우가 있어
// 연도 트리가 실제로 채워질 때까지 폴링한다. 필터를 열거나 초기화/확장하는 클릭 이후에는 항상 이걸 거쳐야 한다.
async function waitForFilterTreeReady(page) {
  await page.waitForFunction(() => !!document.querySelector('.synofoto-filter-tree-text-label'), { timeout: 20000 });
}

async function openFilterPanel(page) {
  const alreadyOpen = await page.evaluate(() => !!document.querySelector('.synofoto-toolbar-panel.filter-on'));
  if (!alreadyOpen) {
    await page.click(SELECTORS.filterToggleButton);
    await page.waitForTimeout(800);
  }
  await waitForFilterTreeReady(page);
}

async function clearFilters(page) {
  const hasClearButton = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).some((el) => el.textContent && el.textContent.trim() === '모두 지우기' && el.children.length === 0);
  });
  if (!hasClearButton) return;
  await page.click('text=모두 지우기');
  await page.waitForTimeout(500);
  // "모두 지우기"는 필터 조건을 다시 불러오므로 트리가 잠깐 비었다가 다시 채워진다.
  await waitForFilterTreeReady(page);
}

async function ensureAllYearsVisible(page) {
  const moreVisible = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*')).some((el) => el.textContent && el.textContent.trim() === '더 보기' && el.children.length === 0);
  });
  if (moreVisible) {
    await page.click('text=더 보기');
    await page.waitForTimeout(800);
  }
}

async function expandYear(page, year) {
  const expanded = await page.evaluate((y) => {
    const labels = Array.from(document.querySelectorAll('.synofoto-filter-tree-text-label'));
    // year label appears twice when expanded (scrollbar quick-jump + tree). Month labels ("N월") only exist when expanded.
    return labels.some((l) => /^\d{1,2}월$/.test(l.textContent.trim()));
  }, year);

  await page.evaluate((y) => {
    const label = Array.from(document.querySelectorAll('.synofoto-filter-tree-text-label')).find(
      (l) => l.textContent.trim() === String(y)
    );
    if (!label) throw new Error(`필터 트리에서 연도를 찾지 못함: ${y}`);
    const container = label.closest('.synofoto-form-checkbox').parentElement;
    const toggle = container.querySelector('.synofoto-treebeard-toggle');
    if (toggle) toggle.click();
  }, year);
  await page.waitForTimeout(800);
}

async function checkMonth(page, monthLabel) {
  const clicked = await page.evaluate((m) => {
    const label = Array.from(document.querySelectorAll('.synofoto-filter-tree-text-label')).find(
      (l) => l.textContent.trim() === m
    );
    if (!label) return false;
    label.closest('label.synofoto-form-checkbox-label').click();
    return true;
  }, monthLabel);
  if (!clicked) {
    throw new Error(`필터 트리에서 월을 찾지 못함(해당 연도에 사진이 없을 수 있음): ${monthLabel}`);
  }
  await page.waitForTimeout(1500);
}

// 필터를 연-월(year, month: '01'~'12')로 좁힌다. 실패해도(해당 달에 사진이 전혀 없으면) 예외를 던진다.
async function filterToYearMonth(page, year, month) {
  await openFilterPanel(page);
  await clearFilters(page);
  await ensureAllYearsVisible(page);
  await expandYear(page, year);
  const monthLabel = `${parseInt(month, 10)}월`;
  await checkMonth(page, monthLabel);
}

// 무한 스크롤로 로드되는 그리드를 끝까지 스크롤해 해당 달의 모든 사진을 DOM에 올린다.
async function scrollGridToLoadAll(page, maxIterations = 30) {
  let previousCount = -1;
  for (let i = 0; i < maxIterations; i++) {
    const count = await page.evaluate(() => document.querySelectorAll('.synofoto-item-timeline-item').length);
    if (count === previousCount) return count;
    previousCount = count;
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(600);
  }
  return previousCount;
}

async function getItemCount(page) {
  return page.evaluate(() => document.querySelectorAll('.synofoto-item-timeline-item').length);
}

async function getItemCenter(page, index) {
  return page.evaluate((idx) => {
    const el = document.querySelectorAll('.synofoto-item-timeline-item')[idx];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, index);
}

// 열려 있는 라이트박스가 있으면 닫는다. 이전 항목 처리 중 라이트박스를 연 채로 예외가 나면
// 화면 전체를 덮은 채 남아서 이후 모든 항목의 클릭이 막히므로, 각 항목 시작 전에 항상 확인한다.
async function ensureLightboxClosed(page) {
  const isOpen = await page.evaluate(() => !!document.querySelector('.synofoto-lightbox-toolbar-left-button'));
  if (!isOpen) return;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// 첫 사진의 라이트박스를 열고 정보 패널을 켠 뒤 ArrowRight로 순회하며 각 사진의 정확한 촬영일(YYYY-MM-DD)을 읽는다.
// 중간에 실패하더라도 라이트박스는 반드시 닫아서 다음 항목이 막히지 않게 한다.
async function readExactDatesForAllItems(page, count) {
  if (count === 0) return [];

  const center = await getItemCenter(page, 0);
  await page.mouse.dblclick(center.x, center.y);
  await page.waitForSelector(SELECTORS.lightboxToolbarRightButtons, { timeout: 15000 });
  await page.waitForTimeout(400);

  try {
    const dateLocator = page.locator(SELECTORS.lightboxDateSelector);
    const infoAlreadyOpen = await dateLocator.count();
    if (infoAlreadyOpen === 0) {
      await page.locator(SELECTORS.lightboxToolbarRightButtons).nth(2).click();
      await page.waitForSelector(SELECTORS.lightboxDateSelector, { timeout: 15000 });
      await page.waitForTimeout(400);
    }

    const dates = [];
    for (let i = 0; i < count; i++) {
      const text = (await dateLocator.textContent({ timeout: 15000 })).trim();
      dates.push(text);
      if (i < count - 1) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(600);
      }
    }
    return dates;
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
}

// dates[i] === targetDate 인 항목들의 체크박스를 선택한다. 선택된 개수를 반환한다.
async function selectItemsByDate(page, dates, targetDate) {
  const indices = dates.map((d, i) => (d === targetDate ? i : -1)).filter((i) => i >= 0);
  for (const idx of indices) {
    const center = await getItemCenter(page, idx);
    if (!center) continue;
    await page.mouse.move(center.x, center.y);
    await page.waitForTimeout(150);
    await page.evaluate((i) => {
      const el = document.querySelectorAll('.synofoto-item-timeline-item')[i];
      el.querySelector('.synofoto-selectable-checkbox').click();
    }, idx);
  }
  return indices.length;
}

// 선택된 항목을 "압축 JPEG"로 다운로드하고 저장된 경로를 반환한다.
async function downloadSelectedCompressed(page, saveDir) {
  await page.click(SELECTORS.selectionToolbarDownloadButton);
  await page.waitForTimeout(500);
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.click(SELECTORS.downloadFormatCompressedOption);
  const download = await downloadPromise;
  const path = require('path');
  const savePath = path.join(saveDir, download.suggestedFilename());
  await download.saveAs(savePath);
  return savePath;
}

module.exports = {
  filterToYearMonth,
  scrollGridToLoadAll,
  getItemCount,
  readExactDatesForAllItems,
  selectItemsByDate,
  downloadSelectedCompressed,
  ensureLightboxClosed,
};

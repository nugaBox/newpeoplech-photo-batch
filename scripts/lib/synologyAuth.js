// Synology Photos 로그인 + 타임라인 진입 공통 로직 (docs/DOM_NOTES.md, selectors.json 참고)
const path = require('path');

const SELECTORS = require('../../selectors.json');

// PHOTO_URL로 이동해 세션이 남아있으면 통과, 아니면 .env의 PHOTO_ID/PHOTO_PW로 로그인한다.
async function loginIfNeeded(page) {
  const photoUrl = process.env.PHOTO_URL;
  await page.goto(photoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 로그인 세션이 남아있으면 cloud.* -> photo.* 로 추가 리다이렉트가 한 번 더 일어난다.
  // 리다이렉트/네트워크가 완전히 가라앉을 때까지 기다려야 이후 evaluate가 "context destroyed"로 죽지 않는다.
  await page
    .waitForLoadState('networkidle', { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  if (!page.url().includes('signin')) {
    return; // 이미 로그인된 세션
  }

  await page.fill(SELECTORS.login.usernameInput, process.env.PHOTO_ID);
  await page.click(SELECTORS.login.usernameNextButton);
  await page.waitForTimeout(1500);
  await page.fill(SELECTORS.login.passwordInput, process.env.PHOTO_PW);
  await page.click(SELECTORS.login.passwordSubmitButton);
  await page.waitForTimeout(5000);

  if (page.url().includes('signin')) {
    throw new Error('자동 로그인 실패 (2FA 등으로 막혔을 수 있음). headless:false로 실행해 수동 로그인 후 다시 시도하세요.');
  }
}

// 로그인된 페이지에서 타임라인 화면으로 인앱 이동한다 (직접 URL 이동은 실패함).
// 로그인 직후에는 아직 리다이렉트/렌더링이 끝나지 않아 evaluate가 "Execution context was destroyed"로
// 실패할 수 있어, 그런 경우 잠깐 기다렸다가 재시도한다.
async function goToTimeline(page) {
  const config = require('../../config.json');
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, config.timelineHashRoute);
      await page.waitForTimeout(3000);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await page.waitForTimeout(2000);
    }
  }
}

module.exports = { loginIfNeeded, goToTimeline };

// Synology Photos 로그인 + 타임라인 진입 공통 로직 (docs/DOM_NOTES.md, selectors.json 참고)
const path = require('path');

const SELECTORS = require('../../selectors.json');

// PHOTO_URL로 이동해 세션이 남아있으면 통과, 아니면 .env의 PHOTO_ID/PHOTO_PW로 로그인한다.
async function loginIfNeeded(page) {
  const photoUrl = process.env.PHOTO_URL;
  await page.goto(photoUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

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
async function goToTimeline(page) {
  const config = require('../../config.json');
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, config.timelineHashRoute);
  await page.waitForTimeout(3000);
}

module.exports = { loginIfNeeded, goToTimeline };

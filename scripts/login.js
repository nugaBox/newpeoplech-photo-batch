// .env의 PHOTO_ID/PHOTO_PW로 Synology Photos에 자동 로그인하고 세션을 .auth/에 저장한다.
// 2FA 등으로 자동 로그인이 막히면 브라우저가 로그인 화면에 멈춘 채로 남으므로 직접 로그인 후 Enter를 누르면 된다.
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const config = require('../config.json');
const { loginIfNeeded, goToTimeline } = require('./lib/synologyAuth');

function waitForEnter(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(message, () => { rl.close(); resolve(); }));
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const authProfileDir = path.resolve(projectRoot, config.authProfileDir);

  const context = await chromium.launchPersistentContext(authProfileDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] || (await context.newPage());

  try {
    await loginIfNeeded(page);
    console.log('로그인 성공, 세션이 저장됩니다:', authProfileDir);
  } catch (err) {
    console.warn(err.message);
    await waitForEnter('브라우저에서 직접 로그인을 완료한 후 Enter를 누르세요...');
  }

  await goToTimeline(page);
  console.log('타임라인 페이지 확인:', page.url());

  await context.close();
}

main().catch((err) => {
  console.error('로그인 스크립트 실패:', err);
  process.exit(1);
});

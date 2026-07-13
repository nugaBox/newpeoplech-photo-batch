// 광주새백성교회 웹사이트 게시판 로그인
const LOGIN_URL = 'https://www.newpeoplech.com/login.do?pageId=www27';

async function loginToBoard(page, userId, password) {
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.fill('#userId', userId);
  await page.fill('#passwd', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
    page.click('#loginSubmit'),
  ]);
  await page.waitForTimeout(1500);

  const url = page.url();
  if (url.includes('login.do')) {
    throw new Error('로그인 실패: 로그인 페이지에 머물러 있습니다.');
  }
}

module.exports = { LOGIN_URL, loginToBoard };

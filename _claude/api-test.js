// 읽기 전용 API 점검 (게시글을 만들지 않는다). 키는 출력하지 않는다.
const BASE = 'https://www.newpeoplech.com';
const key = process.env.SIIRU_API_KEY || '';
const show = async (name, res) => {
  const t = await res.text();
  console.log(`## ${name}\nHTTP ${res.status}\n${t.slice(0, 1500)}\n`);
};
const exists = (q, k = key) => fetch(`${BASE}/api/bb/boardExists.do?${new URLSearchParams(q)}`, { headers: k ? { 'X-SIIRU-API-KEY': k } : {} });
function multipart(fields) {
  const b = '----npcTest' + Date.now();
  const body = Buffer.from(fields.map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`, 'utf8');
  return { body, headers: { 'X-SIIRU-API-KEY': key, 'Content-Type': `multipart/form-data; boundary=${b}`, 'Content-Length': String(body.length) } };
}
const reg = (fields) => { const m = multipart(fields); return fetch(`${BASE}/api/bb/boardReg.do`, { method: 'POST', headers: m.headers, body: m.body }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  console.log('key:', key ? `set (length ${key.length})` : 'NOT SET');
  const steps = [
    ['T1 키 없이 boardExists (기대 401)', () => exists({ boardId: 'PHOTO', boardSj: 'x' }, '')],
    ['T2 PHOTO boardExists 기존 글 남전도회 헌신예배 2026-09-20 (기대 exists=true)', () => exists({ boardId: 'PHOTO', boardSj: '남전도회 헌신예배', etc1: '2026-09-20' })],
    ['T3 같은 제목 다른 날짜 2026-09-21 (dupKeys.PHOTO=etc1이면 exists=false)', () => exists({ boardId: 'PHOTO', boardSj: '남전도회 헌신예배', etc1: '2026-09-21' })],
    ['T4 새 행사 여전도회 헌신예배 2026-10-18', () => exists({ boardId: 'PHOTO', boardSj: '여전도회 헌신예배', etc1: '2026-10-18' })],
    ['T5 새 행사 생일자 축하 2026-10-18', () => exists({ boardId: 'PHOTO', boardSj: '생일자 축하', etc1: '2026-10-18' })],
    ['T6 boardReg 제목 없이 + ctgryNm=2026 (등록 안 됨, 기대 400: 권한·분류 확인용)', () => reg([['boardId', 'PHOTO'], ['ctgryNm', '2026'], ['etc1', '2026-10-18']])],
    ['T7 boardReg 제목 없이, 분류 없이 (기대 400 boardSj만)', () => reg([['boardId', 'PHOTO'], ['etc1', '2026-10-18']])],
  ];
  for (const [name, fn] of steps) {
    try { await show(name, await fn()); } catch (e) { console.log(`## ${name}\nERROR ${e.message}\n`); }
    await sleep(2200);
  }
})();

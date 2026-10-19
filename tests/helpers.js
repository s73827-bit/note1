// 테스트 공용 도우미
// - 테스트마다 새 브라우저 저장소(localStorage·IndexedDB)로 시작합니다.
// - 시계는 2026-10-21(수) 10:00 KST로 고정합니다. (타이머는 그대로 동작)
// - alert/confirm은 기본으로 「확인」을 누르고, 메시지를 dialogs에 모아 둡니다.
//   confirm에서 「취소」를 누르려면 dialogs.answers.push(false)

const { test: base, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const KEY = 'grooming-data-v1';
const NOW = '2026-10-21T10:00:00+09:00'; // 수요일
const TODAY = '2026-10-21';
const TOMORROW = '2026-10-22';
const YESTERDAY = '2026-10-20';

const test = base.extend({
  dialogs: [async ({ page }, use) => {
    const log = [];
    log.answers = [];
    log.messages = () => log.map((d) => d.message);
    page.on('dialog', async (d) => {
      log.push({ type: d.type(), message: d.message() });
      const answer = log.answers.length ? log.answers.shift() : true;
      if (answer) await d.accept(); else await d.dismiss();
    });
    await use(log);
  }, { auto: true }]
});

// 앱 열기. data를 주면 처음 한 번만 localStorage에 넣습니다(새로고침해도 다시 넣지 않음).
async function openApp(page, { data, now = NOW } = {}) {
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  if (data !== undefined) {
    await page.addInitScript(([key, json]) => {
      if (!sessionStorage.getItem('__seeded')) {
        localStorage.setItem(key, json);
        sessionStorage.setItem('__seeded', '1');
      }
    }, [KEY, typeof data === 'string' ? data : JSON.stringify(data)]);
  }
  await page.goto(APP_URL);
}

function getDb(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
}

/* ---------- 예시 데이터 ---------- */

// 보호자 2명(김민지: 초코·보리 / 박서준: 콩이)
function sample(extra = {}) {
  return {
    owners: [
      { id: 'o1', name: '김민지', phone: '010-1234-5678', memo: '' },
      { id: 'o2', name: '박서준', phone: '010-9876-5432', memo: '' }
    ],
    dogs: [
      { id: 'd1', ownerId: 'o1', name: '초코', breed: '말티즈', weight: 2.8, temper: '발 만지면 예민' },
      { id: 'd2', ownerId: 'o1', name: '보리', breed: '푸들', weight: 6, temper: '특이사항 없음' },
      { id: 'd3', ownerId: 'o2', name: '콩이', breed: '비숑', weight: 8.5, temper: '물림 주의' }
    ],
    records: [],
    reservations: [],
    ...extra
  };
}

function rec(id, dogId, date, menu, price, more = {}) {
  return { id, dogId, date, menu, style: '', price, nextWeeks: 0, note: '', extras: [], ...more };
}

function res(id, dogId, date, start, more = {}) {
  return { id, dogId, date, start, minutes: 90, menu: '목욕', memo: '', status: 'scheduled', recordId: '', remindedAt: '', ...more };
}

const EXAMPLE_TABLE = {
  brackets: [3, 5, 7],
  menus: [
    { id: 'm1', name: '목욕', prices: [25000, 30000, 35000, 40000] },
    { id: 'm2', name: '부분컷', prices: [35000, 40000, null, 50000] }
  ],
  extras: [{ id: 'x1', name: '엉킴', price: 10000 }, { id: 'x2', name: '입질', price: 5000 }]
};

/* ---------- 화면 조작 ---------- */

async function registerCustomer(page, c) {
  await page.click('#btn-new');
  await page.fill('#o-name', c.owner ?? '이하늘');
  await page.fill('#o-phone', c.phone ?? '010-5555-1234');
  if (c.memo) await page.fill('#o-memo', c.memo);
  await page.fill('#d-name', c.dog ?? '몽이');
  await page.fill('#d-breed', c.breed ?? '포메라니안');
  await page.fill('#d-weight', String(c.weight ?? 3.2));
  await page.fill('#d-temper', c.temper ?? '특이사항 없음');
  await page.click('#dlg button[type=submit]');
}

async function selectDog(page, name) {
  await page.locator('#list .item', { hasText: name }).click();
  await expect(page.locator('#detail h2').first()).toContainText(name);
}

async function addRecord(page, r = {}) {
  if (r.date) await page.fill('#r-date', r.date);
  await page.fill('#r-menu', r.menu ?? '목욕');
  await page.fill('#r-price', String(r.price ?? 30000));
  if (r.next != null) await page.fill('#r-next', String(r.next));
  if (r.note) await page.fill('#r-note', r.note);
  await page.click('#rec-form button[type=submit]');
}

async function tab(page, name) {
  await page.click(`.tab[data-tab="${name}"]`);
}

// 업로드용 파일(브라우저 안에서 PNG를 만들어서 가져옴)
async function makePng(page, w = 40, h = 30, color = '#f80') {
  const b64 = await page.evaluate(([w, h, color]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h, color]);
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

function jsonFile(obj, name = 'backup.json') {
  return { name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) };
}

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = {
  test, expect, APP_URL, KEY, NOW, TODAY, TOMORROW, YESTERDAY,
  openApp, getDb, sample, rec, res, EXAMPLE_TABLE,
  registerCustomer, selectDog, addRecord, tab, makePng, jsonFile, readDownload
};

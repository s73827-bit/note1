// 4단계: 알림 (지금 = 2026-10-21 수 10:00)
const { test, expect, openApp, getDb, sample, res, tab, TODAY, TOMORROW, YESTERDAY } = require('./helpers');

function data(more = {}) {
  return sample({
    reservations: [
      res('t1', 'd1', TODAY, '08:00', { minutes: 60 }),           // 오늘 + 지난 예약(09:00에 끝남)
      res('t2', 'd2', TODAY, '14:00'),                            // 오늘
      res('y1', 'd3', YESTERDAY, '15:00'),                        // 지난 예약
      res('m1', 'd1', TOMORROW, '11:00', { menu: '전체컷' }),       // 안내 안 보냄
      res('m2', 'd3', TOMORROW, '09:30', { remindedAt: '2026-10-21T00:30:00.000Z' }), // 보냄
      res('m3', 'd2', TOMORROW, '13:00', { status: 'canceled' })  // 제외
    ],
    ...more
  });
}

const DEFAULT_M1 = '안녕하세요 김민지님, 초코 미용 예약 안내드려요.\n10월 22일(목) 오전 11:00에 뵙겠습니다. 일정 변경은 이 번호로 연락 주세요.';
const ntRow = (page, id) => page.locator(`.nt-row[data-id="${id}"]`);

// sms: 링크로 실제 이동하지 않게 막습니다(앱의 클릭 처리는 그대로 실행됨).
async function blockSmsNavigation(page) {
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a[href^="sms:"]')) e.preventDefault(); }, true));
}

test('요약 띠와 탭 숫자', async ({ page }) => {
  await openApp(page, { data: data() });
  await expect(page.locator('#notify-banner')).toContainText('오늘 예약 2건 · 안내 안 보낸 내일 예약 1건 · 처리 안 된 지난 예약 2건');
  await expect(page.locator('.tab[data-tab="notify"] .badge')).toHaveText('1');
});

test('예약이 없으면 요약 띠와 숫자가 숨겨진다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await expect(page.locator('#notify-banner')).toBeHidden();
  await expect(page.locator('.tab[data-tab="notify"] .badge')).toBeHidden();
});

test('✕로 띠를 닫고, 「알림 보기」로 알림 탭을 연다', async ({ page }) => {
  await openApp(page, { data: data() });
  await page.click('[data-nt-action="banner-open"]');
  await expect(page.locator('#view-notify')).toBeVisible();
  await page.click('[data-nt-action="banner-close"]');
  await expect(page.locator('#notify-banner')).toBeHidden();
});

test('오늘 할 일: 오늘 예약과 처리 안 된 지난 예약', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'notify');
  const body = page.locator('#notify-body');
  await expect(body.locator('h2').first()).toContainText('10월 21일(수)');
  await expect(body).toContainText('오늘 예약 2건');
  await expect(page.locator('#nt-overdue .item')).toHaveText([/10월 20일\(화\) 15:00 콩이/, /08:00 초코/]);
  await page.locator('#nt-overdue .item').first().click();
  await expect(page.locator('#view-calendar')).toBeVisible();
  await expect(page.locator('#res-view-dlg')).toBeVisible();
});

test('내일 안내 문자: 시간순, 기본 문구(가게 이름 없으면 [가게] 생략), 문자 링크', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'notify');
  await expect(page.locator('#nt-date')).toHaveValue(TOMORROW);
  await expect(page.locator('.nt-row')).toHaveCount(2);
  await expect(page.locator('.nt-row').first()).toHaveAttribute('data-id', 'm2');
  await expect(ntRow(page, 'm1').locator('.nt-text')).toHaveText(DEFAULT_M1);
  await expect(ntRow(page, 'm1').locator('a[data-nt-action="open-sms"]')).toHaveAttribute('href', 'sms:01012345678?body=' + encodeURIComponent(DEFAULT_M1));
  await expect(ntRow(page, 'm2')).toHaveClass(/sent/);
  await expect(ntRow(page, 'm2')).toContainText('보냄 ✓ 10/21 09:30');
});

test('아이폰은 &body= 형식', async ({ page }) => {
  await openApp(page, { data: data() });
  expect(await page.evaluate(() => [smsLink('010-1-2', 'a b', true), smsLink('010-1-2', 'a b', false)])).toEqual(['sms:01012&body=a%20b', 'sms:01012?body=a%20b']);
});

test('시간 표기', async ({ page }) => {
  await openApp(page, { data: data() });
  expect(await page.evaluate(() => ['09:00', '12:00', '14:30', '00:15'].map(formatKoTime))).toEqual(['오전 9:00', '오후 12:00', '오후 2:30', '오전 12:15']);
});

test('「문자 열기」를 누르면 보냄 표시, 「보냄 취소」로 되돌린다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'notify');
  await blockSmsNavigation(page);
  await ntRow(page, 'm1').locator('[data-nt-action="open-sms"]').click();
  await expect(ntRow(page, 'm1')).toContainText('보냄 ✓ 10/21 10:00');
  await expect(ntRow(page, 'm1').locator('[data-nt-action="open-sms"]')).toHaveText('문자 다시 열기');
  await expect(page.locator('.tab[data-tab="notify"] .badge')).toBeHidden();
  expect((await getDb(page)).reservations.find((r) => r.id === 'm1').remindedAt).toBe('2026-10-21T01:00:00.000Z');
  await ntRow(page, 'm1').locator('[data-nt-action="unsend"]').click();
  await expect(ntRow(page, 'm1')).not.toHaveClass(/sent/);
  await expect(page.locator('.tab[data-tab="notify"] .badge')).toHaveText('1');
});

test('「문구 복사」도 보냄으로 표시한다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'notify');
  await ntRow(page, 'm1').locator('[data-nt-action="copy"]').click();
  await expect(ntRow(page, 'm1')).toHaveClass(/sent/);
});

test('예약 날짜·시간을 바꾸면 보냄 표시가 지워지고, 메뉴만 바꾸면 남는다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'calendar');
  const edit = async (change) => {
    await page.click('.res-block[data-id="m2"]');
    await page.click('[data-res-action="edit"]');
    await change();
    await page.click('#res-form button[type=submit]');
    await page.click('[data-res-action="close"]');
  };
  await edit(() => page.fill('#res-menu', '스파'));
  expect((await getDb(page)).reservations.find((r) => r.id === 'm2').remindedAt).not.toBe('');
  await edit(() => page.selectOption('#res-start', '10:00'));
  expect((await getDb(page)).reservations.find((r) => r.id === 'm2').remindedAt).toBe('');
});

test('연락처가 없으면 버튼 대신 안내하고, 숫자에서도 뺀다', async ({ page }) => {
  const d = data();
  d.owners[0].phone = '';
  await openApp(page, { data: d });
  await expect(page.locator('#notify-banner')).not.toContainText('안내 안 보낸');
  await tab(page, 'notify');
  await expect(ntRow(page, 'm1')).toContainText('연락처 없음');
  await expect(ntRow(page, 'm1').locator('a')).toHaveCount(0);
});

test('날짜를 바꾸면 그날의 예정 예약이 나온다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'notify');
  await page.fill('#nt-date', TODAY);
  await expect(page.locator('.nt-row')).toHaveCount(2);
  await page.fill('#nt-date', '2026-12-25');
  await expect(page.locator('#notify-body')).toContainText('12월 25일(금)에 「예정」인 예약이 없습니다.');
});

test('가게 이름과 문구를 저장하면 안내 문구에 반영되고, 기본 문구로 되돌릴 수 있다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'notify');
  await page.fill('#nt-shop', '뽀송미용실');
  await page.click('[data-nt-action="save-settings"]');
  await expect(ntRow(page, 'm1').locator('.nt-text')).toHaveText('[뽀송미용실] ' + DEFAULT_M1);

  await page.fill('#nt-template', '{반려견} {메뉴} {날짜} {시간}');
  await page.click('[data-nt-action="save-settings"]');
  await expect(ntRow(page, 'm1').locator('.nt-text')).toHaveText('초코 전체컷 10월 22일(목) 오전 11:00');
  expect((await getDb(page)).settings).toEqual({ shopName: '뽀송미용실', reminderTemplate: '{반려견} {메뉴} {날짜} {시간}' });

  await page.click('[data-nt-action="reset-template"]');
  await expect(page.locator('#nt-template')).toHaveValue(/미용 예약 안내드려요/);
});

// 3단계: 매출 통계 (오늘 = 2026-10-21)
const { test, expect, openApp, sample, rec, tab } = require('./helpers');

const stat = (page, label) => page.locator('.stat', { hasText: label });

function data(extraRecords = [], extra = {}) {
  return sample({
    records: [
      rec('a', 'd1', '2026-10-05', '목욕', 30000),
      rec('b', 'd2', '2026-10-15', '목 욕', 30000),
      rec('c', 'd3', '2026-10-25', '전체컷', 50000), // 이번 달이지만 오늘 이후
      rec('d', 'd1', '2026-09-10', '목욕', 40000),
      rec('e', 'd3', '2026-09-25', '스포팅', 60000),
      ...extraRecords
    ],
    ...extra
  });
}

test('이번 달 요약: 총매출·건수·평균, 1일~오늘을 지난달 같은 기간과 비교', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'stats');
  await expect(page.locator('#stats-label')).toHaveText('2026년 10월');
  await expect(stat(page, '총매출').locator('.stat-value')).toHaveText('110,000원');
  await expect(stat(page, '방문 건수').locator('.stat-value')).toHaveText('3건');
  await expect(stat(page, '1건당 평균').locator('.stat-value')).toHaveText('36,667원');
  const change = stat(page, '지난달 같은 기간 대비');
  await expect(change.locator('.stat-value')).toHaveText('▲ 50%'); // 60,000 vs 40,000
  await expect(change.locator('.stat-sub')).toHaveText('지난달 1~21일 40,000원');
  await expect(change).toHaveClass(/up/);
});

test('지난달 매출이 없으면 「비교 불가」', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'stats');
  await page.click('#stats-prev');
  await expect(page.locator('#stats-label')).toHaveText('2026년 9월');
  await expect(stat(page, '총매출').locator('.stat-value')).toHaveText('100,000원');
  await expect(stat(page, '지난달 대비').locator('.stat-value')).toHaveText('비교 불가');
});

test('지난 달은 한 달 전체끼리 비교하고 감소는 ▼로 표시', async ({ page }) => {
  await openApp(page, { data: data([rec('f', 'd1', '2026-08-31', '목욕', 200000)]) });
  await tab(page, 'stats');
  await page.click('#stats-prev');
  const change = stat(page, '지난달 대비');
  await expect(change.locator('.stat-value')).toHaveText('▼ 50%');
  await expect(change).toHaveClass(/down/);
});

test('메뉴 TOP: 띄어쓰기만 다른 메뉴는 하나로 묶는다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'stats');
  const rows = page.locator('.stats-grid .card', { hasText: '메뉴 TOP' }).locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('2건');
  await expect(rows.nth(0)).toContainText('60,000원');
  await expect(rows.nth(1)).toContainText('전체컷');
});

test('고객 TOP은 보호자 기준이고, 이름을 누르면 고객 화면으로 간다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'stats');
  const rows = page.locator('.stats-grid .card', { hasText: '고객 TOP' }).locator('tbody tr');
  await expect(rows.nth(0)).toContainText('김민지');
  await expect(rows.nth(0)).toContainText('초코, 보리');
  await expect(rows.nth(0)).toContainText('2회');
  await expect(rows.nth(1)).toContainText('박서준');
  await rows.nth(1).locator('button.link').click();
  await expect(page.locator('#view-customers')).toBeVisible();
  await expect(page.locator('#detail h2').first()).toContainText('콩이');
});

test('날짜별 그래프는 그 달 날짜 수만큼, 12개월 그래프는 보고 있는 달을 강조', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'stats');
  await expect(page.locator('#chart-daily .bar')).toHaveCount(31);
  await expect(page.locator('#chart-daily .bar[data-key="2026-10-05"]')).toHaveAttribute('data-value', '30000');
  const monthly = page.locator('#chart-monthly .bar');
  await expect(monthly).toHaveCount(12);
  await expect(monthly.last()).toHaveClass(/current/);
  await expect(monthly.last()).toHaveAttribute('data-key', '2026-10');
  await expect(monthly.first()).toHaveAttribute('data-key', '2025-11');
  // 막대에 마우스를 올리면 금액 말풍선
  await page.locator('#chart-daily .bar[data-key="2026-10-15"]').hover();
  await expect(page.locator('.chart-tip')).toContainText('10월 15일 (목)');
  await expect(page.locator('.chart-tip')).toContainText('30,000원');
});

test('기록이 없는 달은 안내만 나온다', async ({ page }) => {
  await openApp(page, { data: data() });
  await tab(page, 'stats');
  await page.click('#stats-next');
  await expect(page.locator('#stats-body .placeholder')).toHaveText('이 달에는 미용 기록이 없습니다.');
  await expect(stat(page, '1건당 평균').locator('.stat-value')).toHaveText('-');
  await page.click('#stats-today');
  await expect(page.locator('#stats-label')).toHaveText('2026년 10월');
});

test('잘못된 금액은 0원, 날짜 형식이 틀린 기록은 빼고 계산한다', async ({ page }) => {
  await openApp(page, { data: data([rec('x', 'd1', '2026-10-07', '목욕', -5000), rec('y', 'd1', '2026-10', '목욕', 99999), rec('z', 'd1', '2026-10-08', '목욕', 'abc')]) });
  await tab(page, 'stats');
  await expect(stat(page, '총매출').locator('.stat-value')).toHaveText('110,000원');
  await expect(stat(page, '방문 건수').locator('.stat-value')).toHaveText('5건');
});

test('연도를 넘어 이동한다', async ({ page }) => {
  await openApp(page, { data: data() });
  expect(await page.evaluate(() => [addMonths('2026-01', -1), addMonths('2025-12', 1), addMonths('2026-10', -22)])).toEqual(['2025-12', '2026-01', '2024-12']);
});

test('충전 결제 금액은 매출과 따로 한 줄로 보여준다', async ({ page }) => {
  const membership = { products: [], ledger: [{ id: 'l1', ownerId: 'o1', date: '2026-10-02', type: 'charge', amount: 330000, pay: 300000 }] };
  await openApp(page, { data: data([], { membership }) });
  await tab(page, 'stats');
  await expect(page.locator('.mb-stat')).toContainText('충전 결제 금액 300,000원');
  await expect(stat(page, '총매출').locator('.stat-value')).toHaveText('110,000원');
});

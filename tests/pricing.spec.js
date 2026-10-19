// 3단계: 요금표 자동 계산
const { test, expect, openApp, getDb, sample, res, rec, tab, selectDog, EXAMPLE_TABLE, TODAY } = require('./helpers');

const ptAction = (page, action) => page.click(`#pricing-body [data-pt-action="${action}"]`);

test.describe('요금표 화면', () => {
  test('처음엔 비어 있고, 예시로 시작해 저장한다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'pricing');
    await expect(page.locator('#pricing-body .placeholder')).toContainText('아직 요금표가 없습니다.');
    await ptAction(page, 'example');
    await expect(page.locator('.pt-dirty')).toBeVisible();
    await expect(page.locator('.pt-table:not(.pt-extras-table) thead th')).toHaveText(['메뉴', '~3kg', '~5kg', '~7kg', '7kg 초과', '']);
    expect((await getDb(page)).priceTable).toBeUndefined(); // 아직 저장 전
    await ptAction(page, 'save');
    expect(dialogs.messages()).toEqual(['요금표를 저장했습니다.']);
    await expect(page.locator('.pt-dirty')).toBeHidden();
    const t = (await getDb(page)).priceTable;
    expect(t.brackets).toEqual([3, 5, 7]);
    expect(t.menus.map((m) => m.name)).toEqual(['목욕', '부분컷', '전체컷', '스포팅']);
    expect(t.extras).toHaveLength(3);
  });

  test('되돌리기는 저장 안 한 변경을 버린다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await tab(page, 'pricing');
    await page.fill('.pt-price[data-m="0"][data-i="0"]', '99000');
    await expect(page.locator('.pt-dirty')).toBeVisible();
    await ptAction(page, 'revert');
    await expect(page.locator('.pt-price[data-m="0"][data-i="0"]')).toHaveValue('25000');
  });

  test('다른 탭에 다녀와도 저장 안 한 변경은 남아 있다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await tab(page, 'pricing');
    await page.fill('.pt-menu-name[data-m="1"]', '부분 미용');
    await tab(page, 'customers');
    await tab(page, 'pricing');
    await expect(page.locator('.pt-menu-name[data-m="1"]')).toHaveValue('부분 미용');
    await expect(page.locator('.pt-dirty')).toBeVisible();
  });

  test('구간을 추가하면 마지막 구간이 나뉘고, 삭제하면 다음 구간에 합쳐진다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await tab(page, 'pricing');
    await ptAction(page, 'add-bracket');
    await expect(page.locator('.pt-table:not(.pt-extras-table) thead th')).toHaveText(['메뉴', '~3kg', '~5kg', '~7kg', '~9kg', '9kg 초과', '']);
    await expect(page.locator('.pt-price[data-m="0"][data-i="3"]')).toHaveValue('');
    await expect(page.locator('.pt-price[data-m="0"][data-i="4"]')).toHaveValue('40000');
    await page.click('[data-pt-action="del-bracket"][data-i="0"]');
    await expect(page.locator('.pt-table:not(.pt-extras-table) thead th').nth(1)).toHaveText('~5kg');
    await expect(page.locator('.pt-price[data-m="0"][data-i="0"]')).toHaveValue('30000');
  });

  test('경계 숫자를 고친 직후 「저장」을 눌러도 저장된다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await tab(page, 'pricing');
    await page.fill('.pt-bracket[data-i="1"]', '4');
    await ptAction(page, 'save');
    await expect.poll(() => dialogs.messages()).toEqual(['요금표를 저장했습니다.']);
    expect((await getDb(page)).priceTable.brackets).toEqual([3, 4, 7]);
  });

  test('경계 숫자를 고치면 표 머리가 바뀐다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await tab(page, 'pricing');
    await page.fill('.pt-bracket[data-i="0"]', '2.5');
    await page.locator('.pt-bracket[data-i="0"]').blur();
    await expect(page.locator('.pt-table:not(.pt-extras-table) thead th').nth(1)).toHaveText('~2.5kg');
  });

  for (const [label, act, msg] of [
    ['구간이 오름차순이 아님', async (p) => { await p.fill('.pt-bracket[data-i="1"]', '2'); await p.locator('.pt-bracket[data-i="1"]').blur(); }, '체중 구간은 0보다 큰 숫자를'],
    ['메뉴 이름이 비어 있음', (p) => p.fill('.pt-menu-name[data-m="0"]', ' '), '메뉴 이름을 입력해주세요.'],
    ['띄어쓰기만 다른 같은 메뉴', (p) => p.fill('.pt-menu-name[data-m="1"]', '목 욕'), '같은 이름의 메뉴가 있습니다: 목 욕'],
    ['추가 항목 이름이 비어 있음', (p) => p.fill('.pt-extra-name[data-e="0"]', ''), '추가 요금 항목 이름을 입력해주세요.']
  ]) {
    test(`저장 전 검사: ${label}`, async ({ page, dialogs }) => {
      await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
      await tab(page, 'pricing');
      await act(page);
      await ptAction(page, 'save');
      expect(dialogs.messages()[0]).toContain(msg);
      expect((await getDb(page)).priceTable).toEqual(EXAMPLE_TABLE);
    });
  }
});

test.describe('체중 구간 계산', () => {
  test('경계 숫자는 그 구간에 포함된다', async ({ page }) => {
    await openApp(page, { data: sample() });
    const got = await page.evaluate(() => [0, 2.9, 3, 3.01, 5, 7, 7.1, 30, '', null].map((w) => bracketIndex(w, [3, 5, 7])));
    expect(got).toEqual([-1, 0, 0, 1, 1, 2, 3, 3, -1, -1]);
    expect(await page.evaluate(() => bracketIndex(4, []))).toBe(0);
  });
});

test.describe('기록 폼의 「요금표에서 고르기」', () => {
  test('요금표가 없으면 고르기 칸이 없다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '초코');
    await expect(page.locator('.pt-picker')).toHaveCount(0);
  });

  test('메뉴·추가 항목을 고르면 메뉴와 금액이 채워지고 기록에 추가 항목이 남는다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await selectDog(page, '콩이'); // 8.5kg → 7kg 초과
    await page.selectOption('#r-pt-menu', 'm1');
    await expect(page.locator('#r-menu')).toHaveValue('목욕');
    await expect(page.locator('#r-price')).toHaveValue('40000');
    await page.check('#r-pt-extras input[value="x1"]');
    await page.check('#r-pt-extras input[value="x2"]');
    await expect(page.locator('#r-price')).toHaveValue('55000');
    await expect(page.locator('#r-pt-info')).toHaveText('체중 8.5kg → 7kg 초과 구간 · 기본 40,000원 + 엉킴 10,000원 + 입질 5,000원 = 55,000원');
    await page.click('#rec-form button[type=submit]');
    await expect(page.locator('#detail tbody tr').first()).toContainText('+ 엉킴, 입질');
    expect((await getDb(page)).records[0]).toMatchObject({ menu: '목욕', price: 55000, extras: ['엉킴', '입질'] });
  });

  test('경계 체중(3.0kg)은 「~3kg」 금액', async ({ page }) => {
    const data = sample({ priceTable: EXAMPLE_TABLE });
    data.dogs[0].weight = 3;
    await openApp(page, { data });
    await selectDog(page, '초코');
    await page.selectOption('#r-pt-menu', 'm1');
    await expect(page.locator('#r-price')).toHaveValue('25000');
    await expect(page.locator('#r-pt-info')).toContainText('~3kg 구간');
  });

  test('구간 금액이 비어 있으면 직접 입력하라고 안내한다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE }) });
    await selectDog(page, '보리'); // 6kg → ~7kg, 부분컷은 빈 칸
    await page.selectOption('#r-pt-menu', 'm2');
    await expect(page.locator('#r-menu')).toHaveValue('부분컷');
    await expect(page.locator('#r-price')).toHaveValue('');
    await expect(page.locator('#r-pt-info')).toHaveText('체중 6kg → ~7kg 구간: 요금표에 이 구간 금액이 없어요. 금액을 직접 입력해주세요.');
    await expect(page.locator('#r-pt-info')).toHaveClass(/warn-text/);
  });

  test('체중이 0이면 계산하지 않는다', async ({ page }) => {
    const data = sample({ priceTable: EXAMPLE_TABLE });
    data.dogs[0].weight = 0;
    await openApp(page, { data });
    await selectDog(page, '초코');
    await page.selectOption('#r-pt-menu', 'm1');
    await expect(page.locator('#r-pt-info')).toContainText('체중 정보가 없어');
  });

  test('예약 메뉴가 요금표 메뉴와 같으면 완료 기록창에서 자동으로 골라진다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE, reservations: [res('a', 'd1', TODAY, '10:00', { menu: ' 목 욕' })] }) });
    await tab(page, 'calendar');
    await page.click('.res-block[data-id="a"]');
    await page.click('[data-res-action="done"]');
    await expect(page.locator('#rd-pt-menu')).toHaveValue('m1');
    await expect(page.locator('#rd-menu')).toHaveValue('목욕');
    await expect(page.locator('#rd-price')).toHaveValue('25000');
  });

  test('요금표를 바꿔도 이미 저장한 기록 금액은 그대로다', async ({ page }) => {
    await openApp(page, { data: sample({ priceTable: EXAMPLE_TABLE, records: [rec('r1', 'd1', '2026-10-01', '목욕', 25000)] }) });
    await tab(page, 'pricing');
    await page.fill('.pt-price[data-m="0"][data-i="0"]', '27000');
    await ptAction(page, 'save');
    const db = await getDb(page);
    expect(db.priceTable.menus[0].prices[0]).toBe(27000);
    expect(db.records[0].price).toBe(25000);
  });
});

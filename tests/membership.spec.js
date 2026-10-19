// 4단계: 회원권(보호자별 선불 충전금)
const { test, expect, openApp, getDb, sample, rec, res, tab, selectDog, addRecord, TODAY } = require('./helpers');

const charge = (ownerId, amount, more = {}) => ({ id: 'l-' + ownerId + amount, ownerId, date: '2026-10-01', type: 'charge', amount, pay: amount, at: 1, ...more });
const withBalance = (more = {}) => sample({ membership: { products: [], ledger: [charge('o1', 50000)] }, ...more });
const balance = (page) => page.locator('.mb-balance');
const ledger = async (page) => (await getDb(page)).membership.ledger;

test.describe('충전', () => {
  test('직접 입력으로 충전한다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '초코');
    await expect(balance(page)).toHaveText('잔액 0원');
    await page.click('[data-mb-action="charge"]');
    await expect(page.locator('#mb-charge-title')).toHaveText('충전하기 — 김민지님');
    await expect(page.locator('input[name="mb-product"][value="custom"]')).toBeChecked();
    await page.fill('#mb-pay', '300000');
    await page.fill('#mb-credit', '330000');
    await expect(page.locator('#mb-preview')).toHaveText('잔액 0원 → 330,000원');
    await page.fill('#mb-memo', '카드');
    await page.click('#mb-charge-form button[type=submit]');
    await expect(balance(page)).toHaveText('잔액 330,000원');
    await expect(page.locator('.mb-history tbody tr').first()).toContainText('받은 금액 300,000원 · 카드');
    expect((await ledger(page))[0]).toMatchObject({ ownerId: 'o1', type: 'charge', amount: 330000, pay: 300000, date: TODAY });
  });

  test('같은 보호자의 다른 반려견 화면에서도 같은 잔액이 보인다', async ({ page }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '보리');
    await expect(balance(page)).toHaveText('잔액 50,000원');
    await selectDog(page, '콩이');
    await expect(balance(page)).toHaveText('잔액 0원');
  });

  test('충전 금액이 0이면 막는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '초코');
    await page.click('[data-mb-action="charge"]');
    await page.fill('#mb-pay', '10000');
    await page.click('#mb-charge-form button[type=submit]');
    expect(dialogs.messages()).toEqual(['충전할 금액을 0보다 크게 입력해주세요.']);
  });

  test('충전 상품: 요금표 탭에서 예시로 채우고, 충전 창에서 고른다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'pricing');
    await page.click('[data-mb-action="product-example"]');
    await expect(page.locator('.mb-p-row')).toHaveCount(3);
    await expect(page.locator('.mb-p-row').nth(1)).toContainText('+10%');
    await page.fill('.mb-p-credit[data-i="0"]', '220000');
    await page.locator('.mb-p-credit[data-i="0"]').blur();
    await expect(page.locator('.mb-p-row').first()).toContainText('+10%');
    await page.click('[data-mb-action="product-del"][data-i="2"]');
    expect((await getDb(page)).membership.products.map((p) => [p.pay, p.credit])).toEqual([[200000, 220000], [300000, 330000]]);

    await tab(page, 'customers');
    await selectDog(page, '콩이');
    await page.click('[data-mb-action="charge"]');
    await expect(page.locator('#mb-pay')).toHaveValue('200000');
    await expect(page.locator('#mb-pay')).toHaveJSProperty('readOnly', true);
    await page.locator('.mb-radio').nth(1).click();
    await expect(page.locator('#mb-credit')).toHaveValue('330000');
    await page.click('#mb-charge-form button[type=submit]');
    await expect(balance(page)).toHaveText('잔액 330,000원');
  });
});

test.describe('미용 기록에서 차감', () => {
  test('잔액이 충분하면 금액 전체를 차감한다(기본 체크)', async ({ page }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await expect(page.locator('#r-use-balance')).toBeChecked();
    await page.fill('#r-price', '30000');
    await expect(page.locator('#r-mb-info')).toHaveText('30,000원 차감 · 차감 후 잔액 20,000원');
    await addRecord(page, { price: 30000 });
    await expect(balance(page)).toHaveText('잔액 20,000원');
    await expect(page.locator('#detail tbody').last()).toContainText('충전금 30,000원 사용');
  });

  test('잔액이 모자라면 잔액만큼만 차감하고 나머지는 현장 결제', async ({ page }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await page.fill('#r-price', '80000');
    await expect(page.locator('#r-mb-info')).toHaveText('50,000원 차감 · 나머지 30,000원은 현장 결제');
    await addRecord(page, { price: 80000 });
    await expect(balance(page)).toHaveText('잔액 0원');
    await expect(page.locator('#r-use-balance')).toHaveCount(0); // 잔액이 없으면 체크 칸도 없음
  });

  test('체크를 풀면 차감하지 않는다', async ({ page }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await page.uncheck('#r-use-balance');
    await expect(page.locator('#r-mb-info')).toHaveText('이번에는 충전금을 쓰지 않아요.');
    await addRecord(page, { price: 30000 });
    await expect(balance(page)).toHaveText('잔액 50,000원');
  });

  test('기록을 삭제하면 쓴 충전금이 되돌아온다', async ({ page, dialogs }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await addRecord(page, { price: 30000 });
    await page.click('[data-action="delete-rec"]');
    expect(dialogs.messages()[0]).toContain('사용한 충전금 30,000원은 잔액으로 되돌려 놓습니다.');
    await expect(balance(page)).toHaveText('잔액 50,000원');
    expect((await ledger(page)).map((e) => [e.type, e.amount])).toEqual([['charge', 50000], ['use', -30000], ['restore', 30000]]);
  });

  test('예약 완료 기록창에서도 차감된다', async ({ page }) => {
    await openApp(page, { data: withBalance({ reservations: [res('a', 'd2', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await page.click('.res-block[data-id="a"]');
    await page.click('[data-res-action="done"]');
    await expect(page.locator('#rd-use-balance')).toBeChecked();
    await page.fill('#rd-price', '20000');
    await expect(page.locator('#rd-mb-info')).toHaveText('20,000원 차감 · 차감 후 잔액 30,000원');
    await page.click('#rec-dlg-form button[type=submit]');
    const l = await ledger(page);
    expect(l.at(-1)).toMatchObject({ type: 'use', amount: -20000, ownerId: 'o1', date: TODAY });
  });
});

test.describe('환불·조정', () => {
  test('잔액보다 많이 환불할 수 없다', async ({ page, dialogs }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await page.click('[data-mb-action="adjust"]');
    await page.fill('#mb-amount', '60000');
    await page.click('#mb-adjust-form button[type=submit]');
    expect(dialogs.messages()).toEqual(['잔액보다 많이 환불할 수 없어요. (잔액 50,000원)']);
  });

  test('환불: 잔액에서 빼고 실제로 돌려준 금액을 기록한다', async ({ page }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await page.click('[data-mb-action="adjust"]');
    await page.fill('#mb-amount', '20000');
    await expect(page.locator('#mb-adjust-preview')).toHaveText('잔액 50,000원 → 30,000원');
    await page.fill('#mb-paid', '18000');
    await page.click('#mb-adjust-form button[type=submit]');
    await expect(balance(page)).toHaveText('잔액 30,000원');
    await expect(page.locator('.mb-history tbody tr').first()).toContainText('돌려준 금액 18,000원');
  });

  test('조정은 사유가 필요하고, 잔액이 0원 아래로 내려갈 수 없다', async ({ page, dialogs }) => {
    await openApp(page, { data: withBalance() });
    await selectDog(page, '초코');
    await page.click('[data-mb-action="adjust"]');
    await page.selectOption('#mb-kind', 'adjust');
    await expect(page.locator('#mb-paid-wrap')).toBeHidden();
    await page.fill('#mb-amount', '-60000');
    await page.click('#mb-adjust-form button[type=submit]');
    await page.fill('#mb-note', '오입력 정정');
    await page.click('#mb-adjust-form button[type=submit]');
    await page.fill('#mb-amount', '-5000');
    await page.click('#mb-adjust-form button[type=submit]');
    expect(dialogs.messages()).toEqual(['조정 사유를 입력해주세요.', '조정 후 잔액이 0원보다 적어질 수 없어요.']);
    await expect(balance(page)).toHaveText('잔액 45,000원');
    // 내역은 최신이 위, 잔액은 누적
    await expect(page.locator('.mb-history tbody tr').first()).toContainText('오입력 정정');
    await expect(page.locator('.mb-history tbody tr').first()).toContainText('45,000원');
  });
});

test.describe('반려견 삭제와 충전금', () => {
  test('마지막 반려견을 지우면 잔액 경고 후 충전 내역도 지운다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample({ membership: { products: [], ledger: [charge('o2', 70000)] } }) });
    await selectDog(page, '콩이');
    await page.click('[data-action="delete-dog"]');
    expect(dialogs.messages()[0]).toContain('⚠️ 보호자 박서준님의 충전금 잔액 70,000원이 있어요.');
    expect(await ledger(page)).toEqual([]);
  });

  test('형제 반려견이 남아 있으면 쓴 충전금을 되돌리고 잔액을 유지한다', async ({ page, dialogs }) => {
    await openApp(page, {
      data: withBalance({ records: [rec('r1', 'd1', '2026-10-05', '목욕', 30000)] }),
    });
    // r1에 30,000원 사용 내역 추가
    await page.evaluate(() => { addEntry({ ownerId: 'o1', type: 'use', amount: -30000, recordId: 'r1' }); save(); });
    await selectDog(page, '초코');
    await page.click('[data-action="delete-dog"]');
    expect(dialogs.messages()[0]).not.toContain('⚠️');
    await selectDog(page, '보리');
    await expect(balance(page)).toHaveText('잔액 50,000원');
  });
});

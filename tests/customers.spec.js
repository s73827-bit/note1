// 1단계: 고객(보호자·반려견) 등록·수정·삭제·검색, 미용 기록
const { test, expect, openApp, getDb, sample, rec, res, registerCustomer, selectDog, addRecord, TODAY } = require('./helpers');

test.describe('고객 등록', () => {
  test('처음에는 빈 화면 안내가 보인다', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#list')).toContainText('아직 등록된 고객이 없습니다.');
    await expect(page.locator('#detail .placeholder')).toBeVisible();
  });

  test('새 고객을 등록하면 목록에 나오고 바로 선택된다', async ({ page }) => {
    await openApp(page);
    await registerCustomer(page, { owner: '이하늘', phone: '010-5555-1234', dog: '몽이', breed: '포메라니안', weight: 3.2, temper: '귀 예민' });
    await expect(page.locator('#dlg')).not.toBeVisible();
    await expect(page.locator('#list .item.active')).toContainText('몽이');
    await expect(page.locator('#detail .warn').first()).toContainText('귀 예민');
    await expect(page.locator('#count')).toHaveText('반려견 1마리');
    const db = await getDb(page);
    expect(db.owners).toHaveLength(1);
    expect(db.dogs[0]).toMatchObject({ name: '몽이', weight: 3.2, ownerId: db.owners[0].id });
  });

  test('필수 항목이 비면 저장되지 않는다', async ({ page }) => {
    await openApp(page);
    await page.click('#btn-new');
    await page.fill('#o-name', '이하늘');
    await page.click('#dlg button[type=submit]');
    await expect(page.locator('#dlg')).toBeVisible();
    expect(await getDb(page)).toBeNull();
  });

  test('연락처 숫자가 9자리보다 적으면 안내한다', async ({ page, dialogs }) => {
    await openApp(page);
    await registerCustomer(page, { phone: '010-12' });
    expect(dialogs.messages()[0]).toContain('연락처를 숫자로 정확히');
    await expect(page.locator('#dlg')).toBeVisible();
  });

  test('같은 연락처(하이픈 달라도)로 등록하면 기존 보호자에 연결된다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await registerCustomer(page, { owner: '김민지', phone: '01012345678', dog: '구름' });
    expect(dialogs).toHaveLength(0); // 이름·메모가 같으면 묻지 않음
    const db = await getDb(page);
    expect(db.owners).toHaveLength(2);
    expect(db.dogs.find((d) => d.name === '구름').ownerId).toBe('o1');
  });

  test('같은 연락처인데 이름이 다르면 묻고, 취소하면 저장하지 않는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    dialogs.answers.push(false);
    await registerCustomer(page, { owner: '다른이름', phone: '010-1234-5678', dog: '구름' });
    expect(dialogs.messages()[0]).toContain('이미 「김민지」 보호자로 등록');
    expect((await getDb(page)).dogs).toHaveLength(3);

    await page.click('#dlg button[type=submit]'); // 다시 저장 → 확인
    const db = await getDb(page);
    expect(db.dogs.find((d) => d.name === '구름').ownerId).toBe('o1');
    expect(db.owners.find((o) => o.id === 'o1').name).toBe('김민지'); // 이름은 바뀌지 않음
  });
});

test.describe('고객 수정·추가·삭제', () => {
  test('정보를 수정하면 반영된다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '콩이');
    await page.click('[data-action="edit"]');
    await expect(page.locator('#dlg-title')).toHaveText('고객 정보 수정');
    await expect(page.locator('#d-name')).toHaveValue('콩이');
    await page.fill('#d-weight', '9.1');
    await page.fill('#o-memo', '오후 연락');
    await page.click('#dlg button[type=submit]');
    await expect(page.locator('#detail h2').first()).toContainText('9.1kg');
    const db = await getDb(page);
    expect(db.dogs.find((d) => d.id === 'd3').weight).toBe(9.1);
    expect(db.owners.find((o) => o.id === 'o2').memo).toBe('오후 연락');
  });

  test('수정할 때 다른 보호자의 연락처로 바꾸면 막는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '콩이');
    await page.click('[data-action="edit"]');
    await page.fill('#o-phone', '010 1234 5678');
    await page.click('#dlg button[type=submit]');
    expect(dialogs.messages()[0]).toContain('다른 보호자(김민지)');
    expect((await getDb(page)).owners.find((o) => o.id === 'o2').phone).toBe('010-9876-5432');
  });

  test('같은 보호자 반려견 추가: 보호자 칸은 잠기고 형제 칩이 생긴다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '콩이');
    await page.click('[data-action="add-dog"]');
    await expect(page.locator('#o-name')).toHaveValue('박서준');
    await expect(page.locator('#o-name')).toHaveJSProperty('readOnly', true);
    await page.fill('#d-name', '두부');
    await page.fill('#d-breed', '시츄');
    await page.fill('#d-weight', '5');
    await page.fill('#d-temper', '없음');
    await page.click('#dlg button[type=submit]');
    await expect(page.locator('#detail .chip')).toHaveCount(2);
    await page.locator('#detail .chip', { hasText: '콩이' }).click();
    await expect(page.locator('#detail h2').first()).toContainText('콩이');
  });

  test('반려견을 삭제하면 기록·예약도 지워지고, 마지막 반려견이면 보호자도 지워진다', async ({ page, dialogs }) => {
    await openApp(page, {
      data: sample({
        records: [rec('r1', 'd3', '2026-10-01', '목욕', 30000), rec('r2', 'd1', '2026-10-02', '목욕', 30000)],
        reservations: [res('v1', 'd3', '2026-10-25', '10:00')]
      })
    });
    await selectDog(page, '콩이');
    await page.click('[data-action="delete-dog"]');
    expect(dialogs.messages()[0]).toContain('미용 기록 1건, 예약 1건');
    const db = await getDb(page);
    expect(db.dogs.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(db.owners.map((o) => o.id)).toEqual(['o1']);
    expect(db.records.map((r) => r.id)).toEqual(['r2']);
    expect(db.reservations).toHaveLength(0);
    await expect(page.locator('#detail .placeholder')).toBeVisible();
  });

  test('삭제 확인에서 취소하면 그대로 남는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '초코');
    dialogs.answers.push(false);
    await page.click('[data-action="delete-dog"]');
    await expect(page.locator('#list .item')).toHaveCount(3);
  });
});

test.describe('검색·목록', () => {
  test('이름 가나다순으로 정렬된다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await expect(page.locator('#list .item .name')).toHaveText([/보리/, /초코/, /콩이/]);
  });

  for (const [q, expected] of [
    ['초코', ['초코']],
    ['비숑', ['콩이']],
    ['김민지', ['보리', '초코']],
    ['01098765432', ['콩이']],
    ['5678', ['보리', '초코']],
    ['010-9876', ['콩이']]
  ]) {
    test(`「${q}」로 검색`, async ({ page }) => {
      await openApp(page, { data: sample() });
      await page.fill('#search', q);
      await expect(page.locator('#list .item .name')).toHaveText(expected.map((n) => new RegExp(n)));
      await expect(page.locator('#count')).toContainText('(검색 결과)');
    });
  }

  test('결과가 없으면 안내한다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await page.fill('#search', '없는강아지');
    await expect(page.locator('#list')).toContainText('검색 결과가 없습니다.');
  });

  test('입력값은 HTML로 해석되지 않는다', async ({ page }) => {
    await openApp(page);
    await registerCustomer(page, { dog: '<img src=x onerror="window.__xss=1">', temper: '<b>굵게</b>' });
    await expect(page.locator('#list .item .name')).toContainText('<img src=x');
    await expect(page.locator('#detail .warn').first()).toContainText('<b>굵게</b>');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('미용 기록', () => {
  test('기록을 추가하면 방문 횟수·누적 금액·다음 방문 추천일이 나온다', async ({ page }) => {
    await openApp(page, { data: sample({ records: [rec('r1', 'd1', '2026-09-01', '목욕', 25000)] }) });
    await selectDog(page, '초코');
    await expect(page.locator('#r-date')).toHaveValue(TODAY);
    await addRecord(page, { date: '2026-10-10', menu: '전체컷', price: 50000, next: 4, note: '귀 털 정리' });
    const stats = page.locator('#detail .stats');
    await expect(stats).toContainText('방문 2회');
    await expect(stats).toContainText('누적 금액 75,000원');
    await expect(stats).toContainText('다음 방문 추천일 2026-11-07');
    await expect(page.locator('#detail tbody tr').first()).toContainText('전체컷');
    const db = await getDb(page);
    expect(db.records.find((r) => r.menu === '전체컷')).toMatchObject({ price: 50000, nextWeeks: 4, note: '귀 털 정리', dogId: 'd1' });
  });

  test('다음 방문 추천은 가장 최근 기록 기준이고 비우면 표시하지 않는다', async ({ page }) => {
    await openApp(page, { data: sample({ records: [rec('r1', 'd1', '2026-09-01', '목욕', 25000, { nextWeeks: 4 })] }) });
    await selectDog(page, '초코');
    await expect(page.locator('#detail .stats')).toContainText('2026-09-29');
    await addRecord(page, { date: '2026-10-10' });
    await expect(page.locator('#detail .stats')).not.toContainText('다음 방문 추천일');
  });

  test('기록을 삭제한다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample({ records: [rec('r1', 'd1', '2026-09-01', '목욕', 25000)] }) });
    await selectDog(page, '초코');
    await page.click('[data-action="delete-rec"]');
    expect(dialogs.messages()[0]).toBe('이 미용 기록을 삭제할까요?');
    await expect(page.locator('#detail')).toContainText('아직 기록이 없습니다.');
    expect((await getDb(page)).records).toHaveLength(0);
  });

  test('새로고침해도 데이터가 남아 있다', async ({ page }) => {
    await openApp(page);
    await registerCustomer(page, { dog: '몽이' });
    await page.reload();
    await expect(page.locator('#list .item')).toContainText('몽이');
  });

  test('저장 데이터가 깨져 있어도 빈 상태로 열린다', async ({ page }) => {
    await openApp(page, { data: '{깨진 json' });
    await expect(page.locator('#list')).toContainText('아직 등록된 고객이 없습니다.');
    await registerCustomer(page, { dog: '몽이' });
    expect((await getDb(page)).dogs).toHaveLength(1);
  });
});

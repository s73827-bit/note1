// 4단계: 동의서 (화면 서명, 보기·인쇄, 양식 버전)
const { test, expect, openApp, getDb, sample, selectDog } = require('./helpers');

const card = (page) => page.locator('.cs-card');
const csAction = (page, action) => page.locator(`#detail [data-cs-action="${action}"]`).first().click();

async function drawSignature(page) {
  await page.locator('#cs-pad').scrollIntoViewIfNeeded();
  const box = await page.locator('#cs-pad').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 150, box.y + 120, { steps: 6 });
  await page.mouse.move(box.x + 260, box.y + 60, { steps: 6 });
  await page.mouse.up();
}

async function sign(page, { optional = [] } = {}) {
  await csAction(page, 'sign');
  for (const key of ['grooming', 'privacy', ...optional]) await page.check(`#cs-sign-dlg .cs-agree[data-key="${key}"]`);
  await drawSignature(page);
  await page.click('#cs-sign-form button[type=submit]');
  await expect(page.locator('#cs-sign-dlg')).not.toBeVisible();
}

test('동의서가 없으면 반려견 화면 위쪽에 안내한다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await expect(page.locator('.cs-missing')).toContainText('미용 동의서를 아직 받지 않았어요.');
  await expect(card(page)).toContainText('아직 동의서를 받지 않았어요.');
});

test('서명 창: 보호자 이름이 채워지고 문서 4개가 보인다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await csAction(page, 'sign');
  await expect(page.locator('#cs-sign-head')).toContainText('저희 가게 동의서');
  await expect(page.locator('#cs-sign-head')).toContainText('반려견 초코, 보리');
  await expect(page.locator('#cs-signer')).toHaveValue('김민지');
  await expect(page.locator('#cs-sign-docs .cs-doc')).toHaveCount(4);
  await expect(page.locator('#cs-sign-docs')).toContainText('저희 가게은(는) 아래와 같이 개인정보를');
});

test('필수 동의·이름·서명이 없으면 제출되지 않는다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await csAction(page, 'sign');
  const submit = () => page.click('#cs-sign-form button[type=submit]');
  await page.check('.cs-agree[data-key="grooming"]');
  await submit();
  await page.check('.cs-agree[data-key="privacy"]');
  await page.fill('#cs-signer', ' ');
  await submit();
  await page.fill('#cs-signer', '김민지');
  await submit();
  await drawSignature(page);
  await page.click('[data-cs-action="clear"]');
  await expect(page.locator('#cs-pad-hint')).toBeVisible();
  await submit();
  expect(dialogs.messages()).toEqual([
    '필수 항목(개인정보)에 동의해야 제출할 수 있어요.',
    '서명하는 분 이름을 적어주세요.',
    '서명 칸에 서명해주세요.',
    '서명 칸에 서명해주세요.'
  ]);
  expect((await getDb(page)).consent).toBeUndefined();
});

test('서명하면 동의 상태가 카드에 나오고 안내가 사라진다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await sign(page, { optional: ['photo'] });
  await expect(page.locator('.cs-missing')).toHaveCount(0);
  await expect(card(page)).toContainText('2026-10-21 동의 · 서명 김민지');
  await expect(card(page).locator('li')).toHaveText([/✓ 미용/, /✓ 개인정보/, /✓ 사진 SNS/, /✗ 마케팅 문자/]);
  const c = (await getDb(page)).consent;
  expect(c.versions.map((v) => v.version)).toEqual([1]);
  expect(c.records[0]).toMatchObject({ ownerId: 'o1', version: 1, signerName: '김민지', agreed: { grooming: true, privacy: true, photo: true, marketing: false } });
  expect(c.records[0].signature).toMatch(/^M\d+ \d+(L\d+ \d+)+$/);
  // 같은 보호자의 다른 반려견에도 적용
  await selectDog(page, '보리');
  await expect(page.locator('.cs-missing')).toHaveCount(0);
});

test('보기: 당시 문구·체크·서명이 보이고 인쇄할 수 있다', async ({ page }) => {
  await openApp(page, { data: sample({ settings: { shopName: '뽀송미용실' } }) });
  await selectDog(page, '초코');
  await sign(page);
  await csAction(page, 'view');
  const view = page.locator('#cs-view-content');
  await expect(view.locator('h2')).toContainText('뽀송미용실 동의서');
  await expect(view.locator('h2')).toContainText('양식 버전 1');
  await expect(view).toContainText('뽀송미용실은(는) 아래와 같이');
  await expect(view.locator('.cs-result')).toHaveText(['✓ 동의함', '✓ 동의함', '✗ 동의하지 않음', '✗ 동의하지 않음']);
  await expect(view.locator('svg.cs-sig path')).toHaveAttribute('d', /^M/);
  await expect(view).toContainText('서명 김민지 · 2026-10-21 10:00');
  await page.click('[data-cs-action="print"]');
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await expect(page.locator('#print-area')).toContainText('뽀송미용실 동의서');
});

test('선택 항목을 철회하면 날짜가 남고, 새로 받으면 다시 동의할 수 있다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await sign(page, { optional: ['photo', 'marketing'] });
  await expect(card(page).locator('[data-cs-action="withdraw"]')).toHaveCount(2); // 필수 항목은 철회 버튼 없음
  await page.clock.setFixedTime(new Date('2026-10-23T15:00:00+09:00'));
  await card(page).locator('[data-cs-action="withdraw"][data-key="marketing"]').click();
  expect(dialogs.messages()[0]).toBe('마케팅 문자 동의를 철회할까요? 철회한 날짜가 기록됩니다.');
  await expect(card(page).locator('li').nth(3)).toContainText('✗ 마케팅 문자');
  await expect(card(page).locator('li').nth(3)).toContainText('(2026-10-23 철회)');
  await csAction(page, 'view');
  await expect(page.locator('#cs-view-content .cs-result').nth(3)).toHaveText('✓ 동의함 · 2026-10-23 15:00 철회');
  await page.click('#cs-view-close');

  await page.clock.setFixedTime(new Date('2026-10-25T11:00:00+09:00'));
  await sign(page, { optional: ['marketing'] });
  await expect(card(page).locator('li').nth(3)).toHaveText(/✓ 마케팅 문자/);
  await expect(card(page)).toContainText('2026-10-25 동의');
});

test('양식을 고치면 새 버전이 되고, 이미 받은 동의서는 당시 문구 그대로다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await sign(page);
  await csAction(page, 'edit-template');
  await page.fill('.cs-tpl-title[data-key="grooming"]', '미용 서비스 동의(개정)');
  await page.click('#cs-tpl-form button[type=submit]');
  expect(dialogs.messages()).toEqual(['새 양식(버전 2)으로 저장했어요. 이미 받은 동의서는 그대로예요.']);
  await expect(card(page)).toContainText('이전 양식으로 동의');
  await csAction(page, 'view');
  await expect(page.locator('#cs-view-content .cs-doc h3').first()).toContainText('미용 동의');
  await expect(page.locator('#cs-view-content .cs-doc h3').first()).not.toContainText('개정');
  await page.click('#cs-view-close');

  await csAction(page, 'sign');
  await expect(page.locator('#cs-sign-docs .cs-doc h3').first()).toContainText('미용 서비스 동의(개정)');
  await page.click('#cs-sign-cancel');

  // 다른 보호자는 새 양식으로 서명 → 「이전 양식」 표시 없음
  await selectDog(page, '콩이');
  await sign(page);
  await expect(card(page)).not.toContainText('이전 양식으로 동의');
  expect((await getDb(page)).consent.records.map((r) => r.version)).toEqual([1, 2]);
});

test('양식을 고치지 않고 저장하면 새 버전을 만들지 않는다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await csAction(page, 'edit-template');
  await page.click('#cs-tpl-form button[type=submit]');
  await expect(page.locator('#cs-tpl-dlg')).not.toBeVisible();
  expect((await getDb(page)).consent).toBeUndefined();
});

test('양식에서 「기본 양식으로」를 누르면 기본 문구가 채워진다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await csAction(page, 'edit-template');
  await page.fill('.cs-tpl-text[data-key="privacy"]', '바꾼 내용');
  await page.click('[data-cs-action="tpl-default"]');
  await expect(page.locator('.cs-tpl-text[data-key="privacy"]')).toHaveValue(/수집 항목/);
});

test('양식의 제목이나 내용이 비면 저장하지 않는다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await csAction(page, 'edit-template');
  await page.fill('.cs-tpl-text[data-key="photo"]', '  ');
  await page.click('#cs-tpl-form button[type=submit]');
  expect(dialogs.messages()).toEqual(['모든 문서의 제목과 내용을 입력해주세요.']);
});

test('마지막 반려견을 지워 보호자가 없어지면 동의 기록도 지운다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '콩이');
  await sign(page, { optional: ['photo'] });
  await page.click('[data-action="delete-dog"]');
  const c = (await getDb(page)).consent;
  expect(c.records).toEqual([]);
  expect(c.changes).toEqual([]);
});

test('서명이 없는 동의 기록은 불러올 때 버린다', async ({ page }) => {
  const consent = { versions: [], changes: [], records: [{ id: 'x', ownerId: 'o1', version: 1, signedAt: '2026-10-01T00:00:00Z', signature: '', agreed: { grooming: true } }] };
  await openApp(page, { data: sample({ consent }) });
  await selectDog(page, '초코');
  await expect(page.locator('.cs-missing')).toBeVisible();
});

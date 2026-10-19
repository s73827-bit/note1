// 백업 저장 / 불러오기 / CSV
const { test, expect, openApp, getDb, sample, rec, EXAMPLE_TABLE, jsonFile, readDownload } = require('./helpers');

async function menuClick(page, id) {
  await page.click('details.menu summary');
  await page.click(id);
}

test('백업 저장: 오늘 날짜 파일에 전체 데이터가 들어간다', async ({ page }) => {
  await openApp(page, { data: sample({ records: [rec('r1', 'd1', '2026-10-01', '목욕', 30000)], priceTable: EXAMPLE_TABLE }) });
  const [download] = await Promise.all([page.waitForEvent('download'), menuClick(page, '#btn-backup')]);
  expect(download.suggestedFilename()).toBe('grooming-backup-2026-10-21.json');
  const data = JSON.parse(await readDownload(download));
  expect(data.owners).toHaveLength(2);
  expect(data.dogs).toHaveLength(3);
  expect(data.records[0].id).toBe('r1');
  expect(data.priceTable.menus.map((m) => m.name)).toEqual(['목욕', '부분컷']);
  for (const k of ['reservations', 'settings', 'membership', 'consent']) expect(data).toHaveProperty(k);
});

test('백업 메뉴는 항목을 누르면 닫힌다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await Promise.all([page.waitForEvent('download'), menuClick(page, '#btn-backup')]);
  await expect(page.locator('details.menu')).not.toHaveAttribute('open', '');
});

test('백업 불러오기: 확인하면 데이터가 바뀐다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  const backup = { owners: [{ id: 'a', name: '최유리', phone: '010-1111-2222' }], dogs: [{ id: 'b', ownerId: 'a', name: '하루', breed: '진도', weight: 12, temper: '없음' }], records: [] };
  await page.setInputFiles('#file-restore', jsonFile(backup));
  await expect(page.locator('#list .item')).toHaveCount(1);
  await expect(page.locator('#list')).toContainText('하루');
  expect(dialogs.messages()).toEqual(['현재 데이터가 백업 파일의 내용으로 바뀝니다. 계속할까요?', '불러오기가 완료되었습니다.']);
});

test('예전 백업(예약·요금표 없음)도 빈 값을 채워서 불러온다', async ({ page }) => {
  await openApp(page);
  const old = { owners: [{ id: 'a', name: '최유리', phone: '010-1111-2222' }], dogs: [{ id: 'b', ownerId: 'a', name: '하루', breed: '진도', weight: 12 }], records: [{ id: 'c', dogId: 'b', date: '2026-01-01', menu: '목욕', price: 1000 }, { name: 'id 없는 기록' }] };
  await page.setInputFiles('#file-restore', jsonFile(old));
  await expect(page.locator('#list')).toContainText('하루');
  const db = await getDb(page);
  expect(db.reservations).toEqual([]);
  expect(db.priceTable).toEqual({ brackets: [], menus: [], extras: [] });
  expect(db.records).toHaveLength(1);
  expect(db.dogs[0].temper).toBe('');
});

test('불러오기에서 취소하면 그대로다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  dialogs.answers.push(false);
  await page.setInputFiles('#file-restore', jsonFile({ owners: [], dogs: [], records: [] }));
  await expect.poll(() => dialogs.length).toBe(1);
  await expect(page.locator('#list .item')).toHaveCount(3);
});

for (const [label, content] of [['JSON이 아닌 파일', 'hello'], ['형식이 다른 JSON', { foo: 1 }]]) {
  test(`잘못된 백업(${label})은 거절한다`, async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await page.setInputFiles('#file-restore', jsonFile(content));
    await expect.poll(() => dialogs.messages()).toEqual(['올바른 백업 파일이 아닙니다.']);
    await expect(page.locator('#list .item')).toHaveCount(3);
  });
}

test('CSV: BOM·머리글·최신순, 수식 주입 방지와 따옴표 처리', async ({ page }) => {
  await openApp(page, {
    data: sample({
      records: [
        rec('r1', 'd1', '2026-09-01', '목욕', 25000, { note: '=HYPERLINK("x")' }),
        rec('r2', 'd3', '2026-10-05', '전체컷', 50000, { extras: ['엉킴', '입질'], style: '3mm "곰돌이"' })
      ]
    })
  });
  const [download] = await Promise.all([page.waitForEvent('download'), menuClick(page, '#btn-csv')]);
  expect(download.suggestedFilename()).toBe('grooming-records-2026-10-21.csv');
  const text = await readDownload(download);
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const lines = text.slice(1).split('\r\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('"방문일","반려견","견종","보호자","연락처","시술 메뉴","추가 항목"');
  expect(lines[1]).toContain('"2026-10-05","콩이","비숑","박서준","010-9876-5432","전체컷","엉킴, 입질","3mm ""곰돌이""","50000"');
  expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
});

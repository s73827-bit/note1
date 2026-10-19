// 3단계: 전/후 사진 (IndexedDB)
const { test, expect, openApp, getDb, sample, rec, selectDog, addRecord, makePng, jsonFile, readDownload } = require('./helpers');

const storedPhotos = (page) => page.evaluate(async () => (await allPhotos()).map((p) => ({ key: p.key, type: p.blob.type })));
const row = (page) => page.locator('#detail tbody tr').first();

async function menuClick(page, id) {
  await page.click('details.menu summary');
  await page.click(id);
}

// 기록 r1에 「전」 사진이 있는 상태로 시작
async function withBeforePhoto(page) {
  await openApp(page, { data: sample({ records: [rec('r1', 'd1', '2026-10-01', '목욕', 30000)] }) });
  await selectDog(page, '초코');
  const chooser = page.waitForEvent('filechooser');
  await row(page).locator('[data-action="photo-add"][data-kind="before"]').click();
  await (await chooser).setFiles(await makePng(page));
  await expect(row(page).locator('img.thumb')).toHaveCount(1);
}

test('기록을 저장할 때 고른 사진은 긴 변 1280px JPEG로 줄여서 저장된다', async ({ page }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await page.setInputFiles('#r-before', await makePng(page, 2000, 1000));
  await page.setInputFiles('#r-after', await makePng(page, 300, 200, '#08f'));
  await addRecord(page);
  await expect(row(page).locator('img.thumb')).toHaveCount(2);
  const recId = (await getDb(page)).records[0].id;
  const dims = await page.evaluate(async () => {
    const out = {};
    for (const p of await allPhotos()) { const b = await createImageBitmap(p.blob); out[p.kind] = [b.width, b.height, p.blob.type]; }
    return out;
  });
  expect(dims).toEqual({ before: [1280, 640, 'image/jpeg'], after: [300, 200, 'image/jpeg'] });
  expect((await storedPhotos(page)).map((p) => p.key).sort()).toEqual([`${recId}:after`, `${recId}:before`]);
});

test('기록 표의 「+ 전」으로 나중에 추가하고, 새로고침해도 남아 있다', async ({ page }) => {
  await withBeforePhoto(page);
  await expect(row(page).locator('[data-action="photo-add"][data-kind="after"]')).toBeVisible();
  await page.reload();
  await selectDog(page, '초코');
  await expect(row(page).locator('img.thumb')).toHaveCount(1);
});

test('이미지가 아닌 파일은 거절하지만 기록은 저장된다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await selectDog(page, '초코');
  await page.setInputFiles('#r-before', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await addRecord(page);
  await expect.poll(() => dialogs.messages()).toEqual(['이미지 파일만 올릴 수 있습니다.']);
  expect((await getDb(page)).records).toHaveLength(1);
  expect(await storedPhotos(page)).toEqual([]);
});

test('사진 보기 창에서 전·후를 보고 삭제한다', async ({ page, dialogs }) => {
  await withBeforePhoto(page);
  await row(page).locator('[data-action="photo-view"]').click();
  const dlg = page.locator('#photo-dlg');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('h2')).toContainText('초코');
  await expect(dlg.locator('.photo-pane').nth(0).locator('img')).toBeVisible();
  await expect(dlg.locator('.photo-pane').nth(1)).toContainText('사진 없음');
  await dlg.locator('[data-photo-action="delete"][data-kind="before"]').click();
  expect(dialogs.messages()).toEqual(['미용 전 사진을 삭제할까요?']);
  await expect(dlg.locator('.photo-pane').nth(0)).toContainText('사진 없음');
  await expect.poll(() => storedPhotos(page)).toEqual([]);
  await dlg.locator('[data-photo-action="close"]').click();
  await expect(row(page).locator('img.thumb')).toHaveCount(0);
});

test('사진 보기 창에서 바꾸기', async ({ page }) => {
  await withBeforePhoto(page);
  await row(page).locator('[data-action="photo-view"]').click();
  const before = await page.locator('#photo-dlg .photo-pane img').getAttribute('src');
  const chooser = page.waitForEvent('filechooser');
  await page.click('[data-photo-action="replace"][data-kind="before"]');
  await (await chooser).setFiles(await makePng(page, 50, 50, '#0a0'));
  await expect(page.locator('#photo-dlg .photo-pane img')).not.toHaveAttribute('src', before);
  expect(await storedPhotos(page)).toHaveLength(1);
});

test('기록을 삭제하면 사진도 함께 삭제된다', async ({ page, dialogs }) => {
  await withBeforePhoto(page);
  await row(page).locator('[data-action="delete-rec"]').click();
  expect(dialogs.messages()[0]).toContain('사진 1장도 함께 삭제됩니다.');
  await expect.poll(() => storedPhotos(page)).toEqual([]);
});

test('반려견을 삭제하면 사진도 함께 삭제된다', async ({ page, dialogs }) => {
  await withBeforePhoto(page);
  await page.click('[data-action="delete-dog"]');
  expect(dialogs.messages()[0]).toContain('사진 1장');
  await expect.poll(() => storedPhotos(page)).toEqual([]);
});

test('사진 백업 저장 → 삭제 → 불러오기로 되살린다', async ({ page, dialogs }) => {
  await withBeforePhoto(page);
  const [download] = await Promise.all([page.waitForEvent('download'), menuClick(page, '#btn-photo-backup')]);
  expect(download.suggestedFilename()).toBe('grooming-photos-2026-10-21.json');
  const backup = JSON.parse(await readDownload(download));
  expect(backup).toMatchObject({ app: 'grooming-photos', version: 1 });
  expect(backup.photos).toHaveLength(1);
  expect(backup.photos[0]).toMatchObject({ recordId: 'r1', kind: 'before', type: 'image/jpeg' });

  await page.evaluate(() => deletePhotos(['r1']));
  backup.photos.push({ recordId: '없는기록', kind: 'after', data: backup.photos[0].data });
  await page.setInputFiles('#file-photo-restore', jsonFile(backup));
  await expect.poll(() => dialogs.messages().at(-1)).toBe('사진 1장을 불러왔습니다. (기록이 없거나 손상되어 1장 건너뜀)');
  expect(dialogs.messages()).toContain('사진 2장을 불러옵니다. 같은 기록의 사진은 파일 쪽으로 바뀝니다. 계속할까요?');
  await expect(row(page).locator('img.thumb')).toHaveCount(1);
  expect(await storedPhotos(page)).toEqual([{ key: 'r1:before', type: 'image/jpeg' }]);
});

test('사진이 없으면 백업 대신 안내한다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await menuClick(page, '#btn-photo-backup');
  await expect.poll(() => dialogs.messages()).toEqual(['저장된 사진이 없습니다.']);
});

test('사진 백업 파일이 아니면 거절한다', async ({ page, dialogs }) => {
  await openApp(page, { data: sample() });
  await page.setInputFiles('#file-photo-restore', jsonFile({ owners: [], dogs: [], records: [] }));
  await expect.poll(() => dialogs.messages()).toEqual(['올바른 사진 백업 파일이 아닙니다.']);
});

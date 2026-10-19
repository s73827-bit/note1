// 2단계: 예약 캘린더
const { test, expect, openApp, getDb, sample, res, rec, tab, selectDog, TODAY } = require('./helpers');

const slot = (page, date, time) => page.locator(`.cal-slot[data-date="${date}"][data-time="${time}"]`);
const block = (page, id) => page.locator(`.res-block[data-id="${id}"]`);
const resAction = (page, action) => page.click(`#res-view-body [data-res-action="${action}"]`);

// 「+ 예약 추가」로 열고 날짜·시간을 고릅니다(이미 예약이 있는 칸은 블록에 가려 누를 수 없음).
async function newRes(page, date, start) {
  await page.click('#cal-new');
  await page.fill('#res-date', date);
  await page.selectOption('#res-start', start);
}

async function pickDogInDialog(page, q) {
  await page.fill('#res-dog-search', q);
  await page.locator('.res-dog-option').first().click();
}

test.describe('주간 시간표', () => {
  test('이번 주(월~일)와 오늘이 표시된다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'calendar');
    await expect(page.locator('#cal-range')).toHaveText('2026-10-19 ~ 2026-10-25');
    await expect(page.locator('.cal-head.today')).toContainText('수');
    await expect(page.locator(`.cal-slot[data-date="${TODAY}"]`)).toHaveCount(22); // 09:00~19:30
  });

  test('이전·다음·이번 주로 이동한다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'calendar');
    await page.click('#cal-next');
    await expect(page.locator('#cal-range')).toHaveText('2026-10-26 ~ 2026-11-01');
    await page.click('#cal-prev');
    await page.click('#cal-prev');
    await expect(page.locator('#cal-range')).toHaveText('2026-10-12 ~ 2026-10-18');
    await page.click('#cal-today');
    await expect(page.locator('#cal-range')).toHaveText('2026-10-19 ~ 2026-10-25');
  });

  test('겹치는 예약은 나란히, 상태별 색으로 그린다', async ({ page }) => {
    await openApp(page, {
      data: sample({ reservations: [res('a', 'd1', TODAY, '10:00'), res('b', 'd3', TODAY, '10:30', { status: 'noshow' }), res('c', 'd2', TODAY, '13:00', { status: 'done' })] })
    });
    await tab(page, 'calendar');
    await expect(block(page, 'a')).toHaveAttribute('style', /width:50%/);
    await expect(block(page, 'b')).toHaveAttribute('style', /left:50%/);
    await expect(block(page, 'c')).toHaveAttribute('style', /width:100%/);
    await expect(block(page, 'b')).toHaveClass(/st-noshow/);
    await expect(block(page, 'c')).toHaveClass(/st-done/);
  });

  test('영업시간 밖 예약도 가장자리에 보인다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('early', 'd1', TODAY, '07:00', { minutes: 60 }), res('late', 'd1', TODAY, '20:30', { minutes: 30 })] }) });
    await tab(page, 'calendar');
    await expect(block(page, 'early')).toHaveAttribute('style', /top:0px;height:28px/);
    await expect(block(page, 'late')).toHaveAttribute('style', /top:588px;height:28px/);
  });
});

test.describe('예약 등록·수정', () => {
  test('빈 칸을 눌러 예약을 추가한다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'calendar');
    await slot(page, '2026-10-23', '14:00').click();
    await expect(page.locator('#res-date')).toHaveValue('2026-10-23');
    await expect(page.locator('#res-start')).toHaveValue('14:00');
    await expect(page.locator('#res-minutes')).toHaveValue('90');
    await pickDogInDialog(page, '콩이');
    await expect(page.locator('#res-dog-picked')).toContainText('콩이');
    await page.fill('#res-menu', '전체컷');
    await page.click('#res-form button[type=submit]');
    await expect(page.locator('.res-block')).toContainText('콩이');
    const r = (await getDb(page)).reservations[0];
    expect(r).toMatchObject({ dogId: 'd3', date: '2026-10-23', start: '14:00', minutes: 90, menu: '전체컷', status: 'scheduled' });
  });

  test('반려견을 고르지 않으면 저장하지 않는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'calendar');
    await slot(page, TODAY, '10:00').click();
    await page.click('#res-form button[type=submit]');
    expect(dialogs.messages()).toEqual(['반려견을 검색해서 선택해주세요.']);
  });

  test('검색창에서 Enter를 누르면 첫 결과를 고른다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await tab(page, 'calendar');
    await slot(page, TODAY, '10:00').click();
    await page.fill('#res-dog-search', '박서준');
    await page.press('#res-dog-search', 'Enter');
    await expect(page.locator('#res-dog-picked')).toContainText('콩이');
    await expect(page.locator('#res-dlg')).toBeVisible();
  });

  test('시간이 겹치면 묻고, 취소하면 저장하지 않는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await newRes(page, TODAY, '11:00');
    await pickDogInDialog(page, '콩이');
    dialogs.answers.push(false);
    await page.click('#res-form button[type=submit]');
    expect(dialogs.messages()[0]).toBe('초코(10:00~11:30)과 시간이 겹칩니다. 그래도 저장할까요?');
    expect((await getDb(page)).reservations).toHaveLength(1);
    await page.click('#res-form button[type=submit]');
    expect((await getDb(page)).reservations).toHaveLength(2);
  });

  test('취소·노쇼 예약, 끝나는 시각에 시작하는 예약은 겹침으로 보지 않는다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00', { status: 'canceled' }), res('b', 'd2', TODAY, '12:00', { minutes: 60 })] }) });
    await tab(page, 'calendar');
    await newRes(page, TODAY, '10:30');
    await pickDogInDialog(page, '콩이');
    await page.click('#res-form button[type=submit]');
    await newRes(page, TODAY, '13:00');
    await pickDogInDialog(page, '콩이');
    await page.click('#res-form button[type=submit]');
    expect(dialogs).toHaveLength(0);
    expect((await getDb(page)).reservations).toHaveLength(4);
  });

  test('예약을 수정한다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await block(page, 'a').click();
    await resAction(page, 'edit');
    await expect(page.locator('#res-dlg-title')).toHaveText('예약 수정');
    await page.selectOption('#res-minutes', '120');
    await page.fill('#res-memo', '엉킴 심함');
    await page.click('#res-form button[type=submit]');
    await expect(page.locator('#res-view-body')).toContainText('10:00 ~ 12:00 (2시간)');
    await expect(page.locator('#res-view-body')).toContainText('엉킴 심함');
    expect((await getDb(page)).reservations[0].minutes).toBe(120);
  });
});

test.describe('예약 상태', () => {
  test('취소·노쇼 예약 자리를 누르면 그 시간에 새 예약을 넣는다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00', { status: 'canceled' }), res('b', 'd2', TODAY, '14:00', { status: 'noshow' })] }) });
    await tab(page, 'calendar');
    for (const [id, start] of [['a', '10:00'], ['b', '14:00']]) {
      const box = await block(page, id).boundingBox();
      await page.mouse.click(box.x + box.width - 10, box.y + 8); // 블록의 오른쪽 위(글자 없는 곳)
      await expect(page.locator('#res-dlg')).toBeVisible();
      await expect(page.locator('#res-dlg-title')).toHaveText('예약 추가');
      await expect(page.locator('#res-start')).toHaveValue(start);
      await page.click('#res-cancel');
    }
  });

  test('취소된 예약은 시간 글자를 눌러 열고 예정으로 되돌릴 수 있다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00', { status: 'canceled' })] }) });
    await tab(page, 'calendar');
    await block(page, 'a').locator('b').click();
    await expect(page.locator('#res-view-body h2')).toContainText('취소');
    await resAction(page, 'scheduled');
    await resAction(page, 'close');
    await block(page, 'a').click({ position: { x: 20, y: 30 } }); // 예정이 되면 블록 어디를 눌러도 열림
    await expect(page.locator('#res-view-dlg')).toBeVisible();
  });

  test('취소·노쇼·예정으로 상태를 바꾼다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await block(page, 'a').click();
    await expect(page.locator('#res-view-body .warn')).toContainText('발 만지면 예민');
    await resAction(page, 'canceled');
    await expect(page.locator('#res-view-body h2')).toContainText('취소');
    await expect(block(page, 'a')).toHaveClass(/st-canceled/);
    await resAction(page, 'noshow');
    await expect(block(page, 'a')).toHaveClass(/st-noshow/);
    await resAction(page, 'scheduled');
    await expect(block(page, 'a')).toHaveClass(/st-scheduled/);
  });

  test('완료를 누르면 기록창이 채워져 열리고, 저장하면 기록이 생긴다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd3', '2026-10-20', '15:00', { menu: '스포팅' })] }) });
    await tab(page, 'calendar');
    await block(page, 'a').click();
    await resAction(page, 'done');
    await expect(page.locator('#rec-dlg-title')).toHaveText('콩이 미용 기록 저장');
    await expect(page.locator('#rd-date')).toHaveValue('2026-10-20');
    await expect(page.locator('#rd-menu')).toHaveValue('스포팅');
    await page.fill('#rd-price', '70000');
    await page.fill('#rd-next', '6');
    await page.click('#rec-dlg-form button[type=submit]');
    await expect(block(page, 'a')).toHaveClass(/st-done/);
    const db = await getDb(page);
    expect(db.records).toHaveLength(1);
    expect(db.records[0]).toMatchObject({ dogId: 'd3', date: '2026-10-20', menu: '스포팅', price: 70000, nextWeeks: 6 });
    expect(db.reservations[0]).toMatchObject({ status: 'done', recordId: db.records[0].id });
  });

  test('완료를 예정으로 되돌리면 확인하고, 기록은 남긴다', async ({ page, dialogs }) => {
    await openApp(page, { data: sample({ records: [rec('r1', 'd1', TODAY, '목욕', 30000)], reservations: [res('a', 'd1', TODAY, '10:00', { status: 'done', recordId: 'r1' })] }) });
    await tab(page, 'calendar');
    await block(page, 'a').click();
    await resAction(page, 'scheduled');
    expect(dialogs.messages()[0]).toContain('예정으로 되돌립니다');
    const db = await getDb(page);
    expect(db.reservations[0]).toMatchObject({ status: 'scheduled', recordId: '' });
    expect(db.records).toHaveLength(1);
  });

  test('예약을 삭제한다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd1', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await block(page, 'a').click();
    await resAction(page, 'delete');
    await expect(page.locator('.res-block')).toHaveCount(0);
    await expect(page.locator('#res-view-dlg')).not.toBeVisible();
  });

  test('「고객 보기」로 고객 화면에 간다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'd3', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await block(page, 'a').click();
    await resAction(page, 'goto-dog');
    await expect(page.locator('#view-customers')).toBeVisible();
    await expect(page.locator('#detail h2').first()).toContainText('콩이');
  });
});

test.describe('고객 화면의 예약', () => {
  test('다가오는 예정 예약만 보이고, 누르면 그 주 시간표에서 열린다', async ({ page }) => {
    await openApp(page, {
      data: sample({
        reservations: [
          res('past', 'd1', '2026-10-01', '10:00'),
          res('next', 'd1', '2026-11-03', '11:00', { menu: '전체컷' }),
          res('cancel', 'd1', '2026-11-04', '11:00', { status: 'canceled' })
        ]
      })
    });
    await selectDog(page, '초코');
    const items = page.locator('.upcoming .item');
    await expect(items).toHaveCount(1);
    await expect(items).toContainText('2026-11-03 11:00');
    await items.click();
    await expect(page.locator('#view-calendar')).toBeVisible();
    await expect(page.locator('#cal-range')).toHaveText('2026-11-02 ~ 2026-11-08');
    await expect(page.locator('#res-view-body')).toContainText('전체컷');
  });

  test('「예약 추가」는 그 반려견이 골라진 채 열린다', async ({ page }) => {
    await openApp(page, { data: sample() });
    await selectDog(page, '보리');
    await page.click('[data-action="add-res"]');
    await expect(page.locator('#res-dog-picked')).toContainText('보리');
    await expect(page.locator('#res-date')).toHaveValue(TODAY);
  });

  test('반려견이 삭제된 예약은 이름 대신 안내가 나온다', async ({ page }) => {
    await openApp(page, { data: sample({ reservations: [res('a', 'gone', TODAY, '10:00')] }) });
    await tab(page, 'calendar');
    await expect(block(page, 'a')).toContainText('(삭제된 반려견)');
    await block(page, 'a').click();
    await expect(page.locator('#res-view-body')).toContainText('반려견 정보가 삭제되었습니다');
    await expect(page.locator('#res-view-body [data-res-action="done"]')).toHaveCount(0);
  });
});

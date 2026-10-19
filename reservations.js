'use strict';

/* ============================================================
   미용샵 고객관리 - 2단계: 예약 캘린더
   주간 시간표, 예약 등록/수정, 상태(예정/완료/취소/노쇼),
   완료 시 미용 기록 저장. app.js의 db, save, esc, uid 등을 함께 씁니다.
   ============================================================ */

// 영업시간·칸 크기는 여기서 바꿉니다. (분 단위)
const DAY_START = 9 * 60;   // 09:00
const DAY_END = 20 * 60;    // 20:00
const SLOT = 30;            // 30분 칸
const SLOT_PX = 28;         // 한 칸 높이(px)
const DEFAULT_MINUTES = 90;

const STATUS = { scheduled: '예정', done: '완료', canceled: '취소', noshow: '노쇼' };
// 이 상태끼리만 시간 겹침을 경고합니다(취소·노쇼는 자리를 비운 것으로 봄).
const BLOCKING = ['scheduled', 'done'];
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

let weekStart = mondayOf(today());
let editingResId = null;   // null이면 새 예약
let pickedDogId = null;    // 예약창에서 고른 반려견
let viewingResId = null;   // 상세창에 보이는 예약
let completingResId = null; // 미용 기록창으로 완료 처리 중인 예약

/* ---------- 날짜 / 시간 ---------- */

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('sv-SE');
}

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return addDays(dateStr, -((d.getDay() + 6) % 7));
}

function toMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function fromMin(min) {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

function duration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? h + '시간' : '', m ? m + '분' : ''].filter(Boolean).join(' ');
}

function resEnd(r) {
  return toMin(r.start) + r.minutes;
}

/* ---------- 데이터 ---------- */

// app.js의 normalize()가 불러올 때마다 사용합니다.
function normalizeReservation(r) {
  const str = (v) => (v == null ? '' : String(v));
  const minutes = Number(r.minutes);
  return {
    ...r,
    id: str(r.id), dogId: str(r.dogId), date: str(r.date), start: str(r.start),
    minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MINUTES,
    menu: str(r.menu), memo: str(r.memo),
    status: STATUS[r.status] ? r.status : 'scheduled',
    recordId: str(r.recordId),
    remindedAt: str(r.remindedAt) // 안내 문자 보낸 시각(4단계)
  };
}

function dogInfo(dogId) {
  const dog = db.dogs.find((x) => x.id === dogId);
  const owner = dog ? db.owners.find((x) => x.id === dog.ownerId) || {} : {};
  return { dog, owner };
}

// 같은 날, 시간이 겹치는 다른 예약(예정·완료만)
function overlapping(r) {
  const s = toMin(r.start), e = s + r.minutes;
  return db.reservations.filter((x) => x.id !== r.id && x.date === r.date && BLOCKING.includes(x.status)
    && toMin(x.start) < e && s < resEnd(x));
}

/* ---------- 주간 시간표 ---------- */

// 겹치는 예약끼리 묶어서 좌우 칸(col)과 칸 수(cols)를 정합니다.
function layoutDay(list) {
  const items = list
    .map((r) => ({ r, s: toMin(r.start), e: resEnd(r) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);
  let group = [], groupEnd = -1;
  const flush = () => {
    const colEnds = [];
    for (const it of group) {
      let col = colEnds.findIndex((end) => end <= it.s);
      if (col === -1) { col = colEnds.length; colEnds.push(0); }
      colEnds[col] = it.e;
      it.col = col;
    }
    group.forEach((it) => { it.cols = colEnds.length; });
  };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) { flush(); group = []; }
    group.push(it);
    groupEnd = Math.max(groupEnd, it.e);
  }
  if (group.length) flush();
  return items;
}

// 시간표 범위 밖은 잘라서, 완전히 밖이면 가장자리 한 칸에 표시합니다.
function blockBox(s, e) {
  let top = Math.max(s, DAY_START), bottom = Math.min(e, DAY_END);
  if (bottom <= top) {
    top = s < DAY_START ? DAY_START : DAY_END - SLOT;
    bottom = top + SLOT;
  }
  return { top: (top - DAY_START) / SLOT * SLOT_PX, height: (bottom - top) / SLOT * SLOT_PX };
}

function renderCalendar() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const slots = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT) slots.push(fromMin(m));
  const now = today();

  $('#cal-range').textContent = `${days[0]} ~ ${days[6]}`;

  const head = days.map((date, i) => `
    <div class="cal-head ${date === now ? 'today' : ''}">${WEEKDAYS[i]} <span>${date.slice(5).replace('-', '/')}</span></div>`).join('');

  const times = slots.map((t) => `<div class="cal-time">${t.endsWith(':00') ? t : ''}</div>`).join('');

  const cols = days.map((date) => {
    const blocks = layoutDay(db.reservations.filter((r) => r.date === date)).map(({ r, s, e, col, cols }) => {
      const { dog } = dogInfo(r.dogId);
      const box = blockBox(s, e);
      const name = dog ? dog.name : '(삭제된 반려견)';
      return `<button type="button" class="res-block st-${r.status}" data-id="${esc(r.id)}"
        style="top:${box.top}px;height:${box.height}px;left:${col * 100 / cols}%;width:${100 / cols}%"
        title="${esc(`${r.start}~${fromMin(e)} ${name} ${r.menu} (${STATUS[r.status]})`)}">
        <b>${esc(r.start)}</b> ${esc(name)}<span>${esc(r.menu)}</span></button>`;
    }).join('');
    const cells = slots.map((t) => `<button type="button" class="cal-slot" data-date="${date}" data-time="${t}" aria-label="${date} ${t} 예약 추가"></button>`).join('');
    return `<div class="cal-day ${date === now ? 'today' : ''}">${cells}${blocks}</div>`;
  }).join('');

  $('#cal').innerHTML = `
    <div class="cal" style="--slot:${SLOT_PX}px">
      <div class="cal-corner"></div>${head}
      <div class="cal-times">${times}</div>${cols}
    </div>`;
}

function onCalendarClick(e) {
  const block = e.target.closest('.res-block');
  if (block) { openResView(block.dataset.id); return; }
  const slot = e.target.closest('.cal-slot');
  if (slot) openResDialog({ date: slot.dataset.date, start: slot.dataset.time });
}

/* ---------- 예약 등록 / 수정 창 ---------- */

function fillStartOptions(selected) {
  const opts = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT) opts.push(fromMin(m));
  if (selected && !opts.includes(selected)) opts.push(selected);
  opts.sort();
  $('#res-start').innerHTML = '<option value="">선택</option>'
    + opts.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#res-start').value = selected || '';
}

function fillMinuteOptions(selected) {
  const opts = [];
  for (let m = SLOT; m <= 300; m += SLOT) opts.push(m);
  if (!opts.includes(selected)) opts.push(selected);
  opts.sort((a, b) => a - b);
  $('#res-minutes').innerHTML = opts.map((m) => `<option value="${m}">${duration(m)}</option>`).join('');
  $('#res-minutes').value = String(selected);
}

function pickDog(dogId) {
  pickedDogId = dogId;
  const { dog, owner } = dogInfo(dogId);
  $('#res-dog-picked').innerHTML = dog
    ? `선택: <b>${esc(dog.name)}</b> · ${esc(dog.breed)} (${esc(owner.name)} · ${esc(owner.phone)})`
    : '<span class="muted">반려견을 검색해서 선택해주세요.</span>';
  $('#res-dog-results').innerHTML = '';
  $('#res-dog-search').value = '';
}

function renderDogResults() {
  const q = $('#res-dog-search').value;
  if (!q.trim()) { $('#res-dog-results').innerHTML = ''; return; }
  const items = db.dogs
    .map((d) => ({ d, o: db.owners.find((x) => x.id === d.ownerId) || {} }))
    .filter(({ d, o }) => dogMatches(d, o, q))
    .slice(0, 8);
  $('#res-dog-results').innerHTML = items.length
    ? items.map(({ d, o }) => `<li><button type="button" class="res-dog-option" data-id="${esc(d.id)}">
        <b>${esc(d.name)}</b> <span class="sub">· ${esc(d.breed)} · ${esc(o.name)} · ${esc(o.phone)}</span></button></li>`).join('')
    : '<li class="muted">검색 결과가 없습니다.</li>';
}

// opts: { id } 수정, 또는 { dogId, date, start } 새 예약
function openResDialog(opts = {}) {
  $('#res-form').reset();
  const r = opts.id ? db.reservations.find((x) => x.id === opts.id) : null;
  editingResId = r ? r.id : null;
  $('#res-dlg-title').textContent = r ? '예약 수정' : '예약 추가';
  pickDog(r ? r.dogId : opts.dogId || null);
  $('#res-date').value = r ? r.date : opts.date || today();
  fillStartOptions(r ? r.start : opts.start || '');
  fillMinuteOptions(r ? r.minutes : DEFAULT_MINUTES);
  $('#res-menu').value = r ? r.menu : '';
  $('#res-memo').value = r ? r.memo : '';
  $('#res-dlg').showModal();
}

function onSubmitReservation(e) {
  e.preventDefault();
  if (!pickedDogId || !db.dogs.some((d) => d.id === pickedDogId)) {
    alert('반려견을 검색해서 선택해주세요.');
    return;
  }
  const old = editingResId ? db.reservations.find((x) => x.id === editingResId) : null;
  const r = {
    ...(old || { id: uid(), status: 'scheduled', recordId: '' }),
    dogId: pickedDogId,
    date: $('#res-date').value,
    start: $('#res-start').value,
    minutes: Number($('#res-minutes').value),
    menu: $('#res-menu').value.trim(),
    memo: $('#res-memo').value.trim()
  };
  if (!r.date || !r.start || !(r.minutes > 0)) {
    alert('날짜, 시작 시간, 소요시간을 확인해주세요.');
    return;
  }
  // 날짜·시간이 바뀌면 바뀐 시간으로 다시 안내하도록 보냄 표시를 지웁니다.
  if (!old || old.date !== r.date || old.start !== r.start) r.remindedAt = '';

  const clash = overlapping(r);
  if (clash.length) {
    const list = clash.map((x) => `${dogInfo(x.dogId).dog?.name || '(삭제된 반려견)'}(${x.start}~${fromMin(resEnd(x))})`).join(', ');
    if (!confirm(`${list}과 시간이 겹칩니다. 그래도 저장할까요?`)) return;
  }

  if (old) Object.assign(old, r);
  else db.reservations.push(r);
  save();
  $('#res-dlg').close();
  renderCalendar();
  renderDetail();
  if ($('#res-view-dlg').open) renderResView();
}

/* ---------- 예약 상세 창 ---------- */

function openResView(id) {
  if (!db.reservations.some((x) => x.id === id)) return;
  viewingResId = id;
  renderResView();
  if (!$('#res-view-dlg').open) $('#res-view-dlg').showModal();
}

function renderResView() {
  const r = db.reservations.find((x) => x.id === viewingResId);
  if (!r) { $('#res-view-dlg').close(); return; }
  const { dog, owner } = dogInfo(r.dogId);
  const btn = (action, label, cls = '') => `<button type="button" class="small ${cls}" data-res-action="${action}">${label}</button>`;

  const actions = dog ? [
    btn('edit', '수정'),
    r.status !== 'done' ? btn('done', '완료 (기록 저장)', 'primary') : '',
    r.status !== 'canceled' ? btn('canceled', '취소') : '',
    r.status !== 'noshow' ? btn('noshow', '노쇼') : '',
    r.status !== 'scheduled' ? btn('scheduled', '예정으로 되돌리기') : '',
    btn('goto-dog', '고객 보기'),
    btn('delete', '삭제', 'danger')
  ] : [btn('delete', '삭제', 'danger')];

  $('#res-view-body').innerHTML = `
    <h2>예약 상세 <span class="badge st-${r.status}">${STATUS[r.status]}</span></h2>
    ${dog ? `<div class="warn"><b>주의사항</b> ${esc(dog.temper)}</div>` : '<p class="muted">이 예약의 반려견 정보가 삭제되었습니다.</p>'}
    <dl class="kv" style="margin-top:12px">
      ${row('날짜', r.date)}
      ${row('시간', `${r.start} ~ ${fromMin(resEnd(r))} (${duration(r.minutes)})`)}
      ${dog ? row('반려견', `${dog.name} · ${dog.breed}`) : ''}
      ${row('보호자', owner.name)}
      ${row('연락처', owner.phone)}
      ${row('메뉴', r.menu)}
      ${row('메모', r.memo)}
    </dl>
    <div class="btns res-actions">${actions.join('')}</div>
    <div class="dlg-actions">${btn('close', '닫기')}</div>`;
}

function setStatus(r, status) {
  if (r.status === 'done' && status === 'scheduled'
    && !confirm('예정으로 되돌립니다. 이미 저장된 미용 기록은 지워지지 않습니다.\n(필요하면 고객 화면에서 기록을 직접 삭제하세요) 계속할까요?')) return;
  r.status = status;
  if (status !== 'done') r.recordId = '';
  save();
  renderCalendar();
  renderDetail();
  renderResView();
}

function onResViewClick(e) {
  const btn = e.target.closest('[data-res-action]');
  if (!btn) return;
  const r = db.reservations.find((x) => x.id === viewingResId);
  const action = btn.dataset.resAction;
  if (action === 'close' || !r) { $('#res-view-dlg').close(); return; }

  if (action === 'edit') {
    openResDialog({ id: r.id });
  } else if (action === 'done') {
    $('#res-view-dlg').close();
    openRecordDialog(r);
  } else if (action === 'canceled' || action === 'noshow' || action === 'scheduled') {
    setStatus(r, action);
  } else if (action === 'delete') {
    if (!confirm('이 예약을 삭제할까요?')) return;
    db.reservations = db.reservations.filter((x) => x.id !== r.id);
    save();
    $('#res-view-dlg').close();
    renderCalendar();
    renderDetail();
  } else if (action === 'goto-dog') {
    $('#res-view-dlg').close();
    selectedDogId = r.dogId;
    showTab('customers');
  }
}

// 고객 화면의 「다가오는 예약」에서 이동
function showReservation(id) {
  const r = db.reservations.find((x) => x.id === id);
  if (!r) return;
  weekStart = mondayOf(r.date);
  showTab('calendar');
  openResView(id);
}

/* ---------- 완료 → 미용 기록 ---------- */

function openRecordDialog(r) {
  completingResId = r.id;
  $('#rec-dlg-form').reset();
  $('#rec-dlg-title').textContent = `${dogInfo(r.dogId).dog.name} 미용 기록 저장`;
  $('#rd-date').value = r.date;
  $('#rd-menu').value = r.menu;
  $('#rd-pricing').innerHTML = pricePickerHtml('rd', r.dogId);
  $('#rd-balance').innerHTML = balancePickerHtml('rd', dogInfo(r.dogId).dog.ownerId);
  autoPickMenu('rd', r.menu);
  updateBalanceInfo('rd');
  $('#rec-dlg').showModal();
}

function onSubmitRecordDialog(e) {
  e.preventDefault();
  const r = db.reservations.find((x) => x.id === completingResId);
  if (!r) { $('#rec-dlg').close(); return; }
  const rec = {
    id: uid(),
    dogId: r.dogId,
    date: $('#rd-date').value,
    menu: $('#rd-menu').value.trim(),
    style: $('#rd-style').value.trim(),
    price: Number($('#rd-price').value),
    nextWeeks: $('#rd-next').value === '' ? 0 : Number($('#rd-next').value),
    note: $('#rd-note').value.trim(),
    extras: readExtras('rd')
  };
  if (!checkRecord(rec)) return;

  const photos = { before: $('#rd-before').files[0], after: $('#rd-after').files[0] };
  db.records.push(rec);
  applyBalance('rd', rec);
  r.status = 'done';
  r.recordId = rec.id;
  save();
  $('#rec-dlg').close();
  renderCalendar();
  renderDetail();
  attachPhotos(rec.id, photos);
}

/* ---------- 시작 ---------- */

function initReservations() {
  $('#cal').addEventListener('click', onCalendarClick);
  $('#cal-prev').addEventListener('click', () => { weekStart = addDays(weekStart, -7); renderCalendar(); });
  $('#cal-next').addEventListener('click', () => { weekStart = addDays(weekStart, 7); renderCalendar(); });
  $('#cal-today').addEventListener('click', () => { weekStart = mondayOf(today()); renderCalendar(); });
  $('#cal-new').addEventListener('click', () => openResDialog({ date: today() }));

  $('#res-dog-search').addEventListener('input', renderDogResults);
  // 검색창에서 Enter를 누르면 저장 대신 첫 번째 결과를 고릅니다.
  $('#res-dog-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = $('.res-dog-option');
    if (first) pickDog(first.dataset.id);
  });
  $('#res-dog-results').addEventListener('click', (e) => {
    const opt = e.target.closest('.res-dog-option');
    if (opt) pickDog(opt.dataset.id);
  });
  $('#res-form').addEventListener('submit', onSubmitReservation);
  $('#res-cancel').addEventListener('click', () => $('#res-dlg').close());

  $('#res-view-body').addEventListener('click', onResViewClick);

  $('#rec-dlg-form').addEventListener('submit', onSubmitRecordDialog);
  $('#rd-cancel').addEventListener('click', () => $('#rec-dlg').close());
}

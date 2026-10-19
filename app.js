'use strict';

/* ============================================================
   미용샵 고객관리 - 1단계
   보호자 / 반려견 / 미용기록 등록·검색, 백업·복원
   데이터는 브라우저 localStorage에만 저장됩니다.
   ============================================================ */

const KEY = 'grooming-data-v1';

// 데이터 구조: 보호자 1명 : 반려견 여러 마리 : 미용기록·예약 여러 건
let db = { owners: [], dogs: [], records: [], reservations: [] };
let selectedDogId = null;
let query = '';
let editingDogId = null; // null이면 새로 등록

const $ = (sel) => document.querySelector(sel);

/* ---------- 유틸 ---------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 화면에 넣는 모든 사용자 입력은 이 함수를 거칩니다(HTML 주입 방지).
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function today() {
  return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
}

function addWeeks(dateStr, weeks) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + Number(weeks) * 7);
  return d.toLocaleDateString('sv-SE');
}

function won(n) {
  return (Number(n) || 0).toLocaleString('ko-KR') + '원';
}

function digits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

/* ---------- 저장 / 불러오기 ---------- */

function isValidData(d) {
  return d && Array.isArray(d.owners) && Array.isArray(d.dogs) && Array.isArray(d.records);
}

// 빠진 값이 있어도 화면이 깨지지 않도록 문자열 항목을 채우고, id 없는 항목은 버립니다.
function normalize(d) {
  const str = (v) => (v == null ? '' : String(v));
  const ok = (x) => x && typeof x === 'object' && x.id != null;
  return {
    owners: d.owners.filter(ok).map((o) => ({
      ...o, id: str(o.id), name: str(o.name), phone: str(o.phone), memo: str(o.memo)
    })),
    dogs: d.dogs.filter(ok).map((x) => ({
      ...x, id: str(x.id), ownerId: str(x.ownerId), name: str(x.name), breed: str(x.breed), temper: str(x.temper)
    })),
    records: d.records.filter(ok).map((r) => ({
      ...r, id: str(r.id), dogId: str(r.dogId), date: str(r.date), menu: str(r.menu),
      extras: Array.isArray(r.extras) ? r.extras.map(str).filter(Boolean) : []
    })),
    // 예약·요금표는 나중 단계에서 추가되어 예전 백업에는 없을 수 있습니다.
    reservations: (Array.isArray(d.reservations) ? d.reservations : []).filter(ok).map(normalizeReservation),
    priceTable: normalizePriceTable(d.priceTable),
    settings: normalizeSettings(d.settings),
    membership: normalizeMembership(d.membership),
    consent: normalizeConsent(d.consent)
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidData(parsed)) db = normalize(parsed);
    }
  } catch (e) {
    console.error('불러오기 실패', e);
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    alert('저장에 실패했습니다. 브라우저 저장 공간을 확인하고 백업을 먼저 받아두세요.');
  }
  refreshNotifications();
}

/* ---------- 목록 ---------- */

// 이름·견종·보호자·연락처 검색. 숫자·하이픈만 입력하면 하이픈 유무와 상관없이 연락처를 찾습니다.
function dogMatches(d, o, q) {
  q = String(q ?? '').trim().toLowerCase();
  if (!q) return true;
  const qDigits = /^[\d\s-]+$/.test(q) ? digits(q) : '';
  return [d.name, d.breed, o.name, o.phone].join(' ').toLowerCase().includes(q)
    || (qDigits !== '' && digits(o.phone).includes(qDigits));
}

function renderList() {
  const q = query.trim().toLowerCase();
  const items = db.dogs
    .map((d) => ({ d, o: db.owners.find((x) => x.id === d.ownerId) || {} }))
    .filter(({ d, o }) => dogMatches(d, o, q))
    .sort((a, b) => a.d.name.localeCompare(b.d.name, 'ko'));

  $('#count').textContent = `반려견 ${items.length}마리` + (q ? ' (검색 결과)' : '');

  if (!items.length) {
    $('#list').innerHTML = '<li class="muted">' + (db.dogs.length ? '검색 결과가 없습니다.' : '아직 등록된 고객이 없습니다.') + '</li>';
    return;
  }

  $('#list').innerHTML = items.map(({ d, o }) => `
    <li>
      <button type="button" class="item ${d.id === selectedDogId ? 'active' : ''}" data-id="${esc(d.id)}">
        <span class="name">${esc(d.name)} <span class="sub">· ${esc(d.breed)}</span></span>
        <span class="sub">${esc(o.name)} · ${esc(o.phone)}</span>
      </button>
    </li>`).join('');
}

/* ---------- 상세 ---------- */

function row(label, value) {
  return value ? `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>` : '';
}

function renderDetail() {
  const el = $('#detail');
  const d = db.dogs.find((x) => x.id === selectedDogId);
  if (!d) {
    el.innerHTML = '<div class="placeholder">왼쪽에서 반려견을 선택하거나<br>「+ 새 고객 등록」을 눌러주세요.</div>';
    return;
  }

  const o = db.owners.find((x) => x.id === d.ownerId) || {};
  const siblings = db.dogs.filter((x) => x.ownerId === d.ownerId);
  const recs = db.records.filter((r) => r.dogId === d.id).sort((a, b) => b.date.localeCompare(a.date));
  const total = recs.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const last = recs[0];
  const next = last && Number(last.nextWeeks) > 0 ? addWeeks(last.date, last.nextWeeks) : '';

  const upcoming = db.reservations
    .filter((r) => r.dogId === d.id && r.status === 'scheduled' && r.date >= today())
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const upcomingCard = upcoming.length ? `
    <div class="card">
      <h2>다가오는 예약</h2>
      <ul class="upcoming">${upcoming.map((r) => `
        <li><button type="button" class="item" data-action="open-res" data-id="${esc(r.id)}">
          <b>${esc(r.date)} ${esc(r.start)}</b> <span class="sub">${esc(r.menu)}</span>
        </button></li>`).join('')}
      </ul>
    </div>` : '';

  const chips = siblings.length > 1
    ? `<div class="chips">${siblings.map((s) =>
        `<button type="button" class="chip ${s.id === d.id ? 'active' : ''}" data-action="select" data-id="${esc(s.id)}">${esc(s.name)}</button>`
      ).join('')}</div>`
    : '';

  el.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>${esc(d.name)} <span class="muted">${esc(d.breed)} · ${esc(d.weight)}kg</span></h2>
        <div class="btns">
          <button type="button" class="small" data-action="add-res">예약 추가</button>
          <button type="button" class="small" data-action="edit">수정</button>
          <button type="button" class="small" data-action="add-dog">같은 보호자 반려견 추가</button>
          <button type="button" class="small danger" data-action="delete-dog">삭제</button>
        </div>
      </div>
      <div class="warn"><b>주의사항</b> ${esc(d.temper)}</div>
      ${consentMissingHtml(d.ownerId)}
      <dl class="kv" style="margin-top:12px">
        ${row('나이/생년월', d.age)}
        ${row('중성화', d.neuter)}
        ${row('털 상태', d.coat)}
        ${row('알레르기·피부', d.allergy)}
        ${row('예방접종', d.vacc)}
        ${row('선호 스타일', d.style)}
        ${row('보호자', o.name)}
        ${row('연락처', o.phone)}
        ${row('보호자 메모', o.memo)}
      </dl>
      ${chips}
    </div>
    ${upcomingCard}
    ${memberCardHtml(d.ownerId)}
    ${consentCardHtml(d.ownerId)}

    <div class="card">
      <h2>미용 기록 추가</h2>
      <form id="rec-form" class="rec-form" autocomplete="off">
        ${pricePickerHtml('r', d.id)}
        <label>방문일 *<input id="r-date" type="date" required value="${today()}"></label>
        <label>시술 메뉴 *<input id="r-menu" required maxlength="50" placeholder="예: 목욕+부분컷"></label>
        <label>날 길이/스타일<input id="r-style" maxlength="100" placeholder="예: 3mm, 얼굴 동글"></label>
        <label>금액(원) *<input id="r-price" type="number" min="0" step="1000" required></label>
        ${balancePickerHtml('r', d.ownerId)}
        <label>다음 방문 추천(주)<input id="r-next" type="number" min="0" max="52" placeholder="예: 4"></label>
        <label class="full">특이사항<input id="r-note" maxlength="300"></label>
        <label>전 사진<input id="r-before" type="file" accept="image/*"></label>
        <label>후 사진<input id="r-after" type="file" accept="image/*"></label>
        <button type="submit" class="primary">기록 저장</button>
      </form>
    </div>

    <div class="card">
      <h2>미용 기록</h2>
      <div class="stats">
        <span>방문 <b>${recs.length}</b>회</span>
        <span>누적 금액 <b>${won(total)}</b></span>
        ${next ? `<span>다음 방문 추천일 <b>${esc(next)}</b></span>` : ''}
      </div>
      ${recs.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>방문일</th><th>메뉴</th><th>스타일</th><th>금액</th><th>특이사항</th><th>사진</th><th></th></tr></thead>
          <tbody>
            ${recs.map((r) => `
              <tr>
                <td>${esc(r.date)}</td>
                <td>${esc(r.menu)}${(r.extras || []).length ? `<div class="sub">+ ${esc(r.extras.join(', '))}</div>` : ''}</td>
                <td>${esc(r.style)}</td>
                <td>${won(r.price)}${netUsedFor(r.id) > 0 ? `<div class="sub">충전금 ${won(netUsedFor(r.id))} 사용</div>` : ''}</td>
                <td>${esc(r.note)}</td>
                <td class="photo-cell">${photoCell(r)}</td>
                <td><button type="button" class="small danger" data-action="delete-rec" data-id="${esc(r.id)}">삭제</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="muted">아직 기록이 없습니다.</p>'}
    </div>`;
}

function render() {
  renderList();
  renderDetail();
}

// name: 'customers' | 'calendar' | 'stats' | 'pricing' | 'notify'
function showTab(name) {
  $('#view-customers').hidden = name !== 'customers';
  $('#view-calendar').hidden = name !== 'calendar';
  $('#view-stats').hidden = name !== 'stats';
  $('#view-pricing').hidden = name !== 'pricing';
  $('#view-notify').hidden = name !== 'notify';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  if (name === 'calendar') renderCalendar();
  else if (name === 'stats') renderStats();
  else if (name === 'pricing') { renderPricing(); renderProducts(); }
  else if (name === 'notify') renderNotify();
  else render();
}

/* ---------- 고객 등록/수정 창 ---------- */

const dlg = $('#dlg');
const DOG_FIELDS = {
  'd-name': 'name', 'd-breed': 'breed', 'd-weight': 'weight', 'd-age': 'age',
  'd-neuter': 'neuter', 'd-coat': 'coat', 'd-allergy': 'allergy', 'd-vacc': 'vacc',
  'd-temper': 'temper', 'd-style': 'style'
};

function fillOwner(o) {
  $('#o-name').value = o.name || '';
  $('#o-phone').value = o.phone || '';
  $('#o-memo').value = o.memo || '';
}

function fillDog(d) {
  for (const [id, key] of Object.entries(DOG_FIELDS)) {
    $('#' + id).value = d[key] ?? '';
  }
}

function setOwnerLocked(locked) {
  ['o-name', 'o-phone', 'o-memo'].forEach((id) => { $('#' + id).readOnly = locked; });
}

// mode: 'new' | 'edit' | 'add-dog'
function openDialog(mode) {
  $('#form').reset();
  setOwnerLocked(false);
  editingDogId = null;

  if (mode === 'edit') {
    const d = db.dogs.find((x) => x.id === selectedDogId);
    if (!d) return;
    editingDogId = d.id;
    $('#dlg-title').textContent = '고객 정보 수정';
    fillOwner(db.owners.find((x) => x.id === d.ownerId) || {});
    fillDog(d);
  } else if (mode === 'add-dog') {
    const d = db.dogs.find((x) => x.id === selectedDogId);
    if (!d) return;
    $('#dlg-title').textContent = '같은 보호자의 반려견 추가';
    fillOwner(db.owners.find((x) => x.id === d.ownerId) || {});
    setOwnerLocked(true); // 보호자 정보는 그대로 사용
  } else {
    $('#dlg-title').textContent = '새 고객 등록';
  }
  dlg.showModal();
}

function readDogForm() {
  const dog = {};
  for (const [id, key] of Object.entries(DOG_FIELDS)) {
    dog[key] = $('#' + id).value.trim();
  }
  dog.weight = Number(dog.weight);
  return dog;
}

function onSubmitCustomer(e) {
  e.preventDefault();

  const ownerInput = {
    name: $('#o-name').value.trim(),
    phone: $('#o-phone').value.trim(),
    memo: $('#o-memo').value.trim()
  };
  const dogInput = readDogForm();

  if (!ownerInput.name || !ownerInput.phone || !dogInput.name || !dogInput.breed || !dogInput.temper) {
    alert('* 표시 항목을 모두 입력해주세요.');
    return;
  }
  if (!Number.isFinite(dogInput.weight) || dogInput.weight < 0) {
    alert('체중을 올바르게 입력해주세요.');
    return;
  }
  const phoneDigits = digits(ownerInput.phone);
  if (phoneDigits.length < 9) {
    alert('연락처를 숫자로 정확히 입력해주세요. (예: 010-0000-0000)');
    return;
  }

  if (editingDogId) {
    const d = db.dogs.find((x) => x.id === editingDogId);
    const o = db.owners.find((x) => x.id === d.ownerId);
    const dup = db.owners.find((x) => x.id !== o.id && digits(x.phone) === phoneDigits);
    if (dup) {
      alert(`이 연락처는 이미 다른 보호자(${dup.name})로 등록되어 있습니다.`);
      return;
    }
    Object.assign(o, ownerInput);
    Object.assign(d, dogInput);
    selectedDogId = d.id;
  } else {
    // 같은 연락처의 보호자가 이미 있으면 그 보호자에 반려견을 연결
    let owner = db.owners.find((x) => digits(x.phone) === phoneDigits);
    if (owner && (owner.name !== ownerInput.name || owner.memo !== ownerInput.memo)) {
      const ok = confirm(`이 연락처는 이미 「${owner.name}」 보호자로 등록되어 있습니다.\n기존 보호자에 반려견을 연결할까요?\n(방금 입력한 보호자 이름·메모는 반영되지 않습니다)`);
      if (!ok) return;
    }
    if (!owner) {
      owner = { id: uid(), ...ownerInput };
      db.owners.push(owner);
    }
    const dog = { id: uid(), ownerId: owner.id, ...dogInput };
    db.dogs.push(dog);
    selectedDogId = dog.id;
  }

  save();
  dlg.close();
  render();
}

/* ---------- 상세 화면 버튼 / 기록 폼 ---------- */

function onDetailClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'select') {
    selectedDogId = btn.dataset.id;
    render();
  } else if (action === 'edit') {
    openDialog('edit');
  } else if (action === 'add-dog') {
    openDialog('add-dog');
  } else if (action === 'add-res') {
    openResDialog({ dogId: selectedDogId, date: today() });
  } else if (action === 'open-res') {
    showReservation(btn.dataset.id);
  } else if (action === 'delete-dog') {
    deleteDog();
  } else if (action === 'photo-add') {
    pickPhoto(btn.dataset.id, btn.dataset.kind);
  } else if (action === 'photo-view') {
    openPhotoViewer(btn.dataset.id);
  } else if (action === 'delete-rec') {
    const id = btn.dataset.id;
    const nPhotos = photoCount([id]);
    const used = netUsedFor(id);
    if (confirm('이 미용 기록을 삭제할까요?' + (nPhotos ? `\n사진 ${nPhotos}장도 함께 삭제됩니다.` : '')
      + (used > 0 ? `\n사용한 충전금 ${won(used)}은 잔액으로 되돌려 놓습니다.` : ''))) {
      db.records = db.records.filter((r) => r.id !== id);
      restoreRecords([id]);
      save();
      deletePhotos([id]);
      renderDetail();
    }
  }
}

function deleteDog() {
  const d = db.dogs.find((x) => x.id === selectedDogId);
  if (!d) return;
  const n = db.records.filter((r) => r.dogId === d.id).length;
  const nRes = db.reservations.filter((r) => r.dogId === d.id).length;
  const recIds = db.records.filter((r) => r.dogId === d.id).map((r) => r.id);
  const nPhotos = photoCount(recIds);
  // 마지막 반려견이면 보호자도 지워지므로 충전금 잔액을 경고합니다.
  const lastDog = !db.dogs.some((x) => x.id !== d.id && x.ownerId === d.ownerId);
  const bal = balanceOf(d.ownerId);
  const owner = db.owners.find((o) => o.id === d.ownerId) || {};
  const balWarn = lastDog && bal !== 0 ? `\n⚠️ 보호자 ${owner.name}님의 충전금 잔액 ${won(bal)}이 있어요. 함께 삭제됩니다.` : '';
  if (!confirm(`${d.name}의 정보와 미용 기록 ${n}건, 예약 ${nRes}건${nPhotos ? `, 사진 ${nPhotos}장` : ''}이 삭제됩니다. 계속할까요?${balWarn}\n(삭제 전에 백업을 권장합니다)`)) return;

  if (lastDog) {
    // 보호자가 없어지면 그 보호자의 충전금 내역과 동의서(개인정보)도 함께 지웁니다.
    removeOwnerLedger(d.ownerId);
    removeOwnerConsent(d.ownerId);
  } else {
    restoreRecords(recIds);
  }
  deletePhotos(recIds);
  db.records = db.records.filter((r) => r.dogId !== d.id);
  db.reservations = db.reservations.filter((r) => r.dogId !== d.id);
  db.dogs = db.dogs.filter((x) => x.id !== d.id);
  // 반려견이 없는 보호자는 함께 정리
  db.owners = db.owners.filter((o) => db.dogs.some((x) => x.ownerId === o.id));
  selectedDogId = null;
  save();
  render();
}

function onDetailSubmit(e) {
  if (e.target.id !== 'rec-form') return;
  e.preventDefault();

  const rec = {
    id: uid(),
    dogId: selectedDogId,
    date: $('#r-date').value,
    menu: $('#r-menu').value.trim(),
    style: $('#r-style').value.trim(),
    price: Number($('#r-price').value),
    nextWeeks: $('#r-next').value === '' ? 0 : Number($('#r-next').value),
    note: $('#r-note').value.trim(),
    extras: readExtras('r')
  };

  if (!checkRecord(rec)) return;

  const photos = { before: $('#r-before').files[0], after: $('#r-after').files[0] };
  db.records.push(rec);
  applyBalance('r', rec);
  save();
  renderDetail();
  attachPhotos(rec.id, photos);
}

// 미용 기록 필수값 검사. 문제가 있으면 안내하고 false.
function checkRecord(rec) {
  if (!rec.date || !rec.menu || !Number.isFinite(rec.price) || rec.price < 0) {
    alert('방문일, 시술 메뉴, 금액을 확인해주세요.');
    return false;
  }
  return true;
}

/* ---------- 백업 / 복원 / CSV ---------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function backup() {
  download(`grooming-backup-${today()}.json`, JSON.stringify(db, null, 2), 'application/json');
}

function restore(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!isValidData(parsed)) throw new Error('형식 오류');
      if (!confirm('현재 데이터가 백업 파일의 내용으로 바뀝니다. 계속할까요?')) return;
      db = normalize(parsed);
      selectedDogId = null;
      save();
      render();
      if (!$('#view-calendar').hidden) renderCalendar();
      if (!$('#view-stats').hidden) renderStats();
      resetPriceDraft();
      if (!$('#view-pricing').hidden) renderPricing();
      alert('불러오기가 완료되었습니다.');
    } catch (err) {
      alert('올바른 백업 파일이 아닙니다.');
    }
  };
  reader.readAsText(file);
}

// 엑셀에서 수식으로 실행되지 않도록 앞에 ' 를 붙이고, 따옴표를 이스케이프
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function exportCsv() {
  const header = ['방문일', '반려견', '견종', '보호자', '연락처', '시술 메뉴', '추가 항목', '스타일', '금액(원)', '특이사항', '다음 방문 추천(주)'];
  const lines = [header.map(csvCell).join(',')];
  const sorted = [...db.records].sort((a, b) => b.date.localeCompare(a.date));
  for (const r of sorted) {
    const d = db.dogs.find((x) => x.id === r.dogId) || {};
    const o = db.owners.find((x) => x.id === d.ownerId) || {};
    lines.push([r.date, d.name, d.breed, o.name, o.phone, r.menu, (r.extras || []).join(', '), r.style, r.price, r.note, r.nextWeeks]
      .map(csvCell).join(','));
  }
  // 맨 앞의 BOM(\uFEFF)은 엑셀에서 한글이 깨지지 않게 합니다.
  download(`grooming-records-${today()}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- 시작 ---------- */

function init() {
  load();

  $('#search').addEventListener('input', (e) => { query = e.target.value; renderList(); });
  $('#list').addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (item) { selectedDogId = item.dataset.id; render(); }
  });

  $('#btn-new').addEventListener('click', () => openDialog('new'));
  $('#dlg-cancel').addEventListener('click', () => dlg.close());
  $('#form').addEventListener('submit', onSubmitCustomer);

  $('#detail').addEventListener('click', onDetailClick);
  $('#detail').addEventListener('submit', onDetailSubmit);

  $('#btn-backup').addEventListener('click', backup);
  $('#btn-csv').addEventListener('click', exportCsv);
  $('#btn-restore').addEventListener('click', () => $('#file-restore').click());
  $('#file-restore').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) restore(f);
    e.target.value = '';
  });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  // 백업 메뉴: 항목을 누르거나 메뉴 바깥을 누르면 닫습니다.
  document.addEventListener('click', (e) => {
    const menu = $('details.menu');
    if (menu.open && (!menu.contains(e.target) || e.target.closest('.menu-items button'))) menu.open = false;
  });

  initReservations();
  initStats();
  initPhotos();
  initPricing();
  initNotify();
  initMembership();
  initConsent();

  showTab('customers');
}

// reservations.js까지 모두 불러온 뒤 시작합니다.
document.addEventListener('DOMContentLoaded', init);

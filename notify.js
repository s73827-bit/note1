'use strict';

/* ============================================================
   미용샵 고객관리 - 4단계: 알림
   - 사장님용 오늘 알림: 요약 띠 + 「알림」 탭
   - 예약 전날 안내 문자: 문구를 만들어 휴대폰 문자 앱을 열거나 복사
   서버가 없어서 자동 발송은 하지 않습니다.
   ============================================================ */

const DEFAULT_REMINDER_TEMPLATE =
  '[{가게}] 안녕하세요 {보호자}님, {반려견} 미용 예약 안내드려요.\n' +
  '{날짜} {시간}에 뵙겠습니다. 일정 변경은 이 번호로 연락 주세요.';

let bannerDismissed = false; // ✕로 닫으면 새로고침 전까지 숨김
let notifyDate = null;       // 안내 문자 목록 날짜 (null이면 내일)

/* ---------- 설정 ---------- */

// app.js의 normalize()가 불러올 때마다 사용합니다.
function normalizeSettings(s) {
  const str = (v) => (v == null ? '' : String(v));
  const o = s && typeof s === 'object' ? s : {};
  return {
    shopName: str(o.shopName).trim().slice(0, 30),
    reminderTemplate: str(o.reminderTemplate).trim() ? str(o.reminderTemplate) : DEFAULT_REMINDER_TEMPLATE
  };
}

function settings() {
  return db.settings || normalizeSettings(null);
}

/* ---------- 시간 / 문구 ---------- */

// 테스트에서 바꿔 끼울 수 있게 함수로 둡니다.
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function formatKoDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${DAY_NAMES[d.getDay()]})`;
}

function formatKoTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}`;
}

function reminderText(r) {
  const { dog, owner } = dogInfo(r.dogId);
  const s = settings();
  const vars = {
    가게: s.shopName, 보호자: owner.name || '', 반려견: dog ? dog.name : '',
    날짜: formatKoDate(r.date), 시간: formatKoTime(r.start), 메뉴: r.menu
  };
  let t = s.reminderTemplate;
  if (!s.shopName) t = t.replace(/\[\{가게\}\]\s*/g, '');
  return t.replace(/\{(가게|보호자|반려견|날짜|시간|메뉴)\}/g, (_, k) => vars[k]);
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// 아이폰은 'sms:번호&body=', 그 외는 'sms:번호?body='
function smsLink(phone, text, ios = isIOS()) {
  return `sms:${digits(phone)}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`;
}

/* ---------- 대상 찾기 ---------- */

function byTime(a, b) {
  return (a.date + a.start).localeCompare(b.date + b.start);
}

function hasPhone(r) {
  return digits(dogInfo(r.dogId).owner.phone).length >= 9;
}

function remindersFor(date) {
  return db.reservations.filter((r) => r.date === date && r.status === 'scheduled').sort(byTime);
}

function unsentTomorrow() {
  return remindersFor(addDays(today(), 1)).filter((r) => !r.remindedAt && hasPhone(r));
}

function todayReservations() {
  return db.reservations.filter((r) => r.date === today() && (r.status === 'scheduled' || r.status === 'done')).sort(byTime);
}

// 시간이 지났는데 아직 「예정」인 예약
function overdueReservations() {
  const t = today(), now = nowMinutes();
  return db.reservations
    .filter((r) => r.status === 'scheduled' && (r.date < t || (r.date === t && resEnd(r) <= now)))
    .sort(byTime);
}

/* ---------- 요약 띠 / 탭 숫자 ---------- */

function updateNotifyBadge() {
  const badge = $('.tab[data-tab="notify"] .badge');
  const n = unsentTomorrow().length;
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

function renderBanner() {
  const el = $('#notify-banner');
  const parts = [
    [todayReservations().length, '오늘 예약'],
    [unsentTomorrow().length, '안내 안 보낸 내일 예약'],
    [overdueReservations().length, '처리 안 된 지난 예약']
  ].filter(([n]) => n > 0);
  el.hidden = bannerDismissed || !parts.length;
  if (el.hidden) return;
  el.innerHTML = `
    <span>🔔 ${parts.map(([n, label]) => `${label} <b>${n}건</b>`).join(' · ')}</span>
    <button type="button" class="small" data-nt-action="banner-open">알림 보기</button>
    <button type="button" class="small banner-close" data-nt-action="banner-close" aria-label="알림 띠 닫기">✕</button>`;
}

// 데이터가 저장될 때마다 app.js의 save()가 부릅니다.
function refreshNotifications() {
  updateNotifyBadge();
  renderBanner();
  // 「문자 열기」 링크가 열린 다음에 다시 그리도록 미룹니다.
  if (!$('#view-notify').hidden) setTimeout(renderNotify, 0);
}

/* ---------- 「알림」 탭 ---------- */

function resLine(r) {
  const { dog, owner } = dogInfo(r.dogId);
  return `<li><button type="button" class="item" data-nt-action="open-res" data-id="${esc(r.id)}">
    <b>${r.date === today() ? '' : esc(formatKoDate(r.date)) + ' '}${esc(r.start)} ${esc(dog ? dog.name : '(삭제된 반려견)')}</b>
    <span class="sub">${esc(owner.name || '')} · ${esc(r.menu)} · ${STATUS[r.status]}</span></button></li>`;
}

function sentLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '보냄 ✓';
  const p = (n) => String(n).padStart(2, '0');
  return `보냄 ✓ ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function reminderRow(r) {
  const { dog, owner } = dogInfo(r.dogId);
  const text = reminderText(r);
  const id = esc(r.id);
  const actions = hasPhone(r)
    ? `<a class="btn-link small ${r.remindedAt ? '' : 'primary'}" data-nt-action="open-sms" data-id="${id}" href="${esc(smsLink(owner.phone, text))}">${r.remindedAt ? '문자 다시 열기' : '문자 열기'}</a>
       <button type="button" class="small" data-nt-action="copy" data-id="${id}">문구 복사</button>
       ${r.remindedAt ? `<span class="nt-sent">${sentLabel(r.remindedAt)}</span>
         <button type="button" class="small" data-nt-action="unsend" data-id="${id}">보냄 취소</button>` : ''}`
    : '<span class="muted">연락처 없음 — 보호자 연락처를 등록해주세요.</span>';
  return `<li class="nt-row ${r.remindedAt ? 'sent' : ''}" data-id="${id}">
    <div class="nt-head"><b>${esc(r.start)} ${esc(dog ? dog.name : '(삭제된 반려견)')}</b>
      <span class="sub">${esc(owner.name || '')}${owner.phone ? ' · ' + esc(owner.phone) : ''} · ${esc(r.menu)}</span></div>
    <p class="nt-text">${esc(text)}</p>
    <div class="btns">${actions}</div>
  </li>`;
}

function renderNotify() {
  const date = notifyDate || addDays(today(), 1);
  const todays = todayReservations();
  const overdue = overdueReservations();
  const list = remindersFor(date);
  const s = settings();

  $('#notify-body').innerHTML = `
    <div class="card">
      <h2>오늘 할 일 <span class="muted">${esc(formatKoDate(today()))}</span></h2>
      <h3>오늘 예약 ${todays.length}건</h3>
      ${todays.length ? `<ul class="upcoming">${todays.map(resLine).join('')}</ul>` : '<p class="muted">오늘 예약이 없습니다.</p>'}
      ${overdue.length ? `<div id="nt-overdue">
        <h3 class="warn-text">처리 안 된 지난 예약 ${overdue.length}건</h3>
        <p class="muted">시간이 지났는데 아직 「예정」이에요. 눌러서 완료·노쇼·취소 중 하나로 바꿔주세요.</p>
        <ul class="upcoming">${overdue.map(resLine).join('')}</ul></div>` : ''}
    </div>

    <div class="card">
      <h2>예약 안내 문자</h2>
      <label class="nt-date">날짜 <input id="nt-date" type="date" value="${esc(date)}"></label>
      <p class="muted">「문자 열기」를 누르면 휴대폰 문자 앱이 받는 사람·내용이 채워진 채 열려요. PC에서는 「문구 복사」 후 카카오톡 등에 붙여넣으세요.
        누르면 「보냄」으로 표시돼요(실제로 보냈는지는 앱이 알 수 없어요).</p>
      ${list.length ? `<ul id="nt-list" class="nt-list">${list.map(reminderRow).join('')}</ul>`
        : `<ul id="nt-list" class="nt-list"></ul><p class="muted">${esc(formatKoDate(date))}에 「예정」인 예약이 없습니다.</p>`}
    </div>

    <div class="card">
      <h2>문구 설정</h2>
      <div class="dlg-form nt-settings">
        <label>가게 이름<input id="nt-shop" maxlength="30" value="${esc(s.shopName)}" placeholder="예: 뽀송미용실"></label>
        <label>안내 문구<textarea id="nt-template" rows="4" maxlength="500">${esc(s.reminderTemplate)}</textarea></label>
        <p class="muted">넣을 수 있는 자리표시: {가게} {보호자} {반려견} {날짜} {시간} {메뉴}. 가게 이름이 비어 있으면 [{가게}] 부분은 빠져요.</p>
        <div class="btns">
          <button type="button" data-nt-action="reset-template">기본 문구로</button>
          <button type="button" class="primary" data-nt-action="save-settings">저장</button>
        </div>
      </div>
    </div>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 클립보드 권한이 없을 때 예전 방식으로
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function setReminded(id, value) {
  const r = db.reservations.find((x) => x.id === id);
  if (!r) return;
  r.remindedAt = value;
  save();
}

async function onNotifyClick(e) {
  const btn = e.target.closest('[data-nt-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.ntAction;

  if (action === 'banner-open') {
    showTab('notify');
  } else if (action === 'banner-close') {
    bannerDismissed = true;
    renderBanner();
  } else if (action === 'open-res') {
    showReservation(id);
  } else if (action === 'open-sms') {
    // 링크 기본 동작(문자 앱 열기)은 그대로 두고 보냄 표시만 합니다.
    setReminded(id, new Date().toISOString());
  } else if (action === 'copy') {
    const r = db.reservations.find((x) => x.id === id);
    if (!r) return;
    if (await copyText(reminderText(r))) setReminded(id, new Date().toISOString());
    else alert('복사하지 못했습니다. 문구를 길게 눌러 직접 복사해주세요.');
  } else if (action === 'unsend') {
    setReminded(id, '');
  } else if (action === 'save-settings') {
    db.settings = normalizeSettings({ shopName: $('#nt-shop').value, reminderTemplate: $('#nt-template').value });
    save();
  } else if (action === 'reset-template') {
    $('#nt-template').value = DEFAULT_REMINDER_TEMPLATE;
  }
}

/* ---------- 시작 ---------- */

function initNotify() {
  $('#notify-body').addEventListener('click', onNotifyClick);
  $('#notify-banner').addEventListener('click', onNotifyClick);
  $('#notify-body').addEventListener('change', (e) => {
    if (e.target.id === 'nt-date') { notifyDate = e.target.value || null; renderNotify(); }
  });
  refreshNotifications();
}

'use strict';

/* ============================================================
   미용샵 고객관리 - 4단계: 회원권(선불 충전금)
   보호자 단위 충전금. 잔액은 따로 저장하지 않고 내역(ledger)의 합으로 계산합니다.
   충전 / 사용(미용 기록) / 되돌림(기록 삭제) / 환불 / 조정
   ============================================================ */

const MB_TYPES = { charge: '충전', use: '사용', restore: '되돌림', refund: '환불', adjust: '조정' };
const EXAMPLE_PRODUCTS = [
  { pay: 200000, credit: 210000 },
  { pay: 300000, credit: 330000 },
  { pay: 500000, credit: 570000 }
];

let mbOwnerId = null; // 충전/환불·조정 창의 보호자

/* ---------- 데이터 ---------- */

// app.js의 normalize()가 불러올 때마다 사용합니다.
function normalizeMembership(m) {
  const str = (v) => (v == null ? '' : String(v));
  const o = m && typeof m === 'object' ? m : {};
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  return {
    products: (Array.isArray(o.products) ? o.products : [])
      .filter((p) => p && num(p.pay) >= 0 && num(p.credit) > 0)
      .map((p) => ({ id: p.id ? str(p.id) : uid(), pay: num(p.pay), credit: num(p.credit) })),
    ledger: (Array.isArray(o.ledger) ? o.ledger : [])
      .filter((e) => e && e.id != null && e.ownerId && MB_TYPES[e.type] && Number.isFinite(num(e.amount)))
      .map((e) => ({
        id: str(e.id), ownerId: str(e.ownerId), date: str(e.date), type: e.type, amount: num(e.amount),
        pay: Number(e.pay) || 0, recordId: str(e.recordId), note: str(e.note), at: Number(e.at) || 0
      }))
  };
}

function membership() {
  if (!db.membership) db.membership = { products: [], ledger: [] };
  return db.membership;
}

function balanceOf(ownerId) {
  return membership().ledger.filter((e) => e.ownerId === ownerId).reduce((s, e) => s + e.amount, 0);
}

// 이 기록에서 실제로 쓴 충전금(사용 − 되돌림)
function netUsedFor(recordId) {
  return -membership().ledger.filter((e) => e.recordId === recordId).reduce((s, e) => s + e.amount, 0);
}

function addEntry(e) {
  membership().ledger.push({ id: uid(), date: today(), pay: 0, recordId: '', note: '', at: Date.now(), ...e });
}

// 기록을 지울 때 쓴 충전금을 잔액으로 되돌립니다.
function restoreRecords(recordIds) {
  for (const id of recordIds) {
    const used = netUsedFor(id);
    const use = membership().ledger.find((e) => e.recordId === id && e.type === 'use');
    if (used > 0 && use) addEntry({ ownerId: use.ownerId, type: 'restore', amount: used, recordId: id, note: '기록 삭제' });
  }
}

function removeOwnerLedger(ownerId) {
  membership().ledger = membership().ledger.filter((e) => e.ownerId !== ownerId);
}

function chargePaidIn(ym) {
  return membership().ledger.filter((e) => e.type === 'charge' && e.date.startsWith(ym + '-')).reduce((s, e) => s + e.pay, 0);
}

function bonusLabel(p) {
  return p.pay > 0 && p.credit > p.pay ? `+${Math.round((p.credit - p.pay) / p.pay * 100)}%` : '';
}

/* ---------- 고객 화면 「충전금」 카드 ---------- */

function entryText(e) {
  if (e.type === 'charge') return `충전 <span class="sub">받은 금액 ${won(e.pay)}${e.note ? ' · ' + esc(e.note) : ''}</span>`;
  if (e.type === 'use' || e.type === 'restore') {
    const r = db.records.find((x) => x.id === e.recordId);
    const dog = r && db.dogs.find((d) => d.id === r.dogId);
    const what = r ? `${esc(dog ? dog.name : '')} ${esc(r.menu)}` : '';
    return e.type === 'use' ? `사용 <span class="sub">${what}</span>` : `되돌림 <span class="sub">${esc(e.note || '기록 삭제')}</span>`;
  }
  if (e.type === 'refund') return `환불 <span class="sub">돌려준 금액 ${won(e.pay)}${e.note ? ' · ' + esc(e.note) : ''}</span>`;
  return `조정 <span class="sub">${esc(e.note)}</span>`;
}

function memberCardHtml(ownerId) {
  const owner = db.owners.find((o) => o.id === ownerId);
  if (!owner) return '';
  const entries = membership().ledger.filter((e) => e.ownerId === ownerId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  let running = 0;
  const rows = entries.map((e) => {
    running += e.amount;
    return `<tr><td>${esc(e.date)}</td><td>${entryText(e)}</td>
      <td class="${e.amount < 0 ? 'mb-minus' : 'mb-plus'}">${e.amount > 0 ? '+' : ''}${won(e.amount)}</td><td>${won(running)}</td></tr>`;
  }).reverse().join('');
  const id = esc(ownerId);
  return `
    <div class="card mb-card">
      <div class="card-head">
        <h2>충전금 <span class="muted">${esc(owner.name)}님</span></h2>
        <div class="btns">
          <button type="button" class="small primary" data-mb-action="charge" data-owner="${id}">충전</button>
          <button type="button" class="small" data-mb-action="adjust" data-owner="${id}">환불·조정</button>
        </div>
      </div>
      <div class="mb-balance">잔액 <b>${won(balanceOf(ownerId))}</b></div>
      ${rows ? `<div class="table-wrap mb-history"><table>
        <thead><tr><th>날짜</th><th>내용</th><th>변동</th><th>잔액</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<p class="muted">충전 내역이 없습니다.</p>'}
    </div>`;
}

/* ---------- 기록 폼의 「충전금에서 차감」 ---------- */

// prefix: 'r'(고객 화면) | 'rd'(예약 완료 기록창). 잔액이 없으면 빈 문자열.
function balancePickerHtml(prefix, ownerId) {
  const bal = balanceOf(ownerId);
  if (bal <= 0) return '';
  return `
    <div class="mb-use full" data-prefix="${prefix}" data-owner="${esc(ownerId)}" data-balance="${bal}">
      <label><input type="checkbox" id="${prefix}-use-balance" checked> 충전금에서 차감 <span class="sub">(잔액 ${won(bal)})</span></label>
      <p id="${prefix}-mb-info" class="mb-info">금액을 입력하면 차감액을 알려드려요.</p>
    </div>`;
}

function updateBalanceInfo(prefix) {
  const box = $(`#${prefix}-use-balance`);
  if (!box) return;
  const bal = Number(box.closest('.mb-use').dataset.balance);
  const price = Number($(`#${prefix}-price`).value);
  const info = $(`#${prefix}-mb-info`);
  if (!box.checked) { info.textContent = '이번에는 충전금을 쓰지 않아요.'; return; }
  if (!(price > 0)) { info.textContent = '금액을 입력하면 차감액을 알려드려요.'; return; }
  const use = Math.min(price, bal);
  info.textContent = `${won(use)} 차감` + (price > use ? ` · 나머지 ${won(price - use)}은 현장 결제` : ` · 차감 후 잔액 ${won(bal - use)}`);
}

// 기록을 저장할 때(save 전에) 부릅니다.
function applyBalance(prefix, rec) {
  const box = $(`#${prefix}-use-balance`);
  if (!box || !box.checked || !(rec.price > 0)) return;
  const ownerId = box.closest('.mb-use').dataset.owner;
  const use = Math.min(rec.price, balanceOf(ownerId));
  if (use > 0) addEntry({ ownerId, type: 'use', amount: -use, recordId: rec.id, date: rec.date });
}

/* ---------- 충전 창 ---------- */

function openChargeDialog(ownerId) {
  mbOwnerId = ownerId;
  const owner = db.owners.find((o) => o.id === ownerId) || {};
  $('#mb-charge-form').reset();
  $('#mb-charge-title').textContent = `충전하기 — ${owner.name}님`;
  $('#mb-date').value = today();
  const products = membership().products.filter((p) => p.credit > 0);
  $('#mb-products-pick').innerHTML = products.map((p, i) => `
    <label class="mb-radio"><input type="radio" name="mb-product" value="${esc(p.id)}" ${i === 0 ? 'checked' : ''}>
      <span>${won(p.pay)} 결제 → <b>${won(p.credit)}</b> 충전 <span class="sub">${bonusLabel(p)}</span></span></label>`).join('')
    + `<label class="mb-radio"><input type="radio" name="mb-product" value="custom" ${products.length ? '' : 'checked'}> <span>직접 입력</span></label>`;
  syncChargeForm();
  $('#mb-charge-dlg').showModal();
}

function syncChargeForm() {
  const picked = $('#mb-charge-form input[name="mb-product"]:checked');
  const p = picked && membership().products.find((x) => x.id === picked.value);
  $('#mb-pay').readOnly = $('#mb-credit').readOnly = !!p;
  if (p) { $('#mb-pay').value = p.pay; $('#mb-credit').value = p.credit; }
  const bal = balanceOf(mbOwnerId);
  const credit = Number($('#mb-credit').value);
  $('#mb-preview').innerHTML = credit > 0 ? `잔액 ${won(bal)} → <b>${won(bal + credit)}</b>` : `현재 잔액 ${won(bal)}`;
}

function onChargeSubmit(e) {
  e.preventDefault();
  const pay = $('#mb-pay').value === '' ? NaN : Number($('#mb-pay').value);
  const credit = Number($('#mb-credit').value);
  if (!(credit > 0)) { alert('충전할 금액을 0보다 크게 입력해주세요.'); return; }
  if (!(pay >= 0)) { alert('받은 금액을 확인해주세요.'); return; }
  addEntry({ ownerId: mbOwnerId, type: 'charge', amount: credit, pay, date: $('#mb-date').value || today(), note: $('#mb-memo').value.trim() });
  save();
  $('#mb-charge-dlg').close();
  renderDetail();
}

/* ---------- 환불·조정 창 ---------- */

function openAdjustDialog(ownerId) {
  mbOwnerId = ownerId;
  const owner = db.owners.find((o) => o.id === ownerId) || {};
  $('#mb-adjust-form').reset();
  $('#mb-adjust-title').textContent = `환불·조정 — ${owner.name}님`;
  syncAdjustForm();
  $('#mb-adjust-dlg').showModal();
}

function syncAdjustForm() {
  const refund = $('#mb-kind').value === 'refund';
  $('#mb-amount-label').textContent = refund ? '환불할 잔액(원)' : '조정 금액(원, 늘리면 + / 줄이면 -)';
  $('#mb-paid-wrap').hidden = !refund;
  $('#mb-note').placeholder = refund ? '선택 사항' : '예: 오입력 정정 (필수)';
  const bal = balanceOf(mbOwnerId);
  const amt = Number($('#mb-amount').value) || 0;
  const after = refund ? bal - Math.abs(amt) : bal + amt;
  $('#mb-adjust-preview').innerHTML = amt ? `잔액 ${won(bal)} → <b>${won(after)}</b>` : `현재 잔액 ${won(bal)}`;
}

function onAdjustSubmit(e) {
  e.preventDefault();
  const bal = balanceOf(mbOwnerId);
  const amt = Number($('#mb-amount').value);
  const note = $('#mb-note').value.trim();
  if ($('#mb-kind').value === 'refund') {
    if (!(amt > 0)) { alert('환불할 금액을 0보다 크게 입력해주세요.'); return; }
    if (amt > bal) { alert(`잔액보다 많이 환불할 수 없어요. (잔액 ${won(bal)})`); return; }
    const paid = $('#mb-paid').value === '' ? amt : Number($('#mb-paid').value);
    if (!(paid >= 0)) { alert('돌려준 금액을 확인해주세요.'); return; }
    addEntry({ ownerId: mbOwnerId, type: 'refund', amount: -amt, pay: paid, note });
  } else {
    if (!Number.isFinite(amt) || amt === 0) { alert('조정 금액을 입력해주세요. (늘리면 +, 줄이면 -)'); return; }
    if (!note) { alert('조정 사유를 입력해주세요.'); return; }
    if (bal + amt < 0) { alert('조정 후 잔액이 0원보다 적어질 수 없어요.'); return; }
    addEntry({ ownerId: mbOwnerId, type: 'adjust', amount: amt, note });
  }
  save();
  $('#mb-adjust-dlg').close();
  renderDetail();
}

/* ---------- 요금표 탭 「충전 상품」 카드 ---------- */

function renderProducts() {
  const ps = membership().products;
  const rows = ps.map((p, i) => `
    <div class="mb-p-row">
      <input type="number" class="mb-p-pay" data-i="${i}" min="0" step="10000" value="${p.pay || ''}" aria-label="결제 금액"> 원 결제 →
      <input type="number" class="mb-p-credit" data-i="${i}" min="0" step="10000" value="${p.credit || ''}" aria-label="충전 금액"> 원 충전
      <span class="sub">${p.credit > 0 ? bonusLabel(p) : '충전 금액을 입력해주세요'}</span>
      <button type="button" class="small danger" data-mb-action="product-del" data-i="${i}">삭제</button>
    </div>`).join('');
  $('#mb-products').innerHTML = `
    <div class="card">
      <h2>충전 상품</h2>
      <p class="muted">충전금을 충전할 때 고를 상품이에요. 바꾸면 바로 저장돼요.</p>
      ${rows || '<p class="muted">등록된 충전 상품이 없습니다.</p>'}
      <div class="btns" style="margin-top:8px">
        <button type="button" class="small" data-mb-action="product-add">+ 상품 추가</button>
        ${ps.length ? '' : '<button type="button" class="small" data-mb-action="product-example">예시로 채우기</button>'}
      </div>
    </div>`;
}

function onProductChange(e) {
  const el = e.target;
  if (!el.matches('.mb-p-pay, .mb-p-credit')) return;
  const p = membership().products[+el.dataset.i];
  if (!p) return;
  const v = el.value === '' ? 0 : Number(el.value);
  p[el.matches('.mb-p-pay') ? 'pay' : 'credit'] = Number.isFinite(v) && v >= 0 ? v : 0;
  save();
  renderProducts();
}

/* ---------- 시작 ---------- */

function onMembershipClick(e) {
  const btn = e.target.closest('[data-mb-action]');
  if (!btn) return;
  const action = btn.dataset.mbAction;
  const ps = membership().products;
  if (action === 'charge') { openChargeDialog(btn.dataset.owner); return; }
  if (action === 'adjust') { openAdjustDialog(btn.dataset.owner); return; }
  if (action === 'product-add') ps.push({ id: uid(), pay: 0, credit: 0 });
  else if (action === 'product-del') ps.splice(+btn.dataset.i, 1);
  else if (action === 'product-example') membership().products = EXAMPLE_PRODUCTS.map((p) => ({ id: uid(), ...p }));
  else return;
  save();
  renderProducts();
}

function initMembership() {
  document.addEventListener('click', onMembershipClick);
  $('#mb-products').addEventListener('change', onProductChange);

  $('#mb-charge-form').addEventListener('change', syncChargeForm);
  $('#mb-charge-form').addEventListener('input', syncChargeForm);
  $('#mb-charge-form').addEventListener('submit', onChargeSubmit);
  $('#mb-charge-cancel').addEventListener('click', () => $('#mb-charge-dlg').close());

  $('#mb-adjust-form').addEventListener('change', syncAdjustForm);
  $('#mb-adjust-form').addEventListener('input', syncAdjustForm);
  $('#mb-adjust-form').addEventListener('submit', onAdjustSubmit);
  $('#mb-adjust-cancel').addEventListener('click', () => $('#mb-adjust-dlg').close());

  // 기록 폼에서 금액이나 체크가 바뀌면 차감 안내를 새로 씁니다.
  const onFormChange = (e) => {
    const m = /^(r|rd)-(price|use-balance)$/.exec(e.target.id || '');
    if (m) updateBalanceInfo(m[1]);
  };
  document.addEventListener('input', onFormChange);
  document.addEventListener('change', onFormChange);
}

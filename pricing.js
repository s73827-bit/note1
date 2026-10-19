'use strict';

/* ============================================================
   미용샵 고객관리 - 3단계: 요금표 자동 계산
   체중 구간 × 메뉴 요금표 + 추가 요금 항목.
   기록 폼에서 메뉴·추가 항목을 고르면 시술 메뉴·금액이 채워집니다.
   요금표는 db.priceTable에 저장되어 「백업 저장」에 함께 들어갑니다.
   ============================================================ */

const EXAMPLE_PRICE_TABLE = {
  brackets: [3, 5, 7],
  menus: [
    { name: '목욕', prices: [25000, 30000, 35000, 40000] },
    { name: '부분컷', prices: [35000, 40000, 45000, 50000] },
    { name: '전체컷', prices: [50000, 55000, 60000, 70000] },
    { name: '스포팅', prices: [60000, 65000, 70000, 80000] }
  ],
  extras: [{ name: '엉킴', price: 10000 }, { name: '입질', price: 5000 }, { name: '약욕', price: 10000 }]
};

let priceDraft = null;   // 요금표 화면에서 고치는 중인 작업본
let priceDirty = false;  // 저장하지 않은 변경 있음

/* ---------- 데이터 ---------- */

function emptyPriceTable() {
  return { brackets: [], menus: [], extras: [] };
}

function priceTable() {
  return db.priceTable || emptyPriceTable();
}

function clonePriceTable(t) {
  return JSON.parse(JSON.stringify(t));
}

// 빈 칸은 null, 숫자가 아니거나 음수도 null
function priceCell(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// app.js의 normalize()가 불러올 때마다 사용합니다.
function normalizePriceTable(t) {
  if (!t || typeof t !== 'object') return emptyPriceTable();
  const name = (v) => String(v ?? '').trim();
  const brackets = [...new Set((Array.isArray(t.brackets) ? t.brackets : [])
    .map((b) => (b === '' || b == null ? NaN : Number(b)))
    .filter((b) => Number.isFinite(b) && b > 0))].sort((a, b) => a - b);
  const n = brackets.length + 1;
  const obj = (x) => x && typeof x === 'object' && name(x.name);
  return {
    brackets,
    menus: (Array.isArray(t.menus) ? t.menus : []).filter(obj).map((m) => ({
      id: m.id ? String(m.id) : uid(),
      name: name(m.name),
      prices: Array.from({ length: n }, (_, i) => priceCell(Array.isArray(m.prices) ? m.prices[i] : null))
    })),
    extras: (Array.isArray(t.extras) ? t.extras : []).filter(obj).map((x) => ({
      id: x.id ? String(x.id) : uid(),
      name: name(x.name),
      price: priceCell(x.price) ?? 0
    }))
  };
}

/* ---------- 계산 ---------- */

// 체중이 경계 이하인 첫 구간. 체중이 없거나 0 이하면 -1.
function bracketIndex(weight, brackets) {
  const w = weight === '' || weight == null ? NaN : Number(weight);
  if (!Number.isFinite(w) || w <= 0) return -1;
  const i = brackets.findIndex((b) => w <= b);
  return i === -1 ? brackets.length : i;
}

function bracketLabel(i, brackets) {
  if (!brackets.length) return '전체';
  return i < brackets.length ? `~${brackets[i]}kg` : `${brackets[brackets.length - 1]}kg 초과`;
}

// → { ok, reason: 'no-menu' | 'no-weight' | 'no-price', menu, bracket, base, extras, total }
function calcPrice(dog, menuId, extraIds) {
  const t = priceTable();
  const menu = t.menus.find((m) => m.id === menuId);
  if (!menu) return { ok: false, reason: 'no-menu' };
  const bracket = bracketIndex(dog && dog.weight, t.brackets);
  if (bracket < 0) return { ok: false, reason: 'no-weight', menu };
  const base = menu.prices[bracket];
  if (base == null) return { ok: false, reason: 'no-price', menu, bracket };
  const extras = t.extras.filter((x) => extraIds.includes(x.id));
  return { ok: true, menu, bracket, base, extras, total: base + extras.reduce((s, x) => s + x.price, 0) };
}

/* ---------- 기록 폼의 「요금표에서 고르기」 ---------- */

// prefix: 'r'(고객 화면 기록 추가) | 'rd'(예약 완료 기록창). 요금표에 메뉴가 없으면 빈 문자열.
function pricePickerHtml(prefix, dogId) {
  const t = priceTable();
  if (!t.menus.length) return '';
  return `
    <fieldset class="pt-picker full" data-prefix="${prefix}" data-dog="${esc(dogId)}">
      <legend>요금표에서 고르기</legend>
      <select id="${prefix}-pt-menu" aria-label="요금표 메뉴">
        <option value="">메뉴 선택</option>
        ${t.menus.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}
      </select>
      ${t.extras.length ? `<div id="${prefix}-pt-extras" class="pt-extras">${t.extras.map((x) => `
        <label><input type="checkbox" value="${esc(x.id)}"> ${esc(x.name)} <span class="sub">+${won(x.price)}</span></label>`).join('')}
      </div>` : `<div id="${prefix}-pt-extras"></div>`}
      <p id="${prefix}-pt-info" class="pt-info"></p>
    </fieldset>`;
}

function applyPicker(picker) {
  const p = picker.dataset.prefix;
  const menuId = $(`#${p}-pt-menu`).value;
  const info = $(`#${p}-pt-info`);
  if (!menuId) { info.textContent = ''; return; }
  const extraIds = [...picker.querySelectorAll('.pt-extras input:checked')].map((i) => i.value);
  const dog = db.dogs.find((d) => d.id === picker.dataset.dog);
  const res = calcPrice(dog, menuId, extraIds);
  if (res.menu) $(`#${p}-menu`).value = res.menu.name;

  const t = priceTable();
  const where = res.bracket != null ? `체중 ${dog.weight}kg → ${bracketLabel(res.bracket, t.brackets)} 구간` : '';
  if (res.ok) {
    $(`#${p}-price`).value = String(res.total);
    info.textContent = `${where} · 기본 ${won(res.base)}${res.extras.map((x) => ` + ${x.name} ${won(x.price)}`).join('')} = ${won(res.total)}`;
  } else if (res.reason === 'no-weight') {
    info.textContent = '체중 정보가 없어 금액을 계산할 수 없어요. 금액을 직접 입력해주세요.';
  } else if (res.reason === 'no-price') {
    info.textContent = `${where}: 요금표에 이 구간 금액이 없어요. 금액을 직접 입력해주세요.`;
  }
  info.classList.toggle('warn-text', !res.ok);
  updateBalanceInfo(p); // 금액이 바뀌었으니 충전금 차감 안내도 갱신
}

// 기록에 저장할 추가 항목 이름들
function readExtras(prefix) {
  const t = priceTable();
  return [...document.querySelectorAll(`#${prefix}-pt-extras input:checked`)]
    .map((i) => (t.extras.find((x) => x.id === i.value) || {}).name)
    .filter(Boolean);
}

// 예약 메뉴가 요금표 메뉴와 같으면(띄어쓰기·대소문자 무시) 골라서 계산합니다.
function autoPickMenu(prefix, menuText) {
  const sel = $(`#${prefix}-pt-menu`);
  const key = menuKey(menuText);
  if (!sel || !key) return;
  const m = priceTable().menus.find((x) => menuKey(x.name) === key);
  if (!m) return;
  sel.value = m.id;
  applyPicker(sel.closest('.pt-picker'));
}

/* ---------- 요금표 화면 ---------- */

function resetPriceDraft() {
  priceDraft = null;
  priceDirty = false;
}

function renderPricing() {
  if (!priceDirty || !priceDraft) priceDraft = clonePriceTable(priceTable());
  const t = priceDraft;
  const n = t.brackets.length + 1;
  const validBrackets = t.brackets.map(Number);
  const isEmpty = !t.brackets.length && !t.menus.length && !t.extras.length;
  const del = (action, attr, label) => `<button type="button" class="small danger" data-pt-action="${action}" ${attr} aria-label="${label}">삭제</button>`;
  const num = (cls, attrs, v, step) => `<input type="number" class="${cls}" ${attrs} min="0" step="${step}" value="${v ?? ''}">`;

  const brackets = t.brackets.map((b, i) => `
    <span class="pt-b">~ ${num('pt-bracket', `data-i="${i}" aria-label="${i + 1}번째 구간 경계(kg)"`, b, '0.1')} kg
      ${del('del-bracket', `data-i="${i}"`, `${i + 1}번째 구간 삭제`)}</span>`).join('');

  const heads = Array.from({ length: n }, (_, i) => `<th>${esc(bracketLabel(i, validBrackets))}</th>`).join('');
  const menuRows = t.menus.map((m, mi) => `
    <tr>
      <td><input class="pt-menu-name" data-m="${mi}" maxlength="50" value="${esc(m.name)}" placeholder="메뉴 이름" aria-label="메뉴 이름"></td>
      ${m.prices.map((p, i) => `<td>${num('pt-price', `data-m="${mi}" data-i="${i}" aria-label="${esc(m.name)} ${esc(bracketLabel(i, validBrackets))} 금액"`, p, '1000')}</td>`).join('')}
      <td>${del('del-menu', `data-m="${mi}"`, `${esc(m.name)} 메뉴 삭제`)}</td>
    </tr>`).join('');

  const extraRows = t.extras.map((x, ei) => `
    <tr>
      <td><input class="pt-extra-name" data-e="${ei}" maxlength="30" value="${esc(x.name)}" placeholder="항목 이름" aria-label="추가 요금 항목 이름"></td>
      <td>${num('pt-extra-price', `data-e="${ei}" aria-label="${esc(x.name)} 추가 금액"`, x.price, '1000')}</td>
      <td>${del('del-extra', `data-e="${ei}"`, `${esc(x.name)} 항목 삭제`)}</td>
    </tr>`).join('');

  $('#pricing-body').innerHTML = `
    <div class="cal-toolbar">
      <b>요금표</b>
      <span class="pt-dirty" ${priceDirty ? '' : 'hidden'}>저장하지 않은 변경이 있어요.</span>
      <div class="btns pt-save-btns">
        <button type="button" data-pt-action="revert">되돌리기</button>
        <button type="button" class="primary" data-pt-action="save">저장</button>
      </div>
    </div>
    <p class="muted">기록을 쓸 때 메뉴와 추가 항목을 고르면 반려견 체중에 맞는 금액이 자동으로 채워져요. 요금표를 바꿔도 이미 저장한 기록 금액은 그대로예요.</p>
    ${isEmpty ? `<div class="placeholder">아직 요금표가 없습니다.<br>
      <button type="button" class="primary" data-pt-action="example" style="margin-top:12px">예시 요금표로 시작</button>
      <p class="muted">예시 금액이 채워지면 가게 금액으로 고친 뒤 「저장」을 눌러주세요.</p></div>` : ''}

    <div class="card">
      <h2>체중 구간</h2>
      <p class="muted">경계 숫자를 포함해요. 예: 3 → 3.0kg까지 「~3kg」, 3.1kg부터 다음 구간</p>
      <div class="pt-brackets">${brackets}
        <button type="button" class="small" data-pt-action="add-bracket">+ 구간 추가</button></div>
    </div>

    <div class="card">
      <h2>메뉴별 요금 (원)</h2>
      <div class="table-wrap"><table class="pt-table">
        <thead><tr><th>메뉴</th>${heads}<th></th></tr></thead>
        <tbody>${menuRows}</tbody>
      </table></div>
      <button type="button" class="small" data-pt-action="add-menu">+ 메뉴 추가</button>
      <p class="muted">빈 칸은 그 구간에서 계산하지 않고 금액을 직접 입력하게 해요.</p>
    </div>

    <div class="card">
      <h2>추가 요금</h2>
      <div class="table-wrap"><table class="pt-table pt-extras-table">
        <thead><tr><th>항목</th><th>금액(원)</th><th></th></tr></thead>
        <tbody>${extraRows}</tbody>
      </table></div>
      <button type="button" class="small" data-pt-action="add-extra">+ 항목 추가</button>
    </div>`;
}

function markPriceDirty() {
  priceDirty = true;
  const note = $('#pricing-body .pt-dirty');
  if (note) note.hidden = false;
}

// 입력 중에는 다시 그리지 않고 작업본만 고칩니다(입력칸 포커스 유지).
function onPricingInput(e) {
  const el = e.target, t = priceDraft;
  const numOrBlank = (v) => (v === '' ? '' : Number(v));
  if (el.matches('.pt-bracket')) t.brackets[+el.dataset.i] = numOrBlank(el.value);
  else if (el.matches('.pt-menu-name')) t.menus[+el.dataset.m].name = el.value;
  else if (el.matches('.pt-price')) t.menus[+el.dataset.m].prices[+el.dataset.i] = el.value === '' ? null : Number(el.value);
  else if (el.matches('.pt-extra-name')) t.extras[+el.dataset.e].name = el.value;
  else if (el.matches('.pt-extra-price')) t.extras[+el.dataset.e].price = numOrBlank(el.value);
  else return;
  markPriceDirty();
}

// 저장 전 검사. 문제가 있으면 안내 문구, 없으면 ''
function priceTableProblem(t) {
  const b = t.brackets.map((x) => (x === '' ? NaN : Number(x)));
  if (b.some((x, i) => !Number.isFinite(x) || x <= 0 || (i > 0 && x <= b[i - 1]))) {
    return '체중 구간은 0보다 큰 숫자를 작은 것부터 순서대로(오름차순) 입력해주세요.';
  }
  const names = t.menus.map((m) => String(m.name).trim());
  if (names.some((x) => !x)) return '메뉴 이름을 입력해주세요.';
  const dup = names.find((x, i) => names.findIndex((y) => menuKey(y) === menuKey(x)) !== i);
  if (dup) return `같은 이름의 메뉴가 있습니다: ${dup}`;
  if (t.extras.some((x) => !String(x.name).trim())) return '추가 요금 항목 이름을 입력해주세요.';
  const bad = (v) => v !== null && v !== '' && !(Number.isFinite(Number(v)) && Number(v) >= 0);
  if (t.menus.some((m) => m.prices.some(bad)) || t.extras.some((x) => bad(x.price))) return '금액은 0 이상의 숫자로 입력해주세요.';
  return '';
}

function onPricingClick(e) {
  const btn = e.target.closest('[data-pt-action]');
  if (!btn) return;
  const t = priceDraft;
  const action = btn.dataset.ptAction;

  if (action === 'save') {
    const problem = priceTableProblem(t);
    if (problem) { alert(problem); return; }
    db.priceTable = normalizePriceTable(t);
    save();
    resetPriceDraft();
    renderPricing();
    alert('요금표를 저장했습니다.');
    return;
  }
  if (action === 'revert') { resetPriceDraft(); renderPricing(); return; }

  if (action === 'example') {
    priceDraft = normalizePriceTable(EXAMPLE_PRICE_TABLE);
  } else if (action === 'add-bracket') {
    const last = Number(t.brackets[t.brackets.length - 1]) || 0;
    t.brackets.push(last ? last + 2 : 3);
    // 새 경계는 「마지막 경계 초과」 구간을 둘로 나눕니다. 새로 생긴 칸은 비워 둡니다.
    t.menus.forEach((m) => m.prices.splice(t.brackets.length - 1, 0, null));
  } else if (action === 'del-bracket') {
    // 구간을 지우면 그 구간은 다음 구간에 합쳐집니다.
    const i = +btn.dataset.i;
    t.brackets.splice(i, 1);
    t.menus.forEach((m) => m.prices.splice(i, 1));
  } else if (action === 'add-menu') {
    t.menus.push({ id: uid(), name: '', prices: new Array(t.brackets.length + 1).fill(null) });
  } else if (action === 'del-menu') {
    t.menus.splice(+btn.dataset.m, 1);
  } else if (action === 'add-extra') {
    t.extras.push({ id: uid(), name: '', price: 0 });
  } else if (action === 'del-extra') {
    t.extras.splice(+btn.dataset.e, 1);
  } else {
    return;
  }
  priceDirty = true;
  renderPricing();
}

/* ---------- 시작 ---------- */

function initPricing() {
  const body = $('#pricing-body');
  body.addEventListener('input', onPricingInput);
  // 경계를 다 고치면(포커스가 빠지면) 표 머리 「~3kg」을 새로 그립니다.
  body.addEventListener('change', (e) => { if (e.target.matches('.pt-bracket')) renderPricing(); });
  body.addEventListener('click', onPricingClick);
  // 기록 폼의 고르기 칸(고객 화면·예약 완료 기록창)
  document.addEventListener('change', (e) => {
    const picker = e.target.closest('.pt-picker');
    if (picker) applyPicker(picker);
  });
}

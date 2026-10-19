'use strict';

/* ============================================================
   미용샵 고객관리 - 4단계: 동의서
   보호자 단위로 미용·개인정보(필수), 사진 SNS·마케팅 문자(선택) 동의를
   한 장으로 받고 화면에 손가락으로 서명받습니다.
   서명은 선 좌표(SVG path)로 db에 저장되어 「백업 저장」에 함께 들어갑니다.
   ※ 기본 문구는 예시입니다. 실제 사용 전 pipc.go.kr 안내나 전문가 확인을 권합니다.
   ============================================================ */

const CONSENT_DOCS = [
  { key: 'grooming', label: '미용', required: true },
  { key: 'privacy', label: '개인정보', required: true },
  { key: 'photo', label: '사진 SNS', required: false },
  { key: 'marketing', label: '마케팅 문자', required: false }
];
const CONSENT_KEYS = CONSENT_DOCS.map((d) => d.key);
const OPTIONAL_KEYS = CONSENT_DOCS.filter((d) => !d.required).map((d) => d.key);

const DEFAULT_CONSENT_TEXT = {
  grooming: {
    title: '미용 동의',
    body: '반려견 미용 중 아래와 같은 일이 생길 수 있음을 안내받았습니다.\n'
      + '1. 클리퍼·가위·목욕 제품으로 피부가 붉어지거나 가려울 수 있습니다.\n'
      + '2. 털 엉킴이 심하면 피부 보호를 위해 원하는 스타일보다 짧게 밀 수 있습니다.\n'
      + '3. 노령견이나 질환이 있는 반려견은 미용 중 스트레스로 컨디션이 나빠질 수 있으며, 이때는 미용을 멈추고 보호자께 연락드립니다.\n'
      + '4. 응급 상황이 생기면 보호자께 먼저 연락드리고, 연락이 닿지 않으면 가까운 동물병원으로 이송할 수 있습니다(진료비는 보호자 부담).\n'
      + '5. 반려견의 질환·알레르기·예민한 부위·물림 이력은 미리 알려주셔야 합니다.'
  },
  privacy: {
    title: '개인정보 수집·이용 동의',
    body: '{가게}은(는) 아래와 같이 개인정보를 수집·이용합니다.\n'
      + '· 수집 항목: 보호자 이름, 연락처 / 반려견 이름·견종·체중·건강 정보 / 미용 기록·사진\n'
      + '· 이용 목적: 미용 예약과 예약 안내, 미용 기록 관리, 요금 정산\n'
      + '· 보관 기간: 마지막 방문일로부터 3년 (기간이 지나거나 요청하시면 지체 없이 파기합니다)\n'
      + '· 동의를 거부할 권리가 있으며, 거부하시면 예약과 미용 서비스 이용이 어렵습니다.'
  },
  photo: {
    title: '사진 촬영·SNS 게시 동의',
    body: '미용 전·후 반려견 사진을 찍어 미용 기록으로 보관합니다. 동의하시면 보호자 개인정보가 드러나지 않는 범위에서 {가게} SNS·홍보물에 반려견 사진을 올릴 수 있습니다.\n'
      + '동의하지 않으셔도 미용 서비스 이용에는 영향이 없으며, 언제든 철회하실 수 있습니다.'
  },
  marketing: {
    title: '마케팅 문자 수신 동의',
    body: '재방문 안내, 할인·이벤트 소식을 문자로 받습니다.\n'
      + '동의하지 않으셔도 예약 안내 문자와 미용 서비스 이용에는 영향이 없으며, 언제든 수신을 거부하실 수 있습니다.'
  }
};

const PAD_W = 600, PAD_H = 200; // 서명 좌표계
let signOwnerId = null;
let padStrokes = [];   // [[[x, y], ...], ...]
let padDrawing = false;

/* ---------- 데이터 ---------- */

function defaultConsentDocs() {
  return CONSENT_KEYS.map((key) => ({ key, ...DEFAULT_CONSENT_TEXT[key] }));
}

// app.js의 normalize()가 불러올 때마다 사용합니다.
function normalizeConsent(c) {
  const str = (v) => (v == null ? '' : String(v));
  const o = c && typeof c === 'object' ? c : {};
  const obj = (x) => x && typeof x === 'object';
  return {
    versions: (Array.isArray(o.versions) ? o.versions : [])
      .filter((v) => obj(v) && Number.isInteger(Number(v.version)) && Number(v.version) > 0 && Array.isArray(v.docs))
      .map((v) => ({
        version: Number(v.version), savedAt: str(v.savedAt),
        docs: v.docs.filter((d) => obj(d) && CONSENT_KEYS.includes(d.key)).map((d) => ({ key: d.key, title: str(d.title), body: str(d.body) }))
      })),
    records: (Array.isArray(o.records) ? o.records : [])
      .filter((r) => obj(r) && r.id != null && r.ownerId && typeof r.signature === 'string' && r.signature)
      .map((r) => ({
        id: str(r.id), ownerId: str(r.ownerId), version: Number(r.version) || 1, signedAt: str(r.signedAt),
        shopName: str(r.shopName), signerName: str(r.signerName), signature: r.signature,
        agreed: Object.fromEntries(CONSENT_KEYS.map((k) => [k, !!(obj(r.agreed) && r.agreed[k])]))
      })),
    changes: (Array.isArray(o.changes) ? o.changes : [])
      .filter((x) => obj(x) && x.id != null && x.ownerId && OPTIONAL_KEYS.includes(x.key))
      .map((x) => ({ id: str(x.id), ownerId: str(x.ownerId), key: x.key, value: false, at: str(x.at) }))
  };
}

function consentData() {
  if (!db.consent) db.consent = { versions: [], records: [], changes: [] };
  return db.consent;
}

// 저장된 최신 양식. 한 번도 저장하지 않았으면 기본 양식(버전 1).
function currentConsentVersion() {
  const vs = consentData().versions;
  return vs.length ? vs.reduce((a, b) => (b.version > a.version ? b : a)) : { version: 1, docs: defaultConsentDocs() };
}

function consentVersion(n) {
  return consentData().versions.find((v) => v.version === n) || { version: n, docs: defaultConsentDocs() };
}

function ensureVersionStored() {
  if (!consentData().versions.length) consentData().versions.push({ version: 1, savedAt: new Date().toISOString(), docs: defaultConsentDocs() });
}

// 보호자의 현재 동의 상태 = 최신 서명 + 그 뒤의 철회. 서명이 없으면 null.
function consentStatus(ownerId) {
  const recs = consentData().records.filter((r) => r.ownerId === ownerId);
  if (!recs.length) return null;
  const record = recs.reduce((a, b) => (b.signedAt > a.signedAt ? b : a));
  const agreed = { ...record.agreed };
  const withdrawn = {};
  for (const c of consentData().changes) {
    if (c.ownerId === ownerId && c.at >= record.signedAt) { agreed[c.key] = false; withdrawn[c.key] = c.at; }
  }
  return { record, agreed, withdrawn, outdated: record.version !== currentConsentVersion().version };
}

function removeOwnerConsent(ownerId) {
  const c = consentData();
  c.records = c.records.filter((r) => r.ownerId !== ownerId);
  c.changes = c.changes.filter((x) => x.ownerId !== ownerId);
}

function shopLabel(name) {
  return name || '저희 가게';
}

function fillShop(text, shopName) {
  return text.replace(/\{가게\}/g, shopLabel(shopName));
}

function localDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('sv-SE');
}

function localDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.toLocaleDateString('sv-SE')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- 서명 ---------- */

function strokesToPath(strokes) {
  return strokes.map((s) => {
    const pts = s.length === 1 ? [s[0], s[0]] : s; // 점 하나도 보이게
    return `M${pts[0][0]} ${pts[0][1]}` + pts.slice(1).map(([x, y]) => `L${x} ${y}`).join('');
  }).join('');
}

function signatureSvg(path) {
  return `<svg class="cs-sig" viewBox="0 0 ${PAD_W} ${PAD_H}" role="img" aria-label="서명">
    <path d="${esc(path)}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function padPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  return [clamp((e.clientX - r.left) / r.width * PAD_W, PAD_W), clamp((e.clientY - r.top) / r.height * PAD_H, PAD_H)];
}

function redrawPad() {
  const canvas = $('#cs-pad');
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, PAD_W, PAD_H);
  g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111';
  for (const s of padStrokes) {
    g.beginPath();
    g.moveTo(s[0][0], s[0][1]);
    (s.length === 1 ? [s[0]] : s.slice(1)).forEach(([x, y]) => g.lineTo(x, y + (s.length === 1 ? 0.01 : 0)));
    g.stroke();
  }
  $('#cs-pad-hint').hidden = padStrokes.length > 0;
}

function initPad() {
  const canvas = $('#cs-pad');
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    padDrawing = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 테스트용 가짜 포인터 */ }
    padStrokes.push([padPoint(canvas, e)]);
    redrawPad();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!padDrawing) return;
    const s = padStrokes[padStrokes.length - 1];
    const p = padPoint(canvas, e), last = s[s.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return; // 너무 촘촘한 점은 생략(용량 절약)
    s.push(p);
    redrawPad();
  });
  const end = () => { padDrawing = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* ---------- 서명 창 ---------- */

function openSignDialog(ownerId) {
  signOwnerId = ownerId;
  const owner = db.owners.find((o) => o.id === ownerId) || {};
  const dogs = db.dogs.filter((d) => d.ownerId === ownerId).map((d) => d.name).join(', ');
  const shop = settings().shopName;
  const v = currentConsentVersion();
  $('#cs-sign-head').innerHTML = `
    <h2>${esc(shopLabel(shop))} 동의서</h2>
    <p class="muted">보호자 <b>${esc(owner.name || '')}</b> · 반려견 ${esc(dogs)}</p>`;
  $('#cs-sign-docs').innerHTML = CONSENT_DOCS.map((meta) => {
    const doc = v.docs.find((d) => d.key === meta.key) || { key: meta.key, ...DEFAULT_CONSENT_TEXT[meta.key] };
    return `<section class="cs-doc">
      <h3>${esc(doc.title)} <span class="cs-req ${meta.required ? 'req' : ''}">${meta.required ? '필수' : '선택'}</span></h3>
      <p class="cs-body">${esc(fillShop(doc.body, shop))}</p>
      <label class="cs-check"><input type="checkbox" class="cs-agree" data-key="${meta.key}"> 위 내용에 동의합니다 (${meta.required ? '필수' : '선택'})</label>
    </section>`;
  }).join('');
  $('#cs-signer').value = owner.name || '';
  padStrokes = [];
  $('#cs-sign-dlg').showModal();
  redrawPad();
}

function onSignSubmit(e) {
  e.preventDefault();
  const agreed = Object.fromEntries(CONSENT_KEYS.map((k) => [k, $(`#cs-sign-dlg .cs-agree[data-key="${k}"]`).checked]));
  const missing = CONSENT_DOCS.filter((d) => d.required && !agreed[d.key]).map((d) => d.label);
  if (missing.length) { alert(`필수 항목(${missing.join(', ')})에 동의해야 제출할 수 있어요.`); return; }
  const signer = $('#cs-signer').value.trim();
  if (!signer) { alert('서명하는 분 이름을 적어주세요.'); return; }
  if (!padStrokes.length) { alert('서명 칸에 서명해주세요.'); return; }

  ensureVersionStored();
  consentData().records.push({
    id: uid(), ownerId: signOwnerId, version: currentConsentVersion().version,
    signedAt: new Date().toISOString(), shopName: settings().shopName, signerName: signer,
    agreed, signature: strokesToPath(padStrokes)
  });
  save();
  $('#cs-sign-dlg').close();
  renderDetail();
}

/* ---------- 보기 / 인쇄 ---------- */

function consentDocumentHtml(ownerId) {
  const st = consentStatus(ownerId);
  if (!st) return '';
  const { record } = st;
  const owner = db.owners.find((o) => o.id === ownerId) || {};
  const dogs = db.dogs.filter((d) => d.ownerId === ownerId).map((d) => d.name).join(', ');
  const v = consentVersion(record.version);
  const docs = CONSENT_DOCS.map((meta) => {
    const doc = v.docs.find((d) => d.key === meta.key) || { key: meta.key, ...DEFAULT_CONSENT_TEXT[meta.key] };
    const yes = record.agreed[meta.key];
    const w = st.withdrawn[meta.key];
    return `<section class="cs-doc">
      <h3>${esc(doc.title)} <span class="cs-req ${meta.required ? 'req' : ''}">${meta.required ? '필수' : '선택'}</span></h3>
      <p class="cs-body">${esc(fillShop(doc.body, record.shopName))}</p>
      <p class="cs-result ${yes ? 'yes' : 'no'}">${yes ? '✓ 동의함' : '✗ 동의하지 않음'}${w ? ` · ${esc(localDateTime(w))} 철회` : ''}</p>
    </section>`;
  }).join('');
  return `
    <h2>${esc(shopLabel(record.shopName))} 동의서 <span class="muted">양식 버전 ${record.version}</span></h2>
    <p>보호자 <b>${esc(owner.name || '')}</b> · 반려견 ${esc(dogs)}</p>
    ${docs}
    <div class="cs-sig-view">${signatureSvg(record.signature)}</div>
    <p>서명 <b>${esc(record.signerName)}</b> · ${esc(localDateTime(record.signedAt))}</p>`;
}

function openViewDialog(ownerId) {
  $('#cs-view-content').innerHTML = consentDocumentHtml(ownerId);
  $('#cs-view-dlg').showModal();
}

function printConsent() {
  $('#print-area').innerHTML = $('#cs-view-content').innerHTML;
  $('#cs-view-dlg').close();
  document.body.classList.add('printing');
  window.print();
}

/* ---------- 양식 고치기 ---------- */

function openTemplateDialog(docs = currentConsentVersion().docs) {
  $('#cs-tpl-body').innerHTML = CONSENT_DOCS.map((meta) => {
    const doc = docs.find((d) => d.key === meta.key) || { ...DEFAULT_CONSENT_TEXT[meta.key] };
    return `<fieldset class="cs-tpl-doc"><legend>${meta.label} (${meta.required ? '필수' : '선택'})</legend>
      <label>제목<input class="cs-tpl-title" data-key="${meta.key}" maxlength="50" value="${esc(doc.title)}"></label>
      <label>내용<textarea class="cs-tpl-text" data-key="${meta.key}" rows="6" maxlength="2000">${esc(doc.body)}</textarea></label>
    </fieldset>`;
  }).join('');
  if (!$('#cs-tpl-dlg').open) $('#cs-tpl-dlg').showModal();
}

function onTemplateSubmit(e) {
  e.preventDefault();
  const docs = CONSENT_KEYS.map((key) => ({
    key,
    title: $(`.cs-tpl-title[data-key="${key}"]`).value.trim(),
    body: $(`.cs-tpl-text[data-key="${key}"]`).value.trim()
  }));
  if (docs.some((d) => !d.title || !d.body)) { alert('모든 문서의 제목과 내용을 입력해주세요.'); return; }
  const cur = currentConsentVersion();
  if (JSON.stringify(docs) === JSON.stringify(cur.docs.map(({ key, title, body }) => ({ key, title, body })))) {
    $('#cs-tpl-dlg').close();
    return;
  }
  ensureVersionStored();
  const version = currentConsentVersion().version + 1;
  consentData().versions.push({ version, savedAt: new Date().toISOString(), docs });
  save();
  $('#cs-tpl-dlg').close();
  renderDetail();
  alert(`새 양식(버전 ${version})으로 저장했어요. 이미 받은 동의서는 그대로예요.`);
}

/* ---------- 고객 화면 ---------- */

function consentMissingHtml(ownerId) {
  const st = consentStatus(ownerId);
  if (st && st.agreed.grooming) return '';
  return `<div class="warn cs-missing">미용 동의서를 아직 받지 않았어요.
    <button type="button" class="small primary" data-cs-action="sign" data-owner="${esc(ownerId)}">동의서 받기</button></div>`;
}

function consentCardHtml(ownerId) {
  const owner = db.owners.find((o) => o.id === ownerId);
  if (!owner) return '';
  const id = esc(ownerId);
  const st = consentStatus(ownerId);
  const editBtn = '<button type="button" class="small" data-cs-action="edit-template">양식 고치기</button>';
  if (!st) {
    return `<div class="card cs-card">
      <div class="card-head"><h2>동의서 <span class="muted">${esc(owner.name)}님</span></h2>
        <div class="btns"><button type="button" class="small primary" data-cs-action="sign" data-owner="${id}">동의서 받기</button>${editBtn}</div></div>
      <p class="muted">아직 동의서를 받지 않았어요.</p>
    </div>`;
  }
  const items = CONSENT_DOCS.map((meta) => {
    const yes = st.agreed[meta.key];
    const w = st.withdrawn[meta.key];
    return `<li class="${yes ? 'yes' : 'no'}">${yes ? '✓' : '✗'} ${meta.label}
      ${w ? `<span class="sub">(${esc(localDate(w))} 철회)</span>` : ''}
      ${yes && !meta.required ? `<button type="button" class="small" data-cs-action="withdraw" data-owner="${id}" data-key="${meta.key}">철회</button>` : ''}</li>`;
  }).join('');
  return `<div class="card cs-card">
    <div class="card-head"><h2>동의서 <span class="muted">${esc(owner.name)}님</span></h2>
      <div class="btns">
        <button type="button" class="small" data-cs-action="view" data-owner="${id}">보기</button>
        <button type="button" class="small" data-cs-action="sign" data-owner="${id}">새로 받기</button>${editBtn}
      </div></div>
    <p>${esc(localDate(st.record.signedAt))} 동의 · 서명 ${esc(st.record.signerName)}
      ${st.outdated ? '<span class="cs-outdated">이전 양식으로 동의</span>' : ''}</p>
    <ul class="cs-items">${items}</ul>
  </div>`;
}

function withdraw(ownerId, key) {
  const meta = CONSENT_DOCS.find((d) => d.key === key);
  if (!confirm(`${meta.label} 동의를 철회할까요? 철회한 날짜가 기록됩니다.`)) return;
  consentData().changes.push({ id: uid(), ownerId, key, value: false, at: new Date().toISOString() });
  save();
  renderDetail();
}

/* ---------- 시작 ---------- */

function onConsentClick(e) {
  const btn = e.target.closest('[data-cs-action]');
  if (!btn) return;
  const ownerId = btn.dataset.owner;
  const action = btn.dataset.csAction;
  if (action === 'sign') openSignDialog(ownerId);
  else if (action === 'view') openViewDialog(ownerId);
  else if (action === 'withdraw') withdraw(ownerId, btn.dataset.key);
  else if (action === 'edit-template') openTemplateDialog();
  else if (action === 'tpl-default') openTemplateDialog(defaultConsentDocs());
  else if (action === 'clear') { padStrokes = []; redrawPad(); }
  else if (action === 'print') printConsent();
}

function initConsent() {
  document.addEventListener('click', onConsentClick);
  initPad();
  $('#cs-sign-form').addEventListener('submit', onSignSubmit);
  $('#cs-sign-cancel').addEventListener('click', () => $('#cs-sign-dlg').close());
  $('#cs-view-close').addEventListener('click', () => $('#cs-view-dlg').close());
  $('#cs-tpl-form').addEventListener('submit', onTemplateSubmit);
  $('#cs-tpl-cancel').addEventListener('click', () => $('#cs-tpl-dlg').close());
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing');
    $('#print-area').innerHTML = '';
  });
}

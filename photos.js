'use strict';

/* ============================================================
   미용샵 고객관리 - 3단계: 전/후 사진
   미용 기록 1건마다 「전」「후」 사진 1장씩.
   사진은 용량이 커서 localStorage가 아닌 IndexedDB에 따로 저장하고,
   백업도 「사진 백업 저장」으로 따로 받습니다.
   ============================================================ */

const PHOTO_MAX = 1280;     // 긴 변 최대 px
const PHOTO_QUALITY = 0.82; // JPEG 품질
const PHOTO_KINDS = { before: '전', after: '후' };

let photoDbPromise = null;
const photoUrls = new Map(); // 'recordId:kind' → objectURL (화면 표시용 캐시)
let pendingPick = null;      // 파일 선택 중인 칸 { recordId, kind }
let viewingRecordId = null;  // 사진 보기 창의 기록

/* ---------- IndexedDB ---------- */

function photoKey(recordId, kind) {
  return recordId + ':' + kind;
}

// 열 수 없으면(사생활 보호 모드 등) null
function openPhotoDb() {
  if (!photoDbPromise) {
    photoDbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('grooming-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'key' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  return photoDbPromise;
}

// store 작업 하나를 Promise로 실행합니다. fn(store)가 돌려준 request의 결과를 돌려줍니다.
async function photoTx(mode, fn) {
  const idb = await openPhotoDb();
  if (!idb) throw new Error('no-db');
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('photos', mode);
    const req = fn(tx.objectStore('photos'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function allPhotos() {
  return photoTx('readonly', (s) => s.getAll()).catch(() => []);
}

async function putPhoto(recordId, kind, blob) {
  const key = photoKey(recordId, kind);
  await photoTx('readwrite', (s) => s.put({ key, recordId, kind, blob, savedAt: Date.now() }));
  if (photoUrls.has(key)) URL.revokeObjectURL(photoUrls.get(key));
  photoUrls.set(key, URL.createObjectURL(blob));
}

async function deletePhotos(recordIds) {
  const keys = recordIds.flatMap((id) => Object.keys(PHOTO_KINDS).map((k) => photoKey(id, k)));
  for (const key of keys) {
    if (photoUrls.has(key)) { URL.revokeObjectURL(photoUrls.get(key)); photoUrls.delete(key); }
  }
  try {
    await photoTx('readwrite', (s) => { keys.forEach((k) => s.delete(k)); return null; });
  } catch (e) {
    console.error('사진 삭제 실패', e);
  }
}

function photoCount(recordIds) {
  return recordIds.reduce((n, id) => n + Object.keys(PHOTO_KINDS).filter((k) => photoUrls.has(photoKey(id, k))).length, 0);
}

/* ---------- 줄이기 / 저장 ---------- */

function isImage(file) {
  return file && /^image\//.test(file.type);
}

async function resizeImage(file) {
  if (!isImage(file)) throw new Error('not-image');
  let bmp;
  try {
    // 휴대폰 사진의 회전 정보를 반영합니다.
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await createImageBitmap(file); // 'from-image'를 모르는 예전 브라우저
  }
  const scale = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', PHOTO_QUALITY));
}

// 실패하면 안내하고 false. 성공하면 화면을 다시 그립니다.
async function savePhotoFile(recordId, kind, file) {
  if (!file) return false;
  if (!isImage(file)) { alert('이미지 파일만 올릴 수 있습니다.'); return false; }
  if (!(await openPhotoDb())) { alert('이 브라우저에서는 사진을 저장할 수 없습니다.'); return false; }
  try {
    await putPhoto(recordId, kind, await resizeImage(file));
  } catch (e) {
    console.error('사진 저장 실패', e);
    alert('사진을 저장하지 못했습니다. 다른 사진으로 다시 시도해주세요.');
    return false;
  }
  refreshPhotoViews();
  return true;
}

// 기록을 저장한 뒤 폼에서 고른 사진들을 붙입니다. (사진 실패가 기록을 막지 않음)
async function attachPhotos(recordId, files) {
  for (const kind of Object.keys(PHOTO_KINDS)) {
    if (files[kind]) await savePhotoFile(recordId, kind, files[kind]);
  }
}

function refreshPhotoViews() {
  renderDetail();
  if ($('#photo-dlg').open) renderPhotoViewer();
}

/* ---------- 기록 표의 사진 칸 ---------- */

function photoCell(r) {
  return Object.entries(PHOTO_KINDS).map(([kind, label]) => {
    const url = photoUrls.get(photoKey(r.id, kind));
    return url
      ? `<button type="button" class="thumb-btn" data-action="photo-view" data-id="${esc(r.id)}" aria-label="${label} 사진 크게 보기">
          <img class="thumb" src="${esc(url)}" alt="미용 ${label}"><span>${label}</span></button>`
      : `<button type="button" class="small photo-add" data-action="photo-add" data-id="${esc(r.id)}" data-kind="${kind}">+ ${label}</button>`;
  }).join('');
}

function pickPhoto(recordId, kind) {
  pendingPick = { recordId, kind };
  $('#photo-file').click();
}

async function onPhotoFileChange(e) {
  const file = e.target.files[0];
  e.target.value = '';
  const pick = pendingPick;
  pendingPick = null;
  if (file && pick) await savePhotoFile(pick.recordId, pick.kind, file);
}

/* ---------- 사진 보기 창 ---------- */

function openPhotoViewer(recordId) {
  viewingRecordId = recordId;
  renderPhotoViewer();
  if (!$('#photo-dlg').open) $('#photo-dlg').showModal();
}

function renderPhotoViewer() {
  const r = db.records.find((x) => x.id === viewingRecordId);
  if (!r) { $('#photo-dlg').close(); return; }
  const dog = db.dogs.find((d) => d.id === r.dogId);
  const btn = (action, kind, label, cls = '') => `<button type="button" class="small ${cls}" data-photo-action="${action}" data-kind="${kind}">${label}</button>`;
  const panes = Object.entries(PHOTO_KINDS).map(([kind, label]) => {
    const url = photoUrls.get(photoKey(r.id, kind));
    return `<figure class="photo-pane">
      <figcaption>미용 ${label}</figcaption>
      ${url ? `<img src="${esc(url)}" alt="미용 ${label}">` : '<div class="photo-empty">사진 없음</div>'}
      <div class="btns">${url ? btn('replace', kind, '바꾸기') + btn('delete', kind, '삭제', 'danger') : btn('add', kind, '사진 추가', 'primary')}</div>
    </figure>`;
  }).join('');
  $('#photo-body').innerHTML = `
    <h2>${esc(dog ? dog.name : '')} <span class="muted">${esc(r.date)} · ${esc(r.menu)}</span></h2>
    <div class="photo-pair">${panes}</div>
    <div class="dlg-actions"><button type="button" data-photo-action="close">닫기</button></div>`;
}

async function onPhotoViewerClick(e) {
  const btn = e.target.closest('[data-photo-action]');
  if (!btn) return;
  const { photoAction: action, kind } = btn.dataset;
  if (action === 'close') { $('#photo-dlg').close(); return; }
  if (action === 'add' || action === 'replace') { pickPhoto(viewingRecordId, kind); return; }
  if (action === 'delete' && confirm(`미용 ${PHOTO_KINDS[kind]} 사진을 삭제할까요?`)) {
    const key = photoKey(viewingRecordId, kind);
    if (photoUrls.has(key)) { URL.revokeObjectURL(photoUrls.get(key)); photoUrls.delete(key); }
    try { await photoTx('readwrite', (s) => s.delete(key)); } catch (err) { console.error('사진 삭제 실패', err); }
    refreshPhotoViews();
  }
}

/* ---------- 사진 백업 / 불러오기 ---------- */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data, type) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function exportPhotos() {
  const all = await allPhotos();
  if (!all.length) { alert('저장된 사진이 없습니다.'); return; }
  const photos = [];
  for (const p of all) photos.push({ recordId: p.recordId, kind: p.kind, type: p.blob.type || 'image/jpeg', data: await blobToBase64(p.blob) });
  download(`grooming-photos-${today()}.json`, JSON.stringify({ app: 'grooming-photos', version: 1, photos }), 'application/json');
}

async function importPhotos(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    parsed = null;
  }
  if (!parsed || parsed.app !== 'grooming-photos' || !Array.isArray(parsed.photos)) {
    alert('올바른 사진 백업 파일이 아닙니다.');
    return;
  }
  if (!(await openPhotoDb())) { alert('이 브라우저에서는 사진을 저장할 수 없습니다.'); return; }
  if (!confirm(`사진 ${parsed.photos.length}장을 불러옵니다. 같은 기록의 사진은 파일 쪽으로 바뀝니다. 계속할까요?`)) return;

  let added = 0, skipped = 0;
  for (const p of parsed.photos) {
    const ok = p && PHOTO_KINDS[p.kind] && typeof p.data === 'string' && db.records.some((r) => r.id === p.recordId);
    if (!ok) { skipped++; continue; }
    try {
      await putPhoto(p.recordId, p.kind, base64ToBlob(p.data, p.type || 'image/jpeg'));
      added++;
    } catch (e) {
      skipped++;
    }
  }
  refreshPhotoViews();
  alert(`사진 ${added}장을 불러왔습니다.` + (skipped ? ` (기록이 없거나 손상되어 ${skipped}장 건너뜀)` : ''));
}

/* ---------- 시작 ---------- */

async function initPhotos() {
  $('#photo-file').addEventListener('change', onPhotoFileChange);
  $('#photo-body').addEventListener('click', onPhotoViewerClick);
  $('#btn-photo-backup').addEventListener('click', exportPhotos);
  $('#btn-photo-restore').addEventListener('click', () => $('#file-photo-restore').click());
  $('#file-photo-restore').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importPhotos(f);
    e.target.value = '';
  });

  // 공간이 부족해도 브라우저가 사진을 스스로 지우지 않도록 요청
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  for (const p of await allPhotos()) photoUrls.set(p.key, URL.createObjectURL(p.blob));
  renderDetail();
}

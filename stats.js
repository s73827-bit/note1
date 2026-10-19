'use strict';

/* ============================================================
   미용샵 고객관리 - 3단계: 매출 통계
   월 단위 요약, 날짜별·월별 막대그래프, 메뉴·고객 순위.
   미용 기록(db.records)의 금액만 사용하고 데이터는 바꾸지 않습니다.
   ============================================================ */

const TOP_N = 5;
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

let statsMonth = today().slice(0, 7); // 'YYYY-MM'

/* ---------- 계산 ---------- */

function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0');
}

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function monthLabel(ym) {
  const [y, m] = ym.split('-');
  return `${y}년 ${Number(m)}월`;
}

// 날짜 형식이 맞는 기록만 통계에 씁니다.
function isStatRecord(r) {
  return /^\d{4}-\d{2}-\d{2}$/.test(r.date);
}

// 숫자가 아니거나 음수인 금액은 0원으로 봅니다.
function amount(r) {
  const n = Number(r.price);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function recordsOf(ym) {
  return db.records.filter((r) => isStatRecord(r) && r.date.startsWith(ym + '-'));
}

// 띄어쓰기·대소문자만 다른 메뉴는 같은 메뉴로 묶습니다.
function menuKey(menu) {
  return String(menu ?? '').replace(/\s+/g, '').toLowerCase();
}

function topMenus(recs) {
  const groups = new Map();
  for (const r of recs) {
    const key = menuKey(r.menu);
    const g = groups.get(key) || { count: 0, total: 0, spellings: new Map() };
    const spelling = String(r.menu ?? '').trim();
    g.count += 1;
    g.total += amount(r);
    g.spellings.set(spelling, (g.spellings.get(spelling) || 0) + 1);
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    // 가장 많이 쓰인 표기를 대표 이름으로 (같으면 먼저 쓰인 것)
    let name = '', best = 0;
    for (const [s, n] of g.spellings) if (n > best) { name = s; best = n; }
    return { name: key ? name : '(메뉴 없음)', count: g.count, total: g.total };
  }).sort((a, b) => b.count - a.count || b.total - a.total);
}

function topCustomers(recs) {
  const groups = new Map();
  for (const r of recs) {
    const dog = db.dogs.find((d) => d.id === r.dogId);
    const owner = dog && db.owners.find((o) => o.id === dog.ownerId);
    const key = owner ? owner.id : '';
    const g = groups.get(key) || { ownerId: key, name: owner ? owner.name : '(삭제된 고객)', dogs: [], count: 0, total: 0 };
    if (dog && !g.dogs.includes(dog.name)) g.dogs.push(dog.name);
    g.count += 1;
    g.total += amount(r);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || b.count - a.count);
}

function sumUntil(recs, day) {
  return recs.filter((r) => Number(r.date.slice(8)) <= day).reduce((s, r) => s + amount(r), 0);
}

function monthStats(ym) {
  const recs = recordsOf(ym);
  const total = recs.reduce((s, r) => s + amount(r), 0);
  // 이번 달은 아직 끝나지 않았으므로 1일~오늘을 지난달 1일~같은 날과 비교합니다.
  const compareDay = ym === today().slice(0, 7) ? Number(today().slice(8)) : null;
  const compareTotal = compareDay ? sumUntil(recs, compareDay) : total;
  const prevTotal = sumUntil(recordsOf(addMonths(ym, -1)), compareDay || 31);
  const daily = new Array(daysInMonth(ym)).fill(0);
  for (const r of recs) {
    const i = Number(r.date.slice(8)) - 1;
    if (i >= 0 && i < daily.length) daily[i] += amount(r);
  }
  return {
    total,
    count: recs.length,
    avg: recs.length ? Math.round(total / recs.length) : 0,
    compareDay,
    prevTotal,
    change: prevTotal > 0 ? Math.round((compareTotal - prevTotal) / prevTotal * 100) : null,
    daily,
    menus: topMenus(recs),
    customers: topCustomers(recs)
  };
}

// 보고 있는 달까지 최근 n개월 (오래된 달 → 최근 달)
function monthlyTotals(ym, n = 12) {
  return Array.from({ length: n }, (_, i) => {
    const m = addMonths(ym, i - (n - 1));
    return { ym: m, total: recordsOf(m).reduce((s, r) => s + amount(r), 0) };
  });
}

/* ---------- 막대그래프 ---------- */

// 축 눈금: 1·2·5 × 10^k 단위로 3~5칸
function niceTicks(max) {
  if (max <= 0) max = 10000;
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

function compactWon(v) {
  return v >= 10000 ? Number((v / 10000).toFixed(1)) + '만' : v.toLocaleString('ko-KR');
}

// items: [{ key, label(축 글자, 빈 값이면 생략), unit(좁은 화면에서 숨길 단위), tip, value, current }]
function barChart(id, title, items) {
  const ticks = niceTicks(Math.max(...items.map((x) => x.value)));
  const top = ticks[ticks.length - 1];
  const grid = ticks.map((t) => `<div class="grid" style="bottom:${t / top * 100}%"><span>${compactWon(t)}</span></div>`).join('');
  const bars = items.map((x) => `
    <button type="button" class="bar ${x.current ? 'current' : ''}" data-key="${esc(x.key)}"
      data-tip="${esc(x.tip)}" data-value="${x.value}" aria-label="${esc(x.tip)} ${won(x.value)}">
      <span class="bar-fill" style="height:${x.value / top * 100}%"></span>
    </button>`).join('');
  const labels = items.map((x) => `<span>${esc(x.label)}${x.unit ? `<small>${esc(x.unit)}</small>` : ''}</span>`).join('');
  const rows = items.map((x) => `<tr><td>${esc(x.tip)}</td><td>${won(x.value)}</td></tr>`).join('');
  return `
    <div class="card chart" id="${id}">
      <h2>${esc(title)}</h2>
      <div class="chart-plot">${grid}<div class="bars">${bars}</div></div>
      <div class="chart-x">${labels}</div>
      <details class="chart-table"><summary>표로 보기</summary>
        <table><thead><tr><th>기간</th><th>매출</th></tr></thead><tbody>${rows}</tbody></table>
      </details>
    </div>`;
}

function showTip(bar) {
  const tip = $('.chart-tip');
  const box = $('#view-stats').getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  tip.innerHTML = `${esc(bar.dataset.tip)}<b>${won(bar.dataset.value)}</b>`;
  tip.hidden = false;
  tip.style.left = (b.left + b.width / 2 - box.left) + 'px';
  tip.style.top = (b.top - box.top) + 'px';
}

function hideTip() {
  $('.chart-tip').hidden = true;
}

/* ---------- 화면 ---------- */

function statCard(label, value, sub = '', cls = '') {
  return `<div class="stat ${cls}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

function renderStats() {
  const s = monthStats(statsMonth);
  $('#stats-label').textContent = monthLabel(statsMonth);
  hideTip();

  const period = s.compareDay ? `지난달 1~${s.compareDay}일` : '지난달';
  const changeLabel = s.compareDay ? '지난달 같은 기간 대비' : '지난달 대비';
  let change;
  if (s.change === null) change = statCard(changeLabel, '비교 불가', `${period} 매출 없음`, 'flat');
  else if (s.change === 0) change = statCard(changeLabel, '변동 없음', `${period} ${won(s.prevTotal)}`, 'flat');
  else change = statCard(changeLabel, `${s.change > 0 ? '▲' : '▼'} ${Math.abs(s.change)}%`, `${period} ${won(s.prevTotal)}`, s.change > 0 ? 'up' : 'down');

  const cards = `<div class="stat-cards">
    ${statCard('총매출', won(s.total))}
    ${statCard('방문 건수', s.count + '건')}
    ${statCard('1건당 평균', s.count ? won(s.avg) : '-')}
    ${change}
  </div>`;

  const [y, m] = statsMonth.split('-').map(Number);
  const daily = barChart('chart-daily', '날짜별 매출', s.daily.map((v, i) => {
    const day = i + 1;
    const date = `${statsMonth}-${String(day).padStart(2, '0')}`;
    const dow = DAY_NAMES[new Date(y, m - 1, day).getDay()];
    return { key: date, label: day === 1 || day % 5 === 0 ? String(day) : '', tip: `${m}월 ${day}일 (${dow})`, value: v };
  }));
  const monthly = barChart('chart-monthly', '최근 12개월 매출', monthlyTotals(statsMonth).map((x) => ({
    key: x.ym, label: String(Number(x.ym.slice(5))), unit: '월', tip: monthLabel(x.ym), value: x.total, current: x.ym === statsMonth
  })));

  const menuRows = s.menus.slice(0, TOP_N).map((x, i) => `
    <tr><td>${i + 1}</td><td>${esc(x.name)}</td><td>${x.count}건</td><td>${won(x.total)}</td></tr>`).join('');
  const customerRows = s.customers.slice(0, TOP_N).map((x, i) => `
    <tr><td>${i + 1}</td>
      <td>${x.ownerId ? `<button type="button" class="link" data-owner="${esc(x.ownerId)}">${esc(x.name)}</button>` : esc(x.name)}</td>
      <td>${esc(x.dogs.join(', '))}</td><td>${x.count}회</td><td>${won(x.total)}</td></tr>`).join('');
  const ranks = `<div class="stats-grid">
    <div class="card"><h2>메뉴 TOP ${TOP_N}</h2><div class="table-wrap"><table>
      <thead><tr><th></th><th>메뉴</th><th>건수</th><th>매출</th></tr></thead><tbody>${menuRows}</tbody></table></div></div>
    <div class="card"><h2>고객 TOP ${TOP_N}</h2><div class="table-wrap"><table>
      <thead><tr><th></th><th>보호자</th><th>반려견</th><th>방문</th><th>매출</th></tr></thead><tbody>${customerRows}</tbody></table></div></div>
  </div>`;

  // 충전금은 충전할 때 받은 돈이라 매출(미용 기록)과 따로 보여줍니다. 더하면 이중 계산이 돼요.
  const paid = chargePaidIn(statsMonth);
  const charged = paid ? `<p class="mb-stat">${monthLabel(statsMonth)} 충전 결제 금액 <b>${won(paid)}</b>
    <span class="muted">· 충전할 때 받은 돈이에요. 충전금으로 한 미용은 위 매출에 이미 들어 있어요.</span></p>` : '';

  $('#stats-body').innerHTML = s.count
    ? `${cards}${charged}<div class="stats-grid">${daily}${monthly}</div>${ranks}`
    : `${cards}${charged}<div class="placeholder">이 달에는 미용 기록이 없습니다.</div>${monthly}`;
}

function onStatsClick(e) {
  const owner = e.target.closest('[data-owner]');
  if (!owner) return;
  const dog = db.dogs.find((d) => d.ownerId === owner.dataset.owner);
  if (!dog) return;
  selectedDogId = dog.id;
  showTab('customers');
}

/* ---------- 시작 ---------- */

function initStats() {
  $('#stats-prev').addEventListener('click', () => { statsMonth = addMonths(statsMonth, -1); renderStats(); });
  $('#stats-next').addEventListener('click', () => { statsMonth = addMonths(statsMonth, 1); renderStats(); });
  $('#stats-today').addEventListener('click', () => { statsMonth = today().slice(0, 7); renderStats(); });

  const body = $('#stats-body');
  body.addEventListener('click', onStatsClick);
  body.addEventListener('pointerover', (e) => { const bar = e.target.closest('.bar'); if (bar) showTip(bar); else hideTip(); });
  body.addEventListener('pointerleave', hideTip);
  body.addEventListener('focusin', (e) => { const bar = e.target.closest('.bar'); if (bar) showTip(bar); });
  body.addEventListener('focusout', hideTip);
}

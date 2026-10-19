# 예약 캘린더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미용샵 고객관리 앱에 주간 시간표 예약 캘린더와 예약 상태 관리를 추가한다.

**Architecture:** 빌드 도구 없는 바닐라 JS. 새 `reservations.js`가 예약 기능을 맡고, `app.js`와 일반 `<script>` 전역(`db`, `save`, `esc`, `uid`, `today`, `digits`)을 공유한다. `app.js`의 `init()`은 `DOMContentLoaded`에서 실행해 두 파일이 모두 로드된 뒤 시작한다.

**Tech Stack:** HTML/CSS/JS(ES2020), localStorage, `<dialog>`. 테스트는 Playwright MCP로 실제 브라우저에서 `browser_evaluate` 시나리오 실행(`http-server`로 로컬 서빙).

**Spec:** `docs/superpowers/specs/2026-10-19-reservation-calendar-design.md`

## Global Constraints

- 시간표 09:00~20:00, 30분 칸, 기본 소요 90분(30~300분, 30분 단위)
- 상태 값: `scheduled`(예정) / `done`(완료) / `canceled`(취소) / `noshow`(노쇼)
- 겹침 경고 대상: 같은 날짜, 상태 `scheduled`·`done`
- 사용자 입력은 화면에 넣을 때 모두 `esc()`를 거친다
- 예약이 없는 예전 백업도 그대로 불러와져야 한다
- 외부 라이브러리 추가 없음

## Review Focus

- 예약이 가리키는 반려견이 삭제/손상됨 → 블록에 "(삭제된 반려견)", 상세창은 삭제만 가능 (Task 2 테스트)
- 시간표 범위 밖 예약(08:00 시작, 19:30 시작 90분) → 잘려서 보이고 클릭 가능 (Task 2 테스트)
- 기록창을 열었다가 취소 → 예약은 `scheduled` 유지, 기록 생성 없음 (Task 3 테스트)
- 같은 반려견을 연속 완료→되돌리기→완료 → 기록 2건, 예약은 마지막 기록 id (Task 3 테스트)
- 주 경계(일요일 예약)와 연도 넘김 주 이동 → 올바른 열에 표시 (Task 2 테스트)

---

### Task 1: 데이터·탭·앱 연결

**Files:**
- Modify: `app.js` (`db` 초기값, `normalize`, `deleteDog`, `renderDetail`, `onDetailClick`, `onDetailSubmit`, `init`, 검색 매칭 함수 추출)
- Modify: `index.html` (탭, 예약 뷰 영역, 스크립트 로드)
- Create: `reservations.js` (뼈대: 상수, `normalizeReservation`, `initReservations`, `renderCalendar` 빈 구현)

**Interfaces:**
- Produces (app.js): `showTab(name: 'customers'|'calendar')`, `dogMatches(dog, owner, q: string): boolean`, `checkRecord(rec): boolean`(방문일·메뉴·금액 검사)
- Produces (reservations.js): `normalizeReservation(r): Reservation`, `initReservations()`, `renderCalendar()`, `openResDialog({dogId?, date?, start?, id?})`, `showReservation(id)`

- [ ] 브라우저 테스트: 예약 없는 예전 데이터 로드 → `db.reservations` = `[]`; 탭 전환 시 뷰 표시 전환; 반려견 삭제 시 그 반려견 예약 삭제·확인창에 "예약 N건" 포함
- [ ] 구현 후 테스트 통과, 기존 고객 기능(등록·검색·기록) 회귀 없음

### Task 2: 주간 시간표 + 예약 등록/수정/상세

**Files:** `reservations.js`, `index.html`(예약창 `#res-dlg`, 상세창 `#res-view-dlg`), `style.css`

- 겹침 배치: 같은 날 예약을 시작순 정렬, 이어지는 겹침 묶음마다 빈 열에 탐욕 배치, 묶음의 열 수로 너비 분할
- 범위 밖 시간은 `[09:00, 20:00]`로 잘라 표시, 전부 밖이면 가장자리 30분 칸에 표시

- [ ] 브라우저 테스트: 빈 칸 클릭 → 날짜·시간 미리 채움 → 저장 시 블록 위치(top) 일치; 겹침 저장 confirm 거절 시 미저장 / 수락 시 2열 배치; 취소된 예약과는 경고 없음; ◀ ▶ 이번 주 이동, 2026-12-28 주 → 다음 주 2027-01-04; 일요일 예약이 7번째 열; 범위 밖 예약 표시; 삭제된 반려견 예약 표시
- [ ] 구현 후 테스트 통과

### Task 3: 상태 변경·완료→미용 기록·반려견 상세 연결

**Files:** `reservations.js`, `index.html`(기록창 `#rec-dlg`), `app.js`(`renderDetail`의 「예약 추가」·「다가오는 예약」)

- [ ] 브라우저 테스트: 취소/노쇼 색 클래스; 완료 → 기록창 방문일·메뉴 채움 → 저장 시 기록 생성·`status='done'`·`recordId`; 기록창 취소 시 미변경; 완료→되돌리기(확인창)→다시 완료 시 기록 2건; 상세 「예약 추가」 시 반려견 미리 선택; 「다가오는 예약」 클릭 → 해당 주 + 상세창
- [ ] 구현 후 테스트 통과

### Task 4: 마무리 확인

- [ ] 모바일 390px 스크린샷, 데스크톱 스크린샷 확인
- [ ] 콘솔 오류 없음, 백업 JSON에 reservations 포함
- [ ] README 기능 목록·다음 단계 갱신, 테스트 산출물(`.playwright-mcp`) 삭제

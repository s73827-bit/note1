# 매출 통계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월 단위 매출 요약·추이 그래프·메뉴/고객 순위를 보여주는 「매출」 탭을 추가한다.

**Architecture:** 새 `stats.js`가 계산(`monthStats`, `monthlyTotals`)과 화면(`renderStats`)을 맡는다. 다른 파일처럼 일반 `<script>` 전역(`db`, `esc`, `won`, `today`, `showTab`, `selectedDogId`)을 공유한다. 그래프는 인라인 SVG 막대.

**Tech Stack:** 바닐라 HTML/CSS/JS, 테스트는 Playwright MCP 브라우저 시나리오.

**Spec:** `docs/superpowers/specs/2026-10-19-sales-stats-design.md`

## Global Constraints

- 매출 = 미용 기록 금액 합. 날짜가 `YYYY-MM-DD`가 아닌 기록 제외, 금액이 숫자가 아니거나 음수면 0원
- 지난달 0원이면 "비교 불가"
- 메뉴 키 = 공백 제거 + 소문자, 표시 = 가장 많이 쓰인 표기
- 막대 색: 강조 `#3b6cf6`(--primary), 그 외 달 `#89a6f8` (dataviz 검증 통과), 막대 두께 ≤ 24px, 위쪽 4px 둥근 끝
- 막대마다 hover/focus 툴팁, 그래프마다 「표로 보기」
- 사용자 입력은 `esc()`를 거친다

## Review Focus

- 기록에 메뉴·금액·날짜가 비었거나 이상함 → 통계가 깨지지 않음 (S1, S11)
- 반려견이 삭제된 기록 → 「(삭제된 고객)」으로 묶임 (S5)
- 연도 경계 달 이동 (S3)
- 기록 0건 달 (S6)
- 메뉴 이름에 HTML이 들어간 기록 → 그대로 글자로 표시 (S11)

---

### Task 1: 계산 함수 + 매출 탭 + 화면

**Files:** Create `stats.js`; Modify `index.html`, `style.css`, `app.js`(`showTab`, `init`)

**Interfaces (Produces):**
- `statsMonth: string` ('YYYY-MM'), `addMonths(ym, n): string`, `daysInMonth(ym): number`
- `monthStats(ym) → { total, count, avg, prevTotal, change: number|null, daily: number[], menus: [{name, count, total}], customers: [{ownerId, name, dogs: string[], count, total}] }`
- `monthlyTotals(ym, n = 12) → [{ ym, total }]` (오래된 달 → 보고 있는 달)
- `renderStats()`, `initStats()`; DOM: `#view-stats`, `#stats-prev`, `#stats-next`, `#stats-today`, `#stats-label`, `#chart-daily`, `#chart-monthly`(막대 `.bar`, 현재 달 `.bar.current`, `data-key`), 고객 링크 `[data-owner]`

- [ ] 브라우저 테스트 S1~S11 작성 → 실행해 실패 확인
- [ ] 구현 → S1~S11 통과, 기존 예약 테스트 21개 회귀 없음
- [ ] 데스크톱·390px 스크린샷 확인, 콘솔 오류 없음, README 갱신

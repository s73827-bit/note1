# 전/후 사진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미용 기록마다 전·후 사진 1장씩을 IndexedDB에 저장·표시하고, 사진만 따로 백업·복원한다.

**Architecture:** 새 `photos.js`가 IndexedDB(`grooming-photos`/`photos`)와 메모리 캐시(`key → objectURL`)를 관리한다. 시작 시 캐시를 채운 뒤 상세 화면을 다시 그려서, 다른 화면 코드는 동기 함수(`photoCell`, `photoCount`)만 쓴다. 저장·삭제는 비동기로 IndexedDB와 캐시를 함께 갱신한 뒤 다시 그린다.

**Tech Stack:** 바닐라 JS, IndexedDB, canvas(`toBlob` JPEG). 테스트는 Playwright MCP 브라우저 시나리오, canvas로 만든 실제 이미지 파일 사용.

**Spec:** `docs/superpowers/specs/2026-10-19-before-after-photos-design.md`

## Global Constraints

- 긴 변 최대 1280px, JPEG 0.82, 작은 사진은 키우지 않음
- 키 `${recordId}:${kind}`, kind = `before` | `after`
- 기존 `db`(localStorage)·「백업 저장」 형식 변경 없음
- 사진 백업 형식 `{ app: 'grooming-photos', version: 1, photos: [{ recordId, kind, type, data }] }`
- 사진 저장 실패가 기록 저장을 막지 않음

## Review Focus

- IndexedDB를 못 여는 브라우저(사생활 보호 모드) → 다른 기능 정상, 사진 버튼은 안내만 (코드 검토)
- 아주 큰 사진(3000×2000) → 줄여서 저장 (P1)
- 이미지가 아닌 파일 → 거부 (P8)
- 기록 없는 사진이 든 백업 → 건너뜀 (P7)
- 상세 화면을 빠르게 바꿀 때 늦게 끝난 사진 저장이 다른 반려견 화면을 덮지 않음 (저장 후 `renderDetail()`은 현재 선택 기준으로 그림)

---

### Task 1: 사진 저장소·첨부·보기·삭제 연동·사진 백업

**Files:** Create `photos.js`; Modify `index.html`, `app.js`, `reservations.js`, `style.css`

**Interfaces (Produces, photos.js):**
- `resizeImage(file: File) → Promise<Blob>` (이미지 아니면 `Error('not-image')`)
- `savePhotoFile(recordId, kind, file) → Promise<boolean>`
- `attachPhotos(recordId, { before?: File, after?: File }) → Promise<void>`
- `deletePhotos(recordIds: string[]) → Promise<void>`, `photoCount(recordIds) → number`
- `allPhotos() → Promise<{key, recordId, kind, blob}[]>`
- `photoCell(record) → string`(HTML), `pickPhoto(recordId, kind)`, `openPhotoViewer(recordId)`
- `exportPhotos() → Promise<void>`, `importPhotos(file) → Promise<void>`, `initPhotos() → Promise<void>`
- DOM: `#r-before`/`#r-after`, `#rd-before`/`#rd-after`, `#photo-file`, `#photo-dlg`, `[data-action="photo-add"|"photo-view"]`, `[data-photo-action="add"|"replace"|"delete"|"close"]`, `#btn-photo-backup`, `#btn-photo-restore`, `details.menu`

- [ ] 브라우저 테스트 P1~P10 작성 → 실행해 실패 확인
- [ ] 구현 → P1~P10 통과, 기존 35개 회귀 없음
- [ ] 데스크톱·390px 스크린샷, 콘솔 오류 없음, README 갱신

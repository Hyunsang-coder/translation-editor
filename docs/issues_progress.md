# 이슈 수정 진행 체크리스트

> `docs/issues.md` 분석 결과에 대한 수정 진행 상황 추적

## 진행 상황 요약

| 상태 | 개수 |
|------|------|
| 완료 | 8 / 13 |
| 진행 중 | 0 |
| 대기 | 5 |

---

## Track 1: TipTap JSON 캐시 (독립)

- [ ] **#4** [CRITICAL] TipTap JSON 캐시 동기화 불일치
  - 파일: `src/stores/projectStore.ts`
  - 작업: TipTap `onUpdate` 콜백에서 JSON 캐시 동기화 보장

---

## Track 2: chatStore 스트리밍 (순차: #1 → #11 → #7)

- [x] **#1** [HIGH] 스트리밍 메시지 완료 Race Condition ✅
  - 파일: `src/stores/chatStore.ts`
  - 작업: `isFinalizingStreaming` 가드 플래그 추가
  - 완료: 2025-01-14 - `isFinalizingStreaming` 상태 추가, `sendMessage()` 시작 시 finalization 완료 대기 로직 추가, `finalizeStreaming()`에 try-finally 패턴 적용

- [x] **#11** [MEDIUM] 스트리밍 메타데이터 손실 ✅
  - 파일: `src/stores/chatStore.ts`
  - 작업: `finalizeStreaming()`에서 메타데이터 보존
  - 완료: 2025-01-14 - `toolCallsInProgress`만 초기화하고 나머지 메타데이터(`toolsUsed`, `suggestion` 등) 보존

- [x] **#7** [MEDIUM] streamAssistantReply 불완전한 에러 복구 ✅
  - 파일: `src/stores/chatStore.ts`
  - 작업: finally 블록에서 상태 정리
  - 완료: 2025-01-14 - catch 블록에서 `statusMessage`, `isFinalizingStreaming`, `composerAttachments` 완전 정리, `sendMessage()`와 `replayMessage()` 모두 수정

---

## Track 3: AbortController / 요청 관리 (순차: #2 → #9)

- [ ] **#2** [HIGH] AbortController 정리 누락
  - 파일: `src/stores/chatStore.ts`
  - 작업: AbortController 정리 큐 구현, try-finally 패턴

- [ ] **#9** [HIGH] 채팅 저장 Debounce vs 프로젝트 저장 Race
  - 파일: `src/stores/chatStore.ts`
  - 작업: 프로젝트별 타이머 사용, persist 시 프로젝트 ID 재검증
  - 의존: #2 완료 후

---

## Track 4: 프로젝트 하이드레이션 (순차: #3 → #5)

- [x] **#3** [HIGH] 프로젝트 하이드레이션 Race Condition ✅
  - 파일: `src/stores/projectStore.ts`, `src/stores/chatStore.ts`
  - 작업: 하이드레이션 단계 순차 실행, 프로젝트 ID 검증 강화
  - 완료: 2025-01-14 - switchProjectById()에서 chatStore.hydrateForProject() 명시적 호출, hydrateForProject()에서 진행 중인 API 요청 취소, 프로젝트 ID 재검증 로깅 강화

- [x] **#5** [MEDIUM] pendingDocDiff 상태 미정리 ✅
  - 파일: `src/stores/projectStore.ts`
  - 작업: `switchProjectById()`에서 명시적 정리 추가
  - 완료: 2025-01-14 - switchProjectById() 시작 시 pendingDocDiff 즉시 null로 초기화 (loadProject()에서도 정리하지만 비동기 작업 중 stale 참조 방지)

---

## Track 5: Review 컴포넌트 (병렬 가능)

- [x] **#8** [MEDIUM] 검수 도구 에러 시 상태 롤백 없음 ✅
  - 파일: `src/components/review/ReviewPanel.tsx`
  - 작업: `parseReviewResult()` try-catch 래핑, 에러 시 `isReviewing = false` 보장
  - 완료: 2025-01-14 - parseReviewResult에 try-catch 추가, 파싱 실패 시 handleChunkError 호출 후 다음 청크 진행

- [x] **#13** [MEDIUM] 검수 시 번역 규칙 스냅샷 문제 ✅
  - 파일: `src/components/review/ReviewPanel.tsx`
  - 작업: 각 청크 처리 시 최신 규칙 가져오기
  - 완료: 2025-01-14 - useCallback 내에서 useChatStore.getState()로 최신 translationRules/projectContext 가져오도록 수정

---

## 독립 이슈 (언제든 진행 가능)

- [ ] **#6** [MEDIUM] 검수 하이라이트 vs 문서 변경 불일치
  - 파일: `src/stores/reviewStore.ts`
  - 작업: 문서 편집 시 하이라이트 무효화

- [ ] **#10** [LOW] Document Tools null 체크 없음
  - 파일: `src/ai/tools/documentTools.ts`
  - 작업: null 안전성 검사 추가

- [ ] **#12** [LOW] composerAttachments 조기 정리
  - 파일: `src/stores/chatStore.ts`
  - 작업: finally 블록에서 정리

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2025-01-14 | 초기 체크리스트 생성 |
| 2025-01-14 | Track 5 완료 (#8, #13) - Review 컴포넌트 에러 처리 및 규칙 스냅샷 문제 수정 |
| 2025-01-14 | Track 4 완료 (#3, #5) - 프로젝트 하이드레이션 Race Condition 및 pendingDocDiff 상태 정리 |
| 2025-01-14 | Track 2 완료 (#1, #11, #7) - chatStore 스트리밍 Race Condition, 메타데이터 손실, 에러 복구 수정 |

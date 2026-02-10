# Session Handoff

> Generated: 2026-02-10
> Branch: main

## 작업 요약

듀얼 사이드바에서 **채팅 세션 격리 문제를 분석하고 수정 계획을 수립**했다. 양쪽 사이드바에 서로 다른 채팅 세션이 열릴 때 `chatStore`의 전역 상태(`currentSessionId`, 스트리밍, 컴포저)가 공유되어 잘못된 세션에 메시지가 전송되는 버그. 코드 변경은 없으며, 구현 계획서가 완성되어 있다.

## 현재 상태

### 변경된 파일
- Working tree clean (코드 변경 없음)
- `.claude/plans/jazzy-puzzling-emerson.md` — 구현 계획서 (신규 생성, untracked)

### 커밋 이력 (이번 세션)
- 없음 (분석 및 계획 수립만 진행)

## 미완료 작업

- [ ] **계획 구현**: `.claude/plans/jazzy-puzzling-emerson.md`에 따라 3개 파일 수정
  - [ ] `chatStore.ts` — `streamingSessionId` 추가, 헬퍼 함수 추가, 메시지 액션에 `targetSessionId?` 파라미터 추가
  - [ ] `chatStore.selectors.ts` — 세션별 셀렉터 추가 (`useSessionStreamingState`, `useSessionMessages`, `useSessionSearchState`)
  - [ ] `ChatContent.tsx` — `switchSession()` 마운트 제거, 로컬 컴포저, 세션별 렌더링
- [ ] `/typecheck` — 타입 에러 없음 확인
- [ ] `npm run test:run` — 기존 테스트 통과 확인
- [ ] 듀얼 패널 수동 테스트 (7개 시나리오, 계획서 "검증 방법" 섹션 참조)

## 핵심 결정 사항

- **Hybrid 접근 (Option C)**: chatStore 구조 대폭 변경 대신, ChatContent가 `sessionId` prop으로 세션을 직접 조회 + 액션에 optional `targetSessionId` 추가 (대안: A-전체 per-session state map 리팩터링/diff 너무 큼, B-세션 직접 조회만/스트리밍·컴포저 미해결)
- **`currentSessionId` 유지**: 삭제하지 않고 "마지막 상호작용 세션" 용도로 보존. 외부 "채팅에 추가" 버튼(`DomSelectionAddToChat`, `TipTapEditor` 등)이 이 값에 의존
- **컴포저 로컬화**: `composerText`를 chatStore에서 제거하지 않고, ChatContent에서 `useState` 로컬 관리. 글로벌 `appendComposerText`는 subscribe로 흡수, 언마운트 시 flush
- **단일 패널 사이드이펙트 0**: `targetSessionId` 미지정 시 `currentSessionId` 폴백 → 기존 동작 완전 보존

## 주의사항

- **`sendMessage` / `replayMessage`가 가장 복잡**: 100줄+ 함수. `resolvedSessionId` 도입 시 내부의 모든 `currentSession` / `get().currentSession` 참조를 빠짐없이 교체해야 함
- **`addComposerAttachment` 로직 추출**: 현재 chatStore 액션에 파일→AttachmentDto 변환 포함. 로컬 컴포저로 이동 시 순수 함수 추출이 필요할 수 있음 (`createAttachmentFromPath` 같은 형태)
- **스트리밍 동시 1개**: API 제약으로 양쪽 동시 스트리밍 불가. `streamingSessionId`로 어느 패널인지만 추적
- **persistence**: `composerText`는 프로젝트 레벨 영속 필드. 로컬화해도 언마운트 시 글로벌로 flush 필수
- **`streamingSessionId: null` 리셋**: `streamingMessageId: null`을 설정하는 **모든** 에러 핸들러에 같이 추가해야 함 (5곳+)

## 핵심 파일

- `src/stores/chatStore.ts` — 채팅 상태 관리 (수정 대상: streamingSessionId, targetSessionId, 헬퍼)
- `src/stores/chatStore.selectors.ts` — 그룹 셀렉터 (수정 대상: 세션별 셀렉터 3개 추가)
- `src/components/chat/ChatContent.tsx` — 채팅 UI (수정 대상: 세션 격리 렌더링, 로컬 컴포저)
- `src/stores/uiStore.ts` — 사이드바 상태 (참조만, 변경 없음)
- `src/types/index.ts` — PanelType, chatPanelId 등 (참조만, 변경 없음)

## 다음 세션 가이드

1. **계획서 필독**: `.claude/plans/jazzy-puzzling-emerson.md` — 전체 구현 명세가 Phase 1~8로 정리되어 있음
2. **구현 순서** (Phase별 `/typecheck` 실행 권장):
   - Phase 1: `chatStore.ts`에 `streamingSessionId` 필드 + `resolveSession`/`patchSession` 헬퍼 추가
   - Phase 2: 메시지 액션에 `targetSessionId?` 파라미터 추가 (addMessage → updateMessage → editMessage → deleteMessageFrom → clearMessages → sendMessage → replayMessage 순)
   - Phase 3: `chatStore.selectors.ts`에 `useSessionStreamingState`, `useSessionMessages`, `useSessionSearchState` 추가
   - Phase 4: `ChatContent.tsx` — switchSession 제거 → 세션별 셀렉터 사용 → 로컬 컴포저 → 액션에 sessionId 전달
3. **최종 검증**: 계획서 "검증 방법" 섹션의 7개 시나리오 수동 테스트

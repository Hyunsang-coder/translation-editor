# Session Handoff

> Generated: 2026-02-10
> Branch: main

## 작업 요약

**듀얼 사이드바 채팅 세션 격리 — 구현 + 버그 수정 완료**.

3개 세션에 걸쳐 분석→구현→코드 리뷰→버그 수정까지 완료.
양쪽 사이드바에 서로 다른 채팅 세션이 열릴 때 메시지가 잘못된 세션으로 전송되던 문제 해결.

## 현재 상태

- Working tree: **clean**
- 모든 타입 체크 통과, 339 tests passed

### 커밋 이력 (이번 세션)

| 커밋 | 내용 |
|------|------|
| `a32ae25` | 채팅 세션 격리 문제 분석 및 구현 계획 |
| `1a918b3` | Phase 1-3: streamingSessionId, targetSessionId, 셀렉터 |
| `888daa2` | Phase 4: ChatContent 세션별 렌더링 |
| `7ae8239` | 코드 리뷰 후 버그 수정 6건 (Rules of Hooks, 리셋 누락, as any 제거 등) |

## 미완료 작업

### 수동 테스트 (듀얼 사이드바)
- [ ] 양쪽 사이드바에 서로 다른 세션 열고 각각 메시지 전송
- [ ] 한쪽에서 스트리밍 중 다른 쪽 세션 전환
- [ ] 한쪽에서 메시지 편집(edit) → 올바른 세션에서 truncation 확인
- [ ] 한쪽에서 메시지 재전송(replay) → 올바른 세션에서 동작 확인
- [ ] 외부 "채팅에 추가" 버튼 (Cmd+L) → currentSessionId로 전송 확인
- [ ] 프로젝트 전환 → 양쪽 세션 상태 정상 초기화

---

## 남은 기술 부채 (우선순위순)

### Immediate — 다음 작업 권장

#### 1. HI-01: sendMessage/replayMessage ~80% 코드 중복
- **영향**: 버그 수정이 양쪽에 모두 필요, 유지보수 부담 최대
- **규모**: sendMessage ~408줄, replayMessage ~286줄, 공통 로직 ~500줄
- **중복 영역**: Ghost masking, glossary search, context block building, streaming callbacks, abort controller, error handling
- **해결**: `executeAIChat()` 내부 헬퍼 추출
- **참고**: `docs/CODE_REVIEW_2026-02-09.md` HI-01 항목

#### 2. MD-13: TipTapEditor Source/Target ~90% 중복
- **영향**: 에디터 수정 시 양쪽 동기화 필요
- **규모**: Source 37-210줄, Target 216-395줄. 차이는 Cmd+H, placeholder, excerptField뿐
- **해결**: `panelType` prop으로 통합

#### 3. HI-05: chatStore.ts 1,817줄 단일 파일
- **영향**: 탐색 어려움, 7개 관심사 혼재
- **해결**: Zustand slice 패턴 또는 서비스 레이어 추출
- **주의**: HI-01 해결 후 진행이 효율적 (sendMessage/replayMessage 통합 후 구조 정리)

### Short-term

#### 4. HI-04: 셀렉터 미적용 8개 파일
- App.tsx, SegmentGroupRow.tsx, SourcePanel/TargetPanel, MainLayout, Toolbar, AppSettingsModal, SettingsSidebar
- 불필요한 리렌더링 원인
- `useShallow` 또는 개별 셀렉터 적용

#### 5. 컴포저 로컬화 (계획 미구현)
- 원래 계획서(`.claude/plans/jazzy-puzzling-emerson.md`)에 포함되었으나 미구현
- `composerText`를 ChatContent 로컬 `useState`로 이동
- `appendComposerText` subscribe 패턴 + 언마운트 시 글로벌 flush
- 현재는 양쪽 사이드바가 컴포저 텍스트를 공유 (기능적으로 문제없지만 UX 개선 여지)

### Long-term (기술 부채)
- LO-01/02: 접근성 (Modal focus trap, 키보드 탐색)
- LO-03: Confluence pageCache 무한 증가
- LO-07: Rust lock boilerplate 20회 반복
- LO-14: ChatContent.tsx 816줄 모놀리스
- Review audit 보류 7건 (실무 영향 낮음)

## 핵심 결정 사항 (유지)

- **Hybrid 접근**: chatStore 구조 최소 변경 + `targetSessionId` 폴백으로 하위 호환 100% 보존
- **`currentSessionId` 유지**: 외부 "채팅에 추가" 버튼이 의존
- **스트리밍 동시 1개**: API 제약. `streamingSessionId`로 어느 패널인지 추적
- **`targetSessionId` 미지정 시 `currentSessionId` 폴백**: 기존 단일 패널 동작 완전 보존

## 핵심 파일

- `src/stores/chatStore.ts` — 채팅 상태 관리 (sendMessage, replayMessage, finalizeStreaming)
- `src/stores/chatStore.selectors.ts` — 그룹 셀렉터 (useSessionStreamingState)
- `src/components/chat/ChatContent.tsx` — 채팅 UI (effectiveSessionId, displaySession)
- `src/stores/uiStore.ts` — 사이드바 상태 (도킹 모델)
- `src/types/index.ts` — PanelType, chatPanelId 등

## 다음 세션 가이드

### 권장: HI-01 (sendMessage/replayMessage 중복 제거)

1. 두 함수를 나란히 읽고 공통 부분 식별
2. `executeAIChat(params)` 내부 헬퍼 설계:
   - 입력: session, content, priorMessages, attachments, maskSession
   - 출력: Promise<void> (스트리밍 완료까지)
   - 공통 로직: abortController, addMessage(assistant), streamAssistantReply, finalizeStreaming, error handling
3. sendMessage/replayMessage는 각자 고유 로직(사용자 메시지 추가, truncation 등)만 유지
4. `/typecheck` → `npm run test:run` → 수동 테스트

# Hand-off: Code Review 이슈 수정 작업

**작성일**: 2026-02-09
**기준 커밋**: `002d0fb` (main)
**리뷰 원본**: `docs/CODE_REVIEW_2026-02-09.md` (23개 이슈, Grade B+)

---

## 완료된 작업 (11/23)

### Commit `e45c833` — Critical/High 버그 수정
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **CR-01** DiffMark position shift | `src/editor/extensions/DiffMark.ts` | `doc.descendants()` 순회 중 삭제 → position 배열 수집 후 **역순 삭제** |
| **CR-02** Rust UTF-8 경계 패닉 | `src-tauri/src/commands/block.rs` | `is_char_boundary()` 검증 추가, 실패 시 `INVALID_POSITION` 에러 반환 |
| **HI-04** 셀렉터 없는 스토어 구독 | 8개 파일 | `useShallow` / 개별 셀렉터 적용 (App, MainLayout, Toolbar, SegmentGroupRow, SourcePanel, TargetPanel, AppSettingsModal, SettingsSidebar) |
| **HI-06** Error Boundary 없음 | `src/components/ui/ErrorBoundary.tsx` (신규) + `MainLayout.tsx` | 범용 ErrorBoundary 생성, Editor/Chat/Settings 3개 영역 래핑 |
| **HI-08** TipTapEditor double-destroy | `src/components/editor/TipTapEditor.tsx` | Source/Target 모두 수동 `editor.destroy()` useEffect 제거 (`useEditor`가 자체 처리) |
| **MD-03** pendingDiffs 직접 mutation | `src/stores/projectStore.ts` | `delete obj[key]` → `const { [key]: _, ...rest }` 구조 분해 (2곳) |
| **MD-04** 경로 탐색 보안 | `src-tauri/src/commands/attachments.rs` | `Path::file_name()`으로 파일명만 추출, `../../` 차단 |

### Commit `002d0fb` — Medium 소형 이슈
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **MD-01** MCP 도구 래핑 | `src/ai/chat.ts` | `EXTERNAL_TOOLS` 화이트리스트 → `INTERNAL_TOOLS` 블랙리스트. 동적 MCP 도구도 자동 래핑 |
| **MD-07** 매직 넘버 | `src/ai/constants.ts` (신규) + `client.ts` + `translateDocument.ts` | 토큰/컨텍스트 상수 집중화 |
| **MD-09** async IIFE 에러 | `src/stores/projectStore.ts` | `initializeProject` 전체를 외부 try/catch로 감싸 미추적 에러 방지 |
| **MD-10** uiStore 버전 | `src/stores/uiStore.ts` | `version: 1` + `migrate` 함수 추가 (기존 데이터 보존) |

---

## 남은 작업 (12/23)

### HIGH — 중형 리팩터링 (4개)

| 이슈 | 파일 | 작업량 | 설명 |
|------|------|--------|------|
| **HI-01** sendMessage/replayMessage 중복 | `chatStore.ts:622-1021, 1182-1463` | 🔴 대형 | ~500줄 공통 로직을 `executeAIChat()` 헬퍼로 추출. HI-05와 묶어서 진행 권장 |
| **HI-02** generate/stream 중복 | `chat.ts:859-957, 962-1072` | 🟡 중형 | 메시지 빌딩, 툴 스펙, 가이드 메시지 ~200줄 공통 빌더 추출 |
| **HI-03** 번역 프롬프트 중복 | `translateDocument.ts:106-308, 350-578` | 🟡 중형 | 시스템 프롬프트 구성 ~80줄, `buildTranslationPrompt()` 추출 |
| **HI-05** chatStore 관심사 혼재 | `chatStore.ts` (1,767줄) | 🔴 대형 | 7개 관심사 → slice 패턴 또는 서비스 함수 분리. HI-01과 동시 진행 |
| **HI-07** setContent undo 파괴 | `useBlockEditor.ts:155`, `TipTapEditor.tsx:169,353` | 🟢 소형 | TipTap API 조사 필요 (`editor.commands.insertContent` 또는 JSON diff) |

> **권장 순서**: HI-07 (소형) → HI-02 → HI-03 → HI-01+HI-05 (대형, 한 세션에 집중)

### MEDIUM — 남은 중형 작업 (6개)

| 이슈 | 파일 | 설명 |
|------|------|------|
| **MD-02** translatorPersona 인젝션 | `prompt.ts:127`, `translateDocument.ts:150,381` | 사용자 페르소나가 시스템 프롬프트에 직접 삽입 |
| **MD-05** SearchHighlight/ReviewHighlight 이중 순회 | `SearchHighlight.ts:53`, `ReviewHighlight.ts:25` | `buildTextWithPositions` 함수 중복 + 이중 O(n) 순회 |
| **MD-06** replaceMatch 3중 계산 | `SearchHighlight.ts:391-531` | `queueMicrotask` 제거, plugin apply 결과 재활용 |
| **MD-08** `as any` 16곳 | `chat.ts` 11곳, `translateDocument.ts` 5곳 | 타입 정의 보강 필요 |
| **MD-11** getHTML() 비교 비신뢰성 | `TipTapEditor.tsx:169,353`, `useBlockEditor.ts:155` | HTML 직렬화 차이로 오판 가능. JSON 비교 또는 content hash 도입 |
| **MD-13** Source/Target TipTapEditor 중복 | `TipTapEditor.tsx:37-210, 216-395` | ~90% 동일, `panelType` prop으로 단일 컴포넌트 통합 |

### LOW — 개선 사항 (17개, 선별 권장)

우선 처리 가치가 높은 것:
- **LO-09** Rust println! → `tracing` 크레이트 (보안, oauth.rs 25개+)
- **LO-10** TranslationBlock split 시 duplicate blockId
- **LO-03** Confluence pageCache 무한 증가 (LRU 필요)

나머지(a11y, verbose logging, array key 등)는 점진적 개선.

---

## 신규 생성된 파일

| 파일 | 용도 |
|------|------|
| `src/ai/constants.ts` | AI 토큰/컨텍스트 상수 집중화 |
| `src/components/ui/ErrorBoundary.tsx` | 범용 React Error Boundary |

---

## 주의사항

1. **HI-01 + HI-05는 반드시 함께**: chatStore 중복 제거와 관심사 분리를 따로 하면 이중 작업
2. **MD-13은 HI-07 이후에**: TipTapEditor 통합 시 setContent undo 이슈도 같이 해결
3. **테스트 현황**: 15 test files, 335 tests 전부 통과 (2026-02-09 기준)
4. **Rust 경고 2개**: `NotionClient::build_request` unused — 기존 경고, 이번 작업과 무관

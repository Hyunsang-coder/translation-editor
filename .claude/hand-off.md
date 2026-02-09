# Hand-off: Code Review 이슈 수정 작업

**작성일**: 2026-02-09
**최종 업데이트**: 2026-02-09
**기준 커밋**: `8c68b38` (main)
**리뷰 원본**: `docs/CODE_REVIEW_2026-02-09.md` (23개 CR/HI/MD + 17개 LOW)

---

## 전체 현황

```
CR+HI+MD 23건 → 해결 17건 → 미해결 6건
LOW      17건 → 해결  5건 → 미해결 12건
LO-17은 이전 커밋에서 이미 해결됨, MD-09/MD-10/MD-12는 검증 결과 수정 불필요
```

---

## 완료된 작업 (22/40)

### Commit `e45c833` — Critical/High 버그 수정
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **CR-01** DiffMark position shift | `DiffMark.ts` | position 배열 수집 후 **역순 삭제** |
| **CR-02** Rust UTF-8 경계 패닉 | `block.rs` | `is_char_boundary()` 검증 추가 |
| **HI-04** 셀렉터 없는 스토어 구독 | 8개 파일 | `useShallow` / 개별 셀렉터 적용 |
| **HI-06** Error Boundary 없음 | `ErrorBoundary.tsx` (신규) | Editor/Chat/Settings 3개 영역 래핑 |
| **HI-08** TipTapEditor double-destroy | `TipTapEditor.tsx` | 수동 destroy useEffect 제거 |
| **MD-03** pendingDiffs 직접 mutation | `projectStore.ts` | 구조 분해 패턴 (2곳) |
| **MD-04** 경로 탐색 보안 | `attachments.rs` | `Path::file_name()` 차단 |

### Commit `002d0fb` — Medium 소형 이슈
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **MD-01** MCP 도구 래핑 | `chat.ts` | `INTERNAL_TOOLS` 블랙리스트로 전환 |
| **MD-07** 매직 넘버 | `constants.ts` (신규) | 토큰/컨텍스트 상수 집중화 |

### Commits `a0e17c3`, `37ff20e`, `4825852` — 리팩토링
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **HI-02** generate/stream 중복 | `chat.ts` | 미사용 `generateAssistantReply` 제거 |
| **HI-03** 번역 프롬프트 중복 | `translateDocument.ts` | `buildTranslationSetup` 공통화 |

### Commit `8c68b38` — 프롬프트 인젝션 방어 + 안정성
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **MD-02** translatorPersona 인젝션 | `prompt.ts`, `translateDocument.ts` | `<user_persona>` XML 래핑 (4곳) |
| **LO-04** MCP 에러 타입 소실 | `McpClientManager.ts` | `error.message` + 원본 스택 보존 |
| **LO-13** ReviewPanel 매 렌더 호출 | `ReviewPanel.tsx` | `useMemo` 적용 |

### 미커밋 — Quick Win 일괄 수정 (현재 스테이징)
| 이슈 | 파일 | 수정 내용 |
|------|------|----------|
| **MD-05** buildTextWithPositions 중복 | `SearchHighlight.ts`, `ReviewHighlight.ts` | 공통 함수 export, ReviewHighlight에서 import |
| **MD-06** replaceMatch 3중 계산 | `SearchHighlight.ts` | redundant `queueMicrotask` 제거 (apply에서 동기 처리) |
| **LO-06** truncateToolOutput 중복 | `src/ai/utils.ts` (신규) | 공통 추출, 2곳에서 import |
| **LO-11** setTimeout clearTimeout 누락 | `ChatContent.tsx` | useEffect cleanup 추가 (2곳) |
| **LO-12** VisualDiffViewer 인덱스 key | `VisualDiffViewer.tsx` | 행 번호 기반 stable key |

### 검증 완료 — 수정 불필요
| 이슈 | 사유 |
|------|------|
| **MD-09** async IIFE 에러 | 이미 try-catch + `set({ error })` 반영됨 |
| **MD-10** uiStore 버전 | 이미 `version: 1` + `migrate` 존재 |
| **MD-12** ReviewHighlight Zustand 호출 | `getState()` 경량 동기 호출, docChanged 시에만 비용 발생 |
| **LO-17** console.log verbose | 이전 커밋에서 이미 제거됨 |

---

## 남은 작업 (6 CR/HI/MD + 12 LOW)

### HIGH — 대규모 리팩토링 (3개)

| 이슈 | 파일 | 난이도 | 설명 |
|------|------|--------|------|
| **HI-07** setContent undo 파괴 | `TipTapEditor.tsx`, `useBlockEditor.ts` | 중 | 번역 적용 후 Ctrl+Z 불가. TipTap API 조사 필요 |
| **HI-01** sendMessage/replayMessage 중복 | `chatStore.ts` | **높** | ~500줄 공통 → `executeAIChat()` 추출. HI-05와 묶어서 |
| **HI-05** chatStore 관심사 혼재 | `chatStore.ts` (1,767줄) | **높** | 7개 관심사 slice 분리. HI-01 선행 필요 |

### MEDIUM — 코드 품질 (3개)

| 이슈 | 파일 | 난이도 | 설명 |
|------|------|--------|------|
| **MD-08** `as any` 16곳 | `chat.ts` 11, `translateDocument.ts` 5 | 중 | 타입 정의 보강 필요 |
| **MD-11** getHTML() 비교 비신뢰성 | `TipTapEditor.tsx`, `useBlockEditor.ts` | 중 | HI-07과 연관 세트 |
| **MD-13** Source/Target TipTapEditor 중복 | `TipTapEditor.tsx` | 중 | `panelType` prop 통합. HI-07 이후 진행 |

### LOW — 개선 사항 (12개)

| 이슈 | 난이도 | 설명 |
|------|--------|------|
| **LO-01** 모달 포커스 트랩 | 중 | a11y: `role="dialog"`, 포커스 트래핑 |
| **LO-02** 탭 키보드 내비게이션 | 중 | a11y: `role="tab"`, `aria-selected` |
| **LO-03** Confluence pageCache 무한 증가 | 낮 | LRU 캐시 또는 최대 크기 제한 |
| **LO-05** Rust 커맨드 에러 타입 불일치 | 중 | `CommandResult<T>` 통일 |
| **LO-07** Rust lock 보일러플레이트 | 낮 | `acquire_db()` 헬퍼 추출 |
| **LO-08** history.rs 미구현 스텁 | 낮 | 제거 또는 구현 |
| **LO-09** Rust println! 25곳 | 낮 | `tracing` 크레이트 도입 (보안) |
| **LO-10** TranslationBlock split 중복 blockId | 중 | 새 ID 할당 로직 |
| **LO-14** ChatContent 816줄 모놀리식 | 높 | 컴포넌트 분리 |
| **LO-15** buildAlignedChunks 2회 호출 | 낮 | 캐싱 |
| **LO-16** Partial response 표시 없이 반환 | 낮 | partial 플래그 |

---

## 신규 생성된 파일

| 파일 | 용도 |
|------|------|
| `src/ai/constants.ts` | AI 토큰/컨텍스트 상수 집중화 |
| `src/ai/utils.ts` | `truncateToolOutput` 공통 유틸리티 |
| `src/components/ui/ErrorBoundary.tsx` | 범용 React Error Boundary |

---

## 권장 진행 순서

1. **HI-07 + MD-11** (연관 세트) → setContent undo + getHTML 비교 개선
2. **MD-13** → TipTapEditor 통합 (HI-07 이후)
3. **MD-08** → `as any` 타입 정의 (독립 작업)
4. **HI-01 + HI-05** → chatStore 대규모 리팩토링 (한 세션에 집중)

## 주의사항

1. **HI-01 + HI-05는 반드시 함께**: chatStore 중복 제거와 관심사 분리를 따로 하면 이중 작업
2. **MD-13은 HI-07 이후에**: TipTapEditor 통합 시 setContent undo 이슈도 같이 해결
3. **테스트 현황**: 15 test files, 335 tests 전부 통과 (2026-02-09 기준)
4. **Rust 경고 2개**: `NotionClient::build_request` unused — 기존 경고, 이번 작업과 무관

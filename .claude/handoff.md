# Session Handoff

> Generated: 2026-07-28 16:15
> Branch: `feat/alignment-view` (main보다 1커밋 앞, **아직 push 안 함**)

## 작업 요약

에디터 UI 개선 **Phase 1–4를 main에 병합**(`4f2cd5b`, `--no-ff`)하고, 병합된 `feat/editor-ui-redesign` 브랜치를 로컬·원격에서 정리했다. 이어서 새 브랜치 `feat/alignment-view`에서 **Phase 4.5 정렬 검사 뷰의 1단계(정렬 알고리즘 `alignUnits.ts` + 테스트 8케이스)를 완료**했다(`2c9a901`). 스펙 §5가 "1단계에서 멈추고 테스트를 확인하라"고 지시하므로 여기서 끊었다.

**Phase 4-3(세그먼트 인스펙터)은 구현하지 않고 폐기했다** — 근거는 아래 「핵심 결정 사항」.

## 현재 상태

**작업 트리 clean** (staged/unstaged/untracked 없음).

검증 통과 (병합 시점 + 1단계 후 재확인):
- `npx tsc --noEmit` — clean
- `npm run test:run` — 99파일 / 1148 pass, 8 skip (병합 전 98파일 1140 → +1파일 +8건, 무회귀)
- `npm run test:e2e:web` — 27 pass (병합 전 확인)
- `cd src-tauri && cargo test` — 45 pass

### 커밋 이력 (이번 세션)

| 커밋 | 요약 |
|------|------|
| `2c9a901` | feat(align): Phase 4.5 1단계 — 문단 정렬 알고리즘 (LCS + 테스트 8케이스) |
| `4f2cd5b` | merge: 에디터 UI 개선 Phase 1–4 (`--no-ff`, main에 푸시 완료) |

부수 정리: untracked `Translation-editor UI 개선 방향.zip` 삭제(10개 파일 전부 `design_handoff_oddeyes_editor_ui/`로 커밋된 것과 일치 확인 후), `feat/editor-ui-redesign` 로컬·원격 브랜치 및 잔여 추적 설정 제거.

## 미완료 작업

Phase 4.5 스펙 §5의 8단계 중 1단계만 끝났다. `design_handoff_oddeyes_editor_ui/PHASE_4_5_alignment_view.md`가 각 단계의 완성 상태를 정의한다.

- [ ] **2단계** — `uiStore`에 상태 2개(`editorViewMode: 'document' | 'alignment'` 기본 `'document'`, `activeAlignmentUnitId: string | null`) + 모드 토글 UI. `editorViewMode`만 `partialize`에 추가(§3). 산출물: 토글하면 빈 화면이 뜨는 상태
- [ ] **3단계** — `AlignmentView.tsx` + `AlignmentRow.tsx`, 정상 쌍만 렌더 (§4.2–4.3)
- [ ] **4단계** — 불일치 구간 배너 + 빈 셀 플레이스홀더 (amber 계열, CSS 변수로 승격하지 않음)
- [ ] **5단계** — 행 클릭 → 문서 보기 점프 (§4.4의 `jumpToUnit` 코드 그대로, `scrollIntoView` 금지)
- [ ] **6단계** — `useAlignmentAnnotations.ts` 이슈·코멘트 배지 (§4.5)
- [ ] **7단계** — 하단 정렬 요약 + `정렬 리포트` JSONL 내보내기 (§4.6, `src/quality/`의 `saveQualityJsonl` 패턴)
- [ ] **8단계** — i18n 정리, 하드코딩 한국어 0개 (`ko.json`/`en.json` 양쪽)
- [ ] `feat/alignment-view` push (아직 원격에 없음)

이후: Phase 5(영속 정렬, 4–6주)는 **7단계의 정렬 리포트 데이터를 보고 판단**한다. `ratio`가 여러 프로젝트에서 0.95 이상이면 불필요, 0.7 근처면 착수 가치 있음.

## 핵심 결정 사항

- **Phase 4-3(세그먼트 인스펙터) 폐기**: 핸드오프 README §4-3이 전제한 `segmentGroupId` 경로가 성립하지 않는다. ① 에디터 스키마에 그 attr이 없다 — `TranslationUnitId.ts`의 `addGlobalAttributes()`가 등록하는 건 `translationUnitId` 하나뿐이라, 문서가 지시한 `resolved.node(depth).attrs?.segmentGroupId` 추출은 항상 `undefined`이고 폴백 `inferSegmentGroupIdForSelection`은 커서만 놓인 상태(선택 텍스트 `''`)에선 못 쓴다. ② `projectStore.addSegment()`는 호출부가 0곳이라 `project.segments`는 생성 시 2개에서 안 늘고, 저장 시 역투영(`applySourceFallback`)이 문서 전체를 그 고정 블록들에 문자 오프셋으로 욱여넣는다(길이 delta는 마지막 블록이 흡수). ③ 결정적으로 `PHASE_4_5_alignment_view.md` §0-1이 이 모델을 "죽은 모델"로 규정하고 **`segmentGroupId` 참조 신규 코드 0줄**을 완료 기준(§6)으로 삼는다 — 번들 내부가 모순이며 4.5가 §4-3을 대체한다. (대안: `translationUnitId`를 키로 재설계 → 1–2일이지만 4.5와 작업이 중복돼 기각)
- **`--no-ff` 병합**: 저장소 히스토리가 feature 브랜치에 머지 커밋을 쓰는 관례(`64c1ae2`, `6fdb660` 등)를 따랐다. 페이즈 경계가 히스토리에 남는다.
- **`totalUnits`를 빈 문단 제외 후로 계산**: 스펙은 `max(source.length, target.length)`라고만 적었으나, 원시 개수로 하면 스펙 §2 테스트 표 케이스 5(한쪽에만 빈 문단 3개 → `ratio` 1)와 모순된다.
- **양쪽 다 빈 문서일 때 `ratio` = 1**: 0으로 나누기 처리. 어긋날 것이 없는 상태라 0%로 표시하면 빈 프로젝트에서 거짓 경고가 된다. 코드 주석에 근거 있음.
- **`TranslationUnit`에 `level?: number` 추가**: 스펙 §2·§4가 명시적으로 허용한 범위. h2↔h3 오매칭 방지용이며 익스텐션 동작·`reattachTranslationUnitIds`(type·path만 비교)에는 영향 없음.

## 주의사항

- **`npm run lint` 스크립트가 없다.** Phase 4.5 스펙 §5가 각 단계마다 `npm run lint && npm run test:run`을 요구하지만 lint는 실패한다. 실제 게이트는 `npx tsc --noEmit` + `npm run test:run` + `npm run test:e2e:web`.
- **샌드박스가 포트 리슨을 막는다.** `npm run test:e2e:web`이 `EPERM: listen 127.0.0.1:1421`로 죽으면 샌드박스 문제다 — sandbox를 끄고 재실행할 것. `cargo test`는 `export TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)"` 필요(기본 `TMPDIR`이 막혀 링크 단계 EPERM).
- **`tauri:dev`와 `test:e2e:web`은 동시 실행 불가** — 둘 다 포트 1421. `lsof -ti:1421`로 확인.
- **네이티브 창 스크린샷 불가**(화면 기록 권한 없음). UI 검증은 Playwright + `e2e/tauri-mock.ts`로 임시 spec을 만들어 캡처하고, 실물 확인은 사용자에게 부탁할 것.
- **2단계 이후 함정** (스펙 §7, 특히 세 번째가 치명적):
  - 정렬 뷰로 전환할 때 **`PanelGroup`을 언마운트하면 안 된다.** 에디터 인스턴스가 파괴되고 `editorStore`가 비어 점프·검수 적용이 깨진다. `display:none`으로 숨기거나 오버레이로 얹을 것.
  - 정렬 계산을 `onUpdate`에 걸지 말 것 — 문서 리비전 해시 변화 + 300ms 디바운스만.
  - `AlignmentView` 안에서 TipTap 에디터를 만들지 말 것(읽기 전용 렌더).
  - `degraded === true`를 조용히 넘기지 말 것 — 잘못된 짝을 믿게 된다.
  - 이슈 매핑이 여러 유닛에 걸리면 매핑하지 않는다.
- `git config` 쓰기가 샌드박스에서 `could not lock config file`로 실패할 수 있다(브랜치 삭제 시 추적 설정이 남는다). sandbox를 끄고 `git config --remove-section`으로 정리.

## 핵심 파일

- `design_handoff_oddeyes_editor_ui/PHASE_4_5_alignment_view.md` — **1차 스펙.** §2 알고리즘(완료), §3 상태, §4 컴포넌트, §5 구현 순서, §6 완료 기준, §7 함정
- `src/utils/alignUnits.ts` — 정렬 알고리즘(신규, 완료). LCS + 250k 셀 상한 순번 폴백, `AlignOp`/`AlignResult` 타입
- `src/utils/alignUnits.test.ts` — 스펙 §2 표의 8케이스(신규, 전부 통과)
- `src/editor/extensions/TranslationUnitId.ts` — `collectTranslationUnits`(정렬 입력), `TranslationUnit.level` 추가됨
- `src/components/editor/EditorCanvasTipTap.tsx` — 2단계에서 `editorViewMode` 분기를 넣을 곳(언마운트 금지)
- `src/stores/uiStore.ts` — 2단계에서 상태 2개 + `partialize` 추가

## 다음 세션 가이드

1. `design_handoff_oddeyes_editor_ui/PHASE_4_5_alignment_view.md`의 **§3(상태) → §4.1(모드 토글) → §7(함정)** 순으로 읽는다. §0은 이미 검증돼 있으니(위 「핵심 결정 사항」) 다시 파지 않아도 된다.
2. **2단계 착수**: `uiStore` 상태 2개 + `partialize`, `EditorCanvasTipTap`에 모드 분기. 이때 `PanelGroup` 언마운트 금지 규칙을 먼저 정해놓고 시작할 것 — 나중에 고치면 `editorStore` 관련 버그를 다시 만든다.
3. 각 단계 후 `npx tsc --noEmit` + `npm run test:run`. UI가 붙는 3단계 이후에는 `npm run test:e2e:web`(27건)도 돌려 기존 E2E 회귀를 본다.
4. `feat/alignment-view`는 아직 원격에 없다. 2단계쯤에서 한 번 push해 두는 게 좋다.

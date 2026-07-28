# Session Handoff

> Generated: 2026-07-28 17:29
> Branch: `main` (origin/main과 동기, 작업 트리 clean)

## 작업 요약

**Phase 4.5 정렬 검사 뷰(Alignment Inspection View)를 2–8단계까지 전부 구현하고 main에 병합·푸시했다**(`3438acf`, `--no-ff`). 원문↔번역문 문단을 나란히 놓는 읽기 전용 대조 뷰로, 정렬을 저장하지 않고 뷰를 열 때마다 LCS로 계산하며 짝이 안 맞는 구간은 고치지 않고 불일치로 표시한다. `feat/alignment-view` 브랜치는 병합 후 로컬·원격 모두 삭제했다.

## 현재 상태

작업 트리 **clean**. 브랜치는 `main` 하나(로컬), 원격은 `origin/main`.

병합 후 main에서 게이트 4종 전부 통과:
- `npx tsc --noEmit` — clean
- `npm run test:run` — 100파일 / **1157 pass**, 8 skip
- `npm run test:e2e:web` — **34 pass** (정렬 뷰 7건 포함)
- `cd src-tauri && cargo test` — **45 pass**

### 커밋 이력 (이번 세션)

| 커밋 | 요약 |
|------|------|
| `3438acf` | merge: Phase 4.5 정렬 검사 뷰 (`--no-ff`, main 푸시 완료) |
| `f1f1948` | fix(chat): 문서 조회 도구 출력에서 이미지 제거 — **사용자가 직접 커밋** |
| `ba59723` | 8단계 — i18n 정리(한국어 폴백 제거, 27키 ko/en 전수 확인) |
| `a2015af` | 7단계 — 정렬 요약 + 정렬 리포트 JSONL 내보내기 |
| `ec94269` | 6단계 — 이슈·코멘트 배지(`useAlignmentAnnotations`) |
| `4ca58e5` | 5단계 — 행/배너에서 문서 보기로 점프 |
| `efe715c` | 4단계 — 불일치 구간 배너 + 빈 셀 플레이스홀더 |
| `f22961d` | 3단계 — 정렬 테이블(정상 쌍), `detectLanguage.ts` 이관 |
| `4d2fe61` | 2단계 — `uiStore` 상태 2개 + 보기 모드 토글 |
| `d9449b8` | docs: 이전 핸드오프 갱신 |
| `2c9a901` | 1단계 — 문단 정렬 알고리즘(이전 세션) |

신규 파일: `src/utils/alignUnits.ts`(+test), `src/utils/detectLanguage.ts`, `src/utils/alignmentReport.ts`, `src/components/editor/AlignmentView.tsx`, `AlignmentRow.tsx`, `useAlignmentAnnotations.ts`(+test), `e2e/alignment-view.spec.ts`.

## 미완료 작업

- [ ] **실물 앱 육안 확인** — 정렬 뷰는 Playwright + `e2e/tauri-mock.ts`로만 검증했다(스크린샷 확인 완료). 네이티브 창 캡처 권한이 없어 Tauri 실행 확인은 사용자만 가능. `npm run tauri:dev`
- [ ] `.claude/CLAUDE.md`의 **Recent Updates에 Phase 4.5 항목 추가** (이번 세션에서 안 함)
- [ ] `design_handoff_oddeyes_editor_ui/PHASE_4_5_alignment_view.md` §6 완료 기준 체크박스 갱신(선택)
- [ ] **Phase 5(영속 정렬, 4–6주) 착수 여부 판단** — 실사용 프로젝트에서 `정렬 리포트`를 몇 번 내보내 `ratio`를 볼 것. 0.95 이상이면 불필요, 0.7 근처면 착수 가치 있음. 리포트는 자동 수집이 아니라 버튼을 눌러야 나온다
- [ ] 릴리스에 포함하려면 버전 bump 4파일 동기화(`package.json`/`Cargo.toml`/`Cargo.lock`/`tauri.conf.json`)

## 핵심 결정 사항

- **모드 전환은 `visibility:hidden` 오버레이**: 스펙 §7이 `PanelGroup` 언마운트를 금지(에디터 파괴 → `editorStore` 비어 점프·검수 적용이 깨짐)하며 "display:none 또는 오버레이"를 제시했으나, `display:none`은 재표시 시 `scrollTop`이 0으로 초기화돼 "커서·스크롤 보존" 완료 기준을 깬다. `visibility:hidden`은 레이아웃 박스를 유지해 스크롤이 남고, 숨은 요소는 포커스를 받을 수 없어 읽기 전용도 함께 강제된다. (대안: `inert` 속성 → React 18이라 타입/지원 문제로 기각)
- **재계산은 리비전 해시 없이 300ms 디바운스만**: 스펙 §3의 `hashContent(tipTapJsonToMarkdownForTranslation(json))` 비교는 변환+해시 비용이 `alignUnits` 자체보다 싸지 않다. 뷰가 열린 동안 문서가 바뀌는 경로는 번역·검수 적용 같은 단발 이벤트뿐. `onUpdate`에는 걸지 않는다(§7 준수).
- **행 번호는 렌더 순번이 아니라 `ops` 인덱스(1-based)**: 불일치 행이 끼어도 번호가 밀리지 않는다.
- **불일치 행은 선택 불가**: 활성 유닛 id는 target 기준인데 한쪽만 있는 행은 그 계약을 못 지킨다. 구간 이동은 배너의 `이 구간 문서 보기로 열기 ↗` 버튼이 맡는다.
- **이슈 매핑은 텍스트 포함 검사, 중복 매치는 포기**: `ReviewIssue.segmentGroupId`는 `project.segments`가 죽은 모델이라 신뢰할 수 없다. 여러 유닛에 걸리면 매핑하지 않고 하단 `위치를 특정하지 못한 이슈 N건`으로 모은다(그 수치 자체가 정렬 품질 지표).
- **`detectSourceLanguage`를 `src/utils/detectLanguage.ts`로 이관**(§4.2 지시): 시그니처만 `AlignedSegment[]` → `string`으로 바꾸고 판정 로직·반환 문자열(`'Korean'`/`'원문'` 등)은 그대로 — 검수 프롬프트의 `sourceLanguage`로 들어가는 값이라 건드리면 AI 동작이 바뀐다.

## 주의사항

- **`npm run lint` 스크립트가 없다.** 실제 게이트는 `npx tsc --noEmit` + `npm run test:run` + `npm run test:e2e:web` + `cargo test`.
- **샌드박스에서 막히는 것들** — Playwright 웹 서버(`EPERM: listen 127.0.0.1:1421`), `cargo test`(tempdir `Operation not permitted`), `git config` 쓰기(브랜치 upstream 설정/삭제). 전부 sandbox를 끄고 재실행하면 통과한다. `cargo test`는 `export TMPDIR="$(getconf DARWIN_USER_TEMP_DIR)"`도 필요.
- **`tauri:dev`와 `test:e2e:web`은 포트 1421 충돌**로 동시 실행 불가.
- **네이티브 창 스크린샷 불가**(화면 기록 권한 없음). UI 확인은 `e2e/`에 임시 spec을 만들어 `page.screenshot()`으로 캡처하고 끝나면 지울 것.
- **`git merge -F -`는 실패한다**(`'-' 파일을 읽을 수 없습니다`). 긴 머지 메시지는 파일로 써서 `-F <path>`로 넘길 것.
- **LCS는 시그니처(`type:depth:level`)만 본다** — 언어가 달라 텍스트 비교가 무의미하기 때문. 그래서 문단이 하나 어긋나면 그 뒤 짝이 한 칸씩 밀린 상태로 "정상 쌍"이 될 수 있다(스펙이 의도한 한계). 1:N/N:1은 다루지 않는다.
- **E2E 내보내기 목**: `e2e/tauri-mock.ts`에 `plugin:dialog|save`와 `write_text_file` 핸들러를 추가했고, 쓰인 내용은 `window.__MOCK_WRITTEN_FILES__`에 쌓인다. 다른 내보내기 기능 테스트에도 재사용 가능.

## 핵심 파일

- `design_handoff_oddeyes_editor_ui/PHASE_4_5_alignment_view.md` — 이번 작업의 1차 스펙(§6 완료 기준, §7 함정)
- `src/components/editor/AlignmentView.tsx` — 뷰 전체(헤더·불일치 구간 그룹핑·점프·요약·리포트)
- `src/components/editor/AlignmentRow.tsx` — 행 하나(정상 쌍/1:0/0:1, 배지, `이 문단 편집 ↗`)
- `src/components/editor/useAlignmentAnnotations.ts` — 이슈·코멘트 → 유닛 매핑(+ 단위 테스트)
- `src/components/editor/EditorCanvasTipTap.tsx` — 상태 스트립의 모드 토글, `visibility:hidden` 분기(언마운트 금지)
- `src/utils/alignUnits.ts` — LCS 정렬 알고리즘(250k 셀 상한 → 순번 폴백 `degraded`)

## 다음 세션 가이드

1. 새 기능을 시작하기 전에 **실물 앱에서 정렬 뷰를 한 번 확인**할 것(`npm run tauri:dev` → 프로젝트 열고 상단 `정렬 검사`). 특히 ① 500문단급 실제 문서에서의 체감 속도 ② 검수 실행 후 배지가 붙는지 ③ `정렬 리포트` 저장 다이얼로그(Tauri 경로는 E2E에서 목으로만 검증됨).
2. 문서 갱신이 필요하면 `.claude/CLAUDE.md` Recent Updates에 Phase 4.5 항목 추가(2026-07-28 자).
3. Phase 5는 **데이터를 먼저 모으고** 판단한다 — 리포트 `ratio`가 근거다.
4. main에서 바로 작업하지 말고 새 feature 브랜치를 파서 시작할 것(저장소 관례: 페이즈 단위 `--no-ff` 머지).

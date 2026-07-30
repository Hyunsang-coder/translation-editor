# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**OddEyes.ai** - AI-powered translation editor built with Tauri (Rust) + React (TypeScript).
- Notion-style dual editor (TipTap) for Source/Target documents
- AI chat with LangChain (OpenAI + Anthropic)
- MCP integration (Confluence, Web Search)
- History snapshot workflow (save/compare/restore/rename, including snapshot↔snapshot diff)

**Core Philosophy**: Translator-led workflow. AI assists only when requested.

## Quick Reference

### Commands
```bash
npm install              # Install dependencies
npm run tauri:dev        # Dev server (frontend + Tauri)
npm run tauri:build      # Build release app
npx tsc --noEmit         # TypeScript type check
npm test                 # Vitest watch mode
npm run test:run         # Single test run
npm run test:e2e:web     # Playwright web E2E
npm run test:ci:local    # CI verify equivalent (typecheck+unit+web e2e+cargo test)
npm run test:tauri       # Full pre-deploy gate (typecheck+unit+e2e+rust+release)
npm run test:e2e         # Tauri smoke test (Playwright)
npm run tauri-testing-mcp:build  # Build MCP bridge server
npm run tauri-testing-mcp:start  # Start MCP bridge server (stdio)
cd src-tauri && cargo test  # Rust tests only
```

### Dev Environment Setup
```bash
# Keychain 암호 프롬프트 우회 (.gitignore 포함, 한 번만 설정)
# 기존 vault 호환: security find-generic-password -s "com.ite.app" -a "ite:master_key_v1" -w
# 새 환경: 아무 문자열 가능 (SHA-256 해싱)
echo 'ITE_DEV_MASTER_KEY=mypassword' > .env.local

# (선택) 테스트(vitest)에서만 API 키 fallback 사용
# 런타임 앱(Tauri)에서는 사용되지 않으며, 앱 설정/OS 보안저장소 키가 우선입니다.
echo 'OPENAI_API_KEY=...' >> .env.local
echo 'ANTHROPIC_API_KEY=...' >> .env.local
```

주의:
- `.env.local`은 로컬 전용 파일입니다. 실제 키를 저장소에 커밋하지 마세요.
- 테스트가 아닌 실제 앱 실행에서는 Settings에서 입력한 API 키(secure store)가 사용됩니다.

### Key Directories
```
src/ai/           # AI integration (chat.ts, translateDocument.ts, review/, modelCallOptions.ts, tools/)
src/editor/       # TipTap extensions
src/stores/       # Zustand stores (chatStore: 7 슬라이스)
src/components/   # React components
src/components/history/  # History snapshot UI (timeline/compare/restore/rename)
src-tauri/src/    # Rust backend (commands/, mcp/)
src/desktop/      # Claude Desktop bridge (oddeyesAppBridge.ts, translationPreviewActions.ts)
crates/tauri-plugin-testing/  # Tauri runtime testing bridge plugin
tauri-testing-mcp/            # MCP server for runtime control tools (dom/tauri/window/app)
oddeyes-desktop-mcp/          # Claude Desktop MCP extension (.mcpb bundle)
```

### Version Files (Keep in Sync)
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (Cargo.toml 변경 시 `cargo check`로 자동 갱신)
- `src-tauri/tauri.conf.json`

## Documentation Structure

This `.claude/` directory contains:
- `architecture.md` - Tech stack, design decisions, security
- `patterns.md` - AI/Editor/MCP implementation patterns
- `gotchas.md` - Critical implementation warnings (150+ items)
- `review-audit.md` - Review feature code audit (13 issues, 10 strengths)
- `testing.md` - Testing, debugging, file organization

**결정의 근거는 `/docs/adr/`** ([README](../docs/adr/README.md)). 아래 "Recent Updates"는 현재 코드 상태의 요약이고, ADR은 **왜 그렇게 됐고 무엇을 버렸는지**를 담습니다. 둘이 어긋나면 근거는 ADR이 진실입니다.
되돌리기 비싼 결정(스키마 변경, MCP breaking, 기능 폐기, 대안을 버린 선택)을 할 때는 ADR을 함께 씁니다 — 규칙은 `docs/adr/README.md`.

## Core Principles

1. **No Auto-Apply**: AI never modifies documents without user confirmation ([ADR-0003](../docs/adr/0003-no-auto-apply-preview-first.md))
2. **Preview-First**: Translation results shown in modal before applying ([ADR-0003](../docs/adr/0003-no-auto-apply-preview-first.md))
3. **TipTap JSON is Canonical**: Never bypass JSON format for document storage ([ADR-0002](../docs/adr/0002-tiptap-json-as-canonical-format.md))
4. **Markdown for AI**: Translation uses Markdown as intermediate format ([ADR-0002](../docs/adr/0002-tiptap-json-as-canonical-format.md))

## Recent Updates (2026-07-30)

- **Notion 연동 제거** ([ADR-0011](../docs/adr/0011-remove-notion-integration.md)): 한 번도 쓰지 않은 기능이고, 조사해보니 **구현이 두 벌인데 한 벌은 이미 죽어 있었다**. ① REST 경로(`src-tauri/src/notion/` + `commands/notion.rs` + `notionTools.ts`)가 프런트가 쓰는 유일한 경로였고, ② MCP/OAuth 경로(`mcp/notion_client.rs`·`notion_oauth.rs`·`McpServerId::Notion`, 616 LOC)는 `mcp_set_notion_config`를 e2e 목만 부르는 잔해였다 — REST로 갈아탄 흔적이 `McpClientManager`의 "Notion: REST API 직접 호출 (MCP 대신)" 주석에 남아 있었다. 둘 다 제거하고 `McpServerId`는 `Atlassian` 단일 variant로 축소.
  - **tool guide가 바인딩되지 않는 도구를 쓰라고 지시하고 있었다**: `chat.ts`가 "notion_search로 검색 후 `notion_get_page`로 조회"를 주입하는데 `notion_get_page`는 `CHAT_TOOL_REGISTRY`에 없어 절대 바인딩되지 않는다(`buildToolSpecs`가 모든 후보를 registry 파생 `allowedNames`로 필터). 이 발견이 제거를 촉발했다.
  - **vault 키 매핑은 남겼다** — `secrets/manager.rs`의 `notion:integration_token` 매핑은 오래된 vault를 읽는 마이그레이션 표라 지우면 기존 저장소 호환이 깨진다. **저장된 토큰도 vault에 남는다**(읽는 코드가 없어 무해하지만 자동 삭제되지 않음).
  - **함께 제거**: `McpClientManager.getAllTools()`(Atlassian+Notion 병합이 유일한 존재 이유, 호출자 0), `NotionTokenDialog`, 채팅 검색 토글, i18n 양쪽, e2e 목 8개, `user-story.spec.ts` Phase 2, **데모 4번(`Connector.webm`)** — Atlassian은 OAuth 리다이렉트라 같은 흐름으로 대체 불가이고 Confluence는 데모 5번이 이미 다룬다.
- **`prompt.ts`의 `[Add to Context]` 안내 제거**: 질문 모드 프롬프트가 D2에서 없어진 버튼을 누르라고 안내하고 있었다. `inferSuggestionFromAssistantText`는 rule만 추론하므로 버튼이 뜰 수 없어, 모델이 이 문구를 출력하면 사용자에게 **누를 수 없는 버튼**을 안내하는 셈이었다. `[Add to Rules]`는 `translationRules`가 실제로 주입되고 폴백 추론도 살아 있어 유지.
  - **`src/ai/README.md`는 아직 드리프트 상태다** — `runToolCallingLoop`(현재는 `chatAgent/runAgentStream.ts`의 `runChatAgentStream`), `suggest_project_context`, 도구 목록 4개(실제 15개), "채팅에서 번역 생성 금지"(프롬프트는 허용) 등. `.claude/patterns.md:227`·`gotchas.md:229`에도 `runToolCallingLoop`가 남아 있다.
- **선택 영역을 문단·표를 가로질러 채팅에 넣을 수 있다** ([ADR-0010](../docs/adr/0010-selection-apply-single-range-only.md)): 여러 문단을 드래그하면 "한 문단 안의 텍스트만 선택해주세요."로 막혔다. 제약은 `normalizeSelectionAnchorRange`의 `sameParent` 가드 하나이고 계획 문서 §7.4의 MVP 한계였다. 채팅 컨텍스트는 `from/to`를 안 쓰고(`ChatSelectionSnapshot`) 선택 도구도 유닛 배열을 다루므로 멀티블록에 이미 안전했다 — 진짜로 막히는 곳은 적용 경로 하나다.
  - **`sameParent` → 클램핑**: 범위가 덮는 첫/마지막 textblock 내부로 좁힌다(`textblockSpan`). Cmd+A는 `AllSelection`이고 `from=0`의 부모가 doc 노드라 **`sameParent`만 풀어도 여전히 막혔다**. 트림으로 앞뒤 블록의 기여분이 사라질 수 있어 `blockCount`를 다시 센다. 단일 블록 무회귀는 전체 `(from,to)` 조합 완전탐색으로 확인(일치 873, 신규 허용 715, 회귀 0).
  - **앵커 텍스트에 블록 구분자 `'\n'`(`readAnchorText`)**: 구분자가 없으면 문단 병합이 텍스트를 바꾸지 않아(`One`+`Two` → `OneTwo`) 구조 변경을 stale로 못 잡았다. `SelectionContext.text`와 값이 일치하게 돼 proposal 검증(`ChatContent`)이 구조적으로 옳아진다 — 단일 블록에서는 두 값이 문자 단위로 동일하다.
  - **표 다중 셀 선택 지원 + 코멘트·복사 버그 수정**: `CellSelection`은 셀마다 range가 하나씩이고 `selection.from/to`는 **head 셀만** 가리킨다(문서 순서도 아님). 앵커를 `ranges[]`로 확장해 데코레이션·매핑·stale 판정이 범위별로 돈다. `anchorId`는 단수를 유지해 호출부 22곳은 무변경. `buildSelectionBubble`이 ranges를 만들므로 코멘트(범위마다 마크)·복사·채팅이 같은 값을 본다 — 기존에는 span 하나에 칠해 고르지 않은 셀까지 마킹됐다. **ranges의 min/max span은 쓸 수 없다**: 3열 표에서 1·3열만 고르면 사이의 2열이 들어온다.
  - **적용 경로는 단일 범위만**: `getSingleAnchorRange`가 null이면 거부. 재번역은 생성 전에 막고(API 호출 낭비 방지) `propose_selection_edit`은 도구 목록에서 뺀다. 셀 **안쪽** 선택은 단일 범위라 재번역까지 그대로 된다.
  - **상한은 멀티블록에만 4,000자** — 단일 문단에 걸면 긴 문단 재번역이 오늘보다 나빠지는 회귀다. 선택 본문은 user 메시지에 그대로 실린다(`prompt.ts`의 SELECTION 블록).
  - **버린 대안**: 블록 스냅 + 유닛 단위 교체는 모델의 유닛 개수 일치율 측정이 선행 조건이라 미룸(ADR-0010 참조).
- **선택 문맥 조회 창 확대 + Source 선택 대조 허용**: 모델이 볼 수 있는 범위가 실사용에 비해 좁았다.
  - **앞뒤 문맥 2 → 8개, 생략 시 0 → 2개**: 단위는 문단·제목·표 셀이라 2개로는 표 한 줄도 못 채운다. 기본값 0은 더 나빴다 — 인자 없이 부르면 선택 영역만 돌아와 **도구 스텝만 낭비**했다. 함수 시그니처의 `= 0`도 제거해야 한다(박아두면 "생략"과 "0개 요청"이 구분되지 않아 `clampUnits`의 기본값이 죽는다). zod 스키마의 `max`도 함께 올릴 것 — 스키마가 먼저 거절한다.
  - **출력 상한**: `get_selection_surroundings` 4,000 → 8,000자, `get_aligned_selection_context` 6,000 → 16,000자. 전자는 **문서 전체 조회(8,000)보다 좁았다** — 프롬프트가 전체 조회 대신 이 도구를 쓰라고 유도하는데 창이 더 좁으면 앞뒤가 맞지 않는다. 후자는 같은 구간을 두 언어로 담는다. context window는 180k~360k라 기존 값이 근거 없이 보수적이었다.
  - **Source 선택도 `get_aligned_selection_context`**: 원문을 고르고 "이 문장 번역이 어떻게 됐어?"를 물을 수 있어야 한다. `collectAlignedSourceUnits`는 id가 일치하는 유닛을 고르는 함수라 문서 인자를 바꾸면 그대로 반대 방향이 된다 — `panel` 파라미터로 확장 기준 문서를 고르고 결과의 source/target 라벨만 맞춘다. `get_target_document`는 여전히 안 준다(대조는 선택 구간으로 한정).
  - **표 셀이 두 칸으로 세어지던 문제**: `tableCell`과 그 안의 `paragraph`가 **둘 다** 번역 단위라 `selected: ["셀1","셀1"]`, 표 뒤 문단의 `before: ["셀2","셀2"]`가 됐다 — 앞뒤 8칸이 표에서 실질 4칸. `dropDuplicatedContainers`가 조상 단위를 자손과 텍스트까지 같을 때만 버린다. **단위 정의는 안 건드렸다** — `collectTranslationUnits`를 정렬 검사 뷰가 같이 쓰므로 짝 맞추기 결과가 함께 바뀐다.
  - **떨어져 있는 선택의 주변 조회**: `selectedUnitRange`의 최소~최대 인덱스 구간을 `selected`로 그대로 쓰면 표 1·3열 선택에서 2열이 "선택됨"으로 전달됐다. 구간은 before/after 계산에만 쓴다.
- **번역 응답 파싱에서 원문 유실 수정 (`markdownConverter.ts`)**: 표로 시작하는 문서를 번역하면 표 사이의 문단·리스트가 통째로 사라지고 링크가 소실됐다. 모델을 바꿔도 재현되던 결정적 버그이며, 원인은 전부 `parseTranslationResponseToTipTap`의 HTML 경로 하나였다. LLM 입력(원문 직렬화)은 온전했다.
  - **라우팅 오판이 근본 원인**: `looksLikeBlockHtml`이 **첫 태그만** 보고 판정한다. 번역 직렬화는 표를 항상 raw HTML로 쓰므로(`TableForTranslation`) 표로 시작하는 문서는 응답도 `<table`로 시작하고, "마크다운 + HTML 표" 혼합 응답이 통째로 `convertHtmlListsToMarkdown`(DOM 파서)에 들어갔다. 판정에서 표 세그먼트를 제외한다 — `parseMarkdownWithTables`가 혼합을 이미 무손실로 처리하고, 표 밖 `<ul>`/`<p>`도 `html: true` 경로가 알아서 파싱한다(실측 확인). HTML 구제 경로 자체는 진짜 HTML 응답용으로 남겼다.
  - **텍스트 노드 유실**: `convertHtmlListsToMarkdown`이 `doc.body.children`(Element만)을 순회해, 표 사이 마크다운은 전부 텍스트 노드라 조용히 버려졌다. `childNodes` 순회로 바꿔 그대로 흘려보낸다.
  - **autolink가 태그로 삼켜짐**: tiptap-markdown은 텍스트 == href인 링크를 `[url](url)`이 아니라 **autolink `<https://…>`**로 직렬화한다. HTML 토크나이저에겐 미지의 시작 태그라 URL이 소멸하고 뒤따르던 문단이 앞 리스트 항목에 흡수됐다 — 정렬 검사에서 1:0 불일치로 드러난다. 앱의 `링크 유지`(`pasteLinkPreserve`)는 **에디터 붙여넣기 전용**이라 이 증상과 무관하다.
  - **연속 `<p>` 병합**: 블록을 전부 `'\n'`으로 이어 `<p>A</p><p>B</p>`가 문단 하나로 합쳐졌다. 리스트 항목끼리만 `'\n'`, 그 외는 `'\n\n'`으로 잇는다.
  - **중첩 리스트 순서·중복**: 중첩 `<ul>`은 walk가 즉시 방출하는데 부모 텍스트(`parts`)는 루프 뒤에 방출해, 자식이 부모보다 먼저 나가고 중첩이 평탄화됐다(`Alpha > Inner` → `Inner, Alpha`). 내려가기 전에 flush한다. 폴백 판정도 `parts`가 비었는지 대신 **`blocks.length` 변화**로 바꿔, 중첩 리스트만 있는 `<li>`가 내용을 두 번 방출하던 중복을 없앴다.
  - 회귀 테스트 5건은 `markdownConverter.test.ts`. 기존 혼합 테스트가 `# Section 1`로 **시작**해 정상 경로만 타는 바람에 이 버그를 못 잡았다 — 표로 시작하는 케이스를 추가했다.

### Previous (2026-07-29)

- **선택 액션 진입점을 인라인 툴바 하나로 정리**: 우클릭 세로 메뉴(`SelectionActionMenu`)를 제거하고, 같은 액션을 제공하던 인라인 가로 툴바만 남겼다(`SelectionActionMenu.tsx` → `SelectionInlineToolbar.tsx`). 선택 영역 우클릭은 이제 OS/웹뷰 기본 메뉴가 뜬다.
  - **툴바 줄바꿈 깨짐 수정**: `position:fixed`는 기본이 shrink-to-fit이라 오른쪽 끝에서 남은 폭만큼 좁아지고, 버튼 높이가 `h-[34px]` 고정이라 줄바꿈된 두 번째 줄이 `overflow-hidden`에 잘렸다. 폭을 `w-max`로 고정하고, 미리 알 수 없는 실제 폭은 **렌더 후 `useLayoutEffect`로 실측해** 화면 밖으로 나간 만큼만 왼쪽으로 되민다(기존의 `innerWidth - 320` 추정 클램프 삭제). 회귀 테스트는 `e2e/selection-editing.spec.ts`의 `scrollHeight > clientHeight` 단언.
  - **기존 코멘트 보기 항목은 사라진다** — 우클릭 메뉴에만 있던 기능이고, 코멘트 마크를 클릭하면 같은 상세 popover가 열린다. 딸려서 죽는 것들 함께 제거: `SelectionBubble.existingComments`, `comment.viewButton`/`viewWithExcerpt` i18n, 메뉴 바깥 클릭 핸들러(`data-selection-action-menu`).
- **연속 hardBreak 축소 수정 (`docBlockDiff.ts`)**: `extractBlockText`가 hardBreak를 하위 블록 구분자(`parts.join('\n')`)에 맡겨서, 사이에 텍스트가 없는 hardBreak는 `parts`에 아무것도 넣지 못하고 사라졌다 — `A\n\nB`가 `A\nB`로 줄고 앞뒤에 붙은 것은 아예 소실. hardBreak를 인라인 줄바꿈으로 보고 `inlineBuffer`에 직접 넣는다. `blockKey`가 `\s+ → ' '`로 정규화하므로 블록 매칭은 무영향, hardBreak 문단은 `isFlatTextBlock`이 false라 swap 경로로 가므로 부분 병합 재조립 계약도 그대로 — 바뀌는 건 swap 카드에 표시되는 원본 텍스트뿐. 2026-07-08 폴리싱 diff 수정 때 "원인이 달라 별도 이슈"로 남겨둔 항목(`docs/polish-diff-whitespace-bug.md`).
- **품질 장부(Quality Ledger) 제거** ([ADR-0007](../docs/adr/0007-remove-quality-ledger.md)): 기록만 하고 읽는 곳이 없어 전량 걷어냈다. WP-A2~A5도 함께 폐기. 지운 것 — `src/quality/`(모듈 전체), Rust `commands/quality.rs`·db 메서드 5개·`QualityRecordRow`/`QualityRunRow`/`QualityRecordFilter`, `quality_records`/`quality_runs` 테이블, ReviewPanel의 proposed/accepted/rejected 기록과 JSONL 내보내기 버튼, EditorCanvasTipTap의 `logQualityRun` 2곳, `oddeyesAppBridge`의 반입 기록·브리지 메서드 2개, `review.ledger.*` i18n.
  - **테이블은 `migrate_drop_quality_ledger`로 드롭한다** — 코드만 지우면 죽은 스키마가 영구히 남는다. `DROP TABLE IF EXISTS`라 재실행·신규 DB 모두 안전하고, 쌓여 있던 행은 함께 사라진다.
  - **Desktop MCP 1.0.0 (breaking)**: `oddeyes_log_quality_records`/`oddeyes_get_quality_records` 제거(25 → 23 tools). **`.mcpb` 재번들 + `npm publish` 미실시** — 배포는 별도로 해야 클라이언트에 반영된다.
  - `src/tauri/dialog.ts`의 `pickQualityLedgerPath`는 **남겼다** — 정렬 리포트(`alignmentReport.ts`)가 아직 쓴다. 다이얼로그 제목이 `Export Quality Ledger`인 건 4.5 때부터 있던 부정확한 재사용이라 이번 범위 밖.
- **선택 도구 신뢰경계 절단 수정**: `get_selection_surroundings`(캡 4000)/`get_aligned_selection_context`(6000)의 출력이 캡을 넘으면 `chatAgent/middleware.ts:276-280`이 통째로 잘라 닫는 `</untrusted>`가 사라지고 JSON도 중간에서 끊겼다. 문서 데이터가 신뢰경계 밖으로 새는 형태라 단순 절단보다 성질이 나쁘다. `renderSelectionToolOutput`이 **본문 텍스트를 줄여** 캡에 맞춘다 — 문서 도구(`renderDocumentToolOutput`)는 마크다운이라 문자열을 잘라내면 되지만 여기는 JSON이라 같은 수를 못 쓴다. 여유분을 빼는 대신 **래핑까지 마친 실제 길이를 재서** 비교한다(JSON 이스케이프·무해화 삽입 때문에 길이 예측이 부정확). 함께: 선택 도구에도 `neutralizeUntrustedMarkers`를 적용 — 문서 텍스트에 `</untrusted>`가 들어 있으면 경계를 위조할 수 있었다(문서 도구에는 이미 있던 방어).
- **다른 프로젝트에서 메모리 가져오기** ([ADR-0009](../docs/adr/0009-project-memory-import-by-copy.md)): Settings의 `가져오기`가 원본 프로젝트를 고르고 항목·금칙어를 체크해 현재 프로젝트로 **복사**한다. 실시간 동기화가 아니라 스냅샷 복사다 — 원본을 나중에 고쳐도 따라오지 않는다. 하류(ContextSnapshot·주입·MCP)는 무변경이고, 커맨드는 `import_project_memory_items` 하나가 추가됐다.
  - **공유 링크(glossary식) 대신 복사를 택했다**: `project_memory_state.revision`이 프로젝트 단위라 공유 세트 1건 수정 시 링크된 모든 프로젝트의 revision을 bump해야 하고, MCP 6종이 projectId 단수 전제라 breaking이 된다. 용어집은 이미 `setProjectGlossaries`로 프로젝트에 링크할 수 있어 범위 밖.
  - **`created_at`은 지금으로 새로 찍는다**: 프로젝트 복제용 `copy_project_memory_data`는 원본 시각을 복사하는데, 가져오기가 그러면 목록(`created_at ASC`) 중간에 파묻히고 상한 동점 처리(index 기준)에서 "오래된 것"으로 먼저 잘린다. `source`는 `import`로 덮고, 출처 세션·메시지 id는 원본 프로젝트의 대화를 가리키므로 버린다.
  - **금칙어는 복사가 아니라 upsert 의미로 넣는다**: 스키마에 `(project_id, term)` UNIQUE가 없고 중복 병합은 `upsert_forbidden_term`에만 있어서, 복사 루프를 그대로 쓰면 가져올 때마다 증식한다.
  - **메모리 중복 판정은 카테고리를 뺀 내용 해시만 본다** — `add_project_memory_item`의 `(category, hash)`와 다르다. 설정 화면 수동 추가가 기본값 `general`로 굳어 있어, 원본에서 `domain`으로 분류된 같은 문장이 카테고리 기준으로는 중복으로 안 잡힌다(E2E에서 실제로 재현됨). 대량 복사에서 같은 문장이 두 벌 들어가면 상한만 잡아먹는다.
  - 항목별 체크박스는 필수다 — 통째로 가져오면 채팅 상한 12를 넘겨 새 프로젝트 고유 메모리가 digest에서 밀린다. 예상 활성 수가 상한을 넘으면 모달이 미리 알린다.
- **프로젝트 메모리 설정 UI 정리 + 상한 선별에 출처 반영**: 항목당 5줄 카드를 한 줄 리스트로 줄이고, 상한에 걸려 실제로 무엇이 주입되는지를 화면에 드러냈다.
  - **선별 우선순위에 `source` 축 추가**: `selectMemoryItems`가 카테고리보다 `source === 'user'`를 먼저 본다. 설정 화면 수동 입력은 기본 카테고리가 `general`(우선순위 9개 중 7번째)로 굳어 있어, 손으로 친 항목이 채팅 제안 승인분(`source='chat'`)보다 **항상 먼저 잘리던** 역전 현상이 있었다. `ContextSnapshot.projectMemoryItems`에 `source`를 optional로 실어 워크플로우(상한 40) 경로에도 같은 규칙을 적용한다 — 필드 추가 이전 스냅샷은 비-user로 취급.
  - **주입 카운터는 `renderChatMemoryDigest`로 계산**: 개수 상한(12)만 세면 과대 보고다. digest는 문자 예산(1500)에서도 잘리므로 실제 주입분은 렌더러에게 물어야 한다. 헤더의 `채팅 12/14`가 그 결과이고, 주입되지 않은 행은 흐리게 + "번역·검수에는 포함됩니다" 툴팁 — **상한이 mode별로 다르므로(채팅 12, 문서 워크플로우 40) "주입 안 됨"으로 단정하지 않는다.**
  - **카테고리는 enum 9개를 유지하고 화면만 3단계 색 점으로 압축**한다(정확한 값은 툴팁). 줄이려면 DB CHECK 재구성 + MCP breaking이 따라오는데 실기능은 우선순위 정렬 하나뿐이라 이득이 없다. 추가 폼의 select 순서도 `MEMORY_CATEGORY_PRIORITY`에서 파생 — 이전에는 표시 순서와 우선순위가 어긋나 `intent`가 `general`보다 위에 보이면서 실제로는 먼저 잘렸다.
  - **행 액션은 숨기지 않는다**: hover 시 나타나게 하면 키보드·터치에서 닿지 않고 `e2e/selection-editing.spec.ts:182`의 `project-memory-delete` 가시성 단언도 깨진다. 항상 렌더하고 `opacity`만 낮춘다. 상태 라벨은 `active`가 아닐 때만 표시하되 **편집·삭제 버튼은 상태와 무관하게 항상 렌더** — `load_project_memory`가 status를 필터하지 않으므로(`db/mod.rs:2586`), 버튼을 status로 가리면 언젠가 "지울 수 없는 항목"이 생긴다(보관 개념을 걷어낸 이유와 같은 함정).
  - **금칙어 설명 문구 추가**: 금칙어는 검색 없이 모든 AI 요청에 전량 실리는 **지시**이고 문서 검사기가 아니다(하드 체크는 `EditorCanvasTipTap.tsx:709`의 부분 수정 적용 경로 하나뿐). 용어집은 `instr(query, source)`로 **원문 쪽** 히트만 주입되므로 출력 측 금지어를 대체할 수 없다 — 둘은 합쳐지지 않는다.

### Previous (2026-07-28)

- **정렬 검사 뷰 (Phase 4.5, `design_handoff_oddeyes_editor_ui/PHASE_4_5_alignment_view.md`)** ([ADR-0008](../docs/adr/0008-alignment-computed-not-persisted.md)): 원문↔번역문 문단을 나란히 놓는 **읽기 전용** 대조 뷰. 상단 상태 스트립의 `문서 보기 | 정렬 검사` 토글로 오간다(기본은 문서 보기, `uiStore.editorViewMode`만 persist). **정렬은 저장하지 않는다** — `project.segments`는 죽은 모델이고 `translationUnitId`는 두 에디터에서 독립 발급되므로, 뷰를 열 때마다 `alignUnits.ts`가 시그니처(`type:depth:level`) 시퀀스 LCS로 계산하고 짝이 안 맞는 구간은 **고치지 않고 불일치로 표시**한다(1:1 / 1:0 / 0:1만, 1:N 미지원).
  - **에디터 언마운트 금지**: 정렬 뷰는 `PanelGroup` 위에 오버레이로 얹고 문서 보기 쪽은 `visibility:hidden`으로 가린다. 언마운트하면 TipTap 인스턴스가 파괴돼 `editorStore`가 비고 점프·검수 적용이 깨진다. `display:none`이 아닌 `visibility`인 이유는 ① 레이아웃이 남아 스크롤 위치가 보존되고(실측 1500 → 1500) ② 숨은 요소는 포커스를 못 받아 읽기 전용이 함께 강제되기 때문(React 18이라 `inert` 사용 불가).
  - **재계산 트리거**: `onUpdate`가 아니라 300ms 디바운스된 문서 JSON 스냅샷. 스펙이 제안한 리비전 해시 비교는 markdown 변환+해시가 `alignUnits`보다 싸지 않아 넣지 않았다.
  - **이슈·코멘트 배지**: `useAlignmentAnnotations.ts`가 `targetExcerpt`/`excerpt` **텍스트 포함 검사**로 유닛에 매핑한다(`segmentGroupId`는 신뢰 불가). 여러 유닛에 걸리면 매핑하지 않고 하단 `위치를 특정하지 못한 이슈 N건`으로 모은다 — 이 수치가 정렬 품질 지표다. 정규화는 `normalizeForSearch`의 기존 함수 재사용.
  - **정렬 리포트**: 하단 `정렬 리포트` 버튼이 `AlignResult` 요약을 JSONL 한 줄로 내보낸다(`alignmentReport.ts`, `saveQualityJsonl`과 같은 방식). **자동 수집 없음.** 이 줄의 `ratio`가 Phase 5(영속 정렬, 4–6주) 착수 판단 근거다 — 0.95 이상이면 불필요, 0.7 근처면 착수 가치 있음.
  - 부수 변경: `ReviewPanel`의 `detectSourceLanguage` → `src/utils/detectLanguage.ts`로 이관(반환 문자열은 검수 프롬프트에 들어가므로 그대로), `TranslationUnit`에 `level?: number` 추가, `e2e/tauri-mock.ts`에 `plugin:dialog|save`·`write_text_file` 목 추가(쓰인 내용은 `window.__MOCK_WRITTEN_FILES__`).
  - **Phase 4-3(세그먼트 인스펙터)은 폐기** — 전제한 `segmentGroupId` 경로가 스키마에 없고, 4.5가 이를 대체한다.
- **프로젝트 메모리에서 보관(archive) 개념 제거** ([ADR-0006](../docs/adr/0006-hard-delete-instead-of-archive.md)): 항목 제거는 하드 삭제 하나로 통일됐다. 보관은 AI 주입에서 이미 제외되는데도 목록에 영구히 남고 되돌릴 UI가 없어, 사용자에게는 "치울 수 없는 시체"였다.
  - **DB**: `project_memory_items`에서 `supersedes_id` 컬럼과 `status='archived'`를 제거(CHECK는 `('proposed','active')`). 기존 DB는 `migrate_drop_project_memory_archive`가 테이블 재구성으로 archived 행을 삭제하며, `supersedes_id` 컬럼 유무로 판정해 재실행에 안전하다. `delete_project_memory_item` 커맨드 신설.
  - **편집은 제자리 갱신**: `replace_project_memory_item`이 원본 archive + 새 행 insert 대신 UPDATE만 한다. id·`created_at`이 유지되고 행이 늘지 않는다. 결과에서 `archived` 필드 제거.
  - **UI**: Settings의 `rev N` 표시 제거, 버튼은 `편집 / 삭제`(네이티브 confirm 경유). 카테고리·상태·출처 라벨을 `memory.category.*`/`status.*`/`source.*`로 현지화.
  - **채팅 제안**: `propose_project_memory_change`의 `operation`이 `add|replace|delete`. 저장된 legacy `'archive'` 값은 `knowledgeProposals.ts`의 `normalizeOperation`이 읽기 시점에 `delete`로 정규화한다.
  - **Desktop MCP 0.9.0 (breaking)**: `oddeyes_archive_project_memory_item` → `oddeyes_delete_project_memory_item`, `list`의 status enum에서 `archived` 제거, `replace` 응답에서 `archived` 제거. 배포 시 `.mcpb` 재번들 + `npm publish` 필요.

### Previous (2026-07-27)

- **Desktop MCP 0.8.0 (25 tools)**: 앱의 지식 모델이 legacy `projectContext` → 승인 기반 Project Memory·금칙어로 바뀐 것을 MCP에 반영. ① `oddeyes_set_translation_context`에서 `projectContext` 파라미터 **제거**(breaking) — v2.13.0 이후 채팅에 주입되지 않고 메모리 0건일 때만 스치는 죽은 쓰기였다. ② `oddeyes_get_translation_context`가 `projectContext` 대신 `projectMemory`(active)·`forbiddenTerms`(enabled)·`revision` 반환. ③ Project Memory/금칙어 도구 6종 추가: `oddeyes_list_project_memory`, `add`/`replace`/`archive_project_memory_item`(0.9.0에서 `delete_*`로 대체), `upsert`/`delete_forbidden_term`. 외부 쓰기는 `source='import'`·`status='active'`로 즉시 반영되고 Settings에서 출처 확인·삭제 가능(제안 승인 UI는 채팅 카드 전용이라 `proposed`로 넣으면 승인할 방법이 없음). ④ `oddeyes_get_status`에 `projectMemoryRevision`·카운트 추가(미로드 시 0이 아니라 `null`). 브리지 메서드는 `oddeyesAppBridge.ts`, hydrate 보증은 `ensureProjectMemory`.
- **동적 프로젝트 지식 루프 수정 (D1–D7, `docs/dynamic-project-knowledge-fix-plan.md`)**: 채팅 ↔ Project Memory 갱신 경로의 결함 7건 수정.
- **채팅 컨텍스트 주입 구조 (D1)** ([ADR-0004](../docs/adr/0004-approval-based-project-memory.md)): 일반 채팅 시스템 프롬프트에 `[프로젝트 메모리]`·`[금칙어]` 압축 요약을 push하고, 상세는 기존대로 `get_project_guidance`로 pull한다. v2.13.0에서 legacy `projectContext` 주입만 제거하고 대체 요약을 넣지 않아 승인된 메모리가 채팅에 전혀 반영되지 않던 문제. digest는 `renderChatMemoryDigest`(12개·1500자 상한), 우선순위는 `projectMemoryPolicy.ts`. **채팅 경로의 `projectContext` 슬롯은 제거됨** — `reviewTool.ts`/`translateDocument.ts`/`polishDocument.ts`의 동명 파라미터는 workflow `resolvedContext`에서 오는 별개 값이므로 혼동 주의.
- **`[Add to Context]` 제거 (D2)**: 버튼이 쓰던 `chatStore.projectContext`는 채팅에 주입되지 않고 워크플로우에서도 메모리 0건일 때만 fallback이라 사실상 죽은 경로였다. 카드·`suggest_project_context` 도구·텍스트 폴백 추론·i18n 키 삭제. store 세터/DB persist는 Desktop MCP 계약 때문에 유지.
- **제안 다건 지원 (D3)**: `ChatMessageMetadata`에 `projectMemoryProposals`/`forbiddenTermProposals`/`glossaryEntryProposals` 배열 추가. 단수 필드는 과거 메시지 호환용 deprecated. 읽기/갱신은 `components/chat/knowledgeProposals.ts`의 `read*`/`patchProposalStatus`로 일원화(legacy 단수 필드 자동 정규화).
- **승인 안전성 (D4/D5/D7)**: `duplicate` 플래그 토스트 노출, 저장 중 승인 버튼 잠금(`saving`), 제안의 `projectId`와 활성 프로젝트 일치 검증.
- **부분 수정의 전역 제약 (D9)**: 번역 규칙·금칙어는 모든 문장에 적용되는 전역 제약이므로 부분 수정 경로에도 기본 적용한다. `DEFAULT_SELECTION_REFERENCE_OPTIONS`의 `translationRules`/`forbiddenTerms`가 `true`(용어집·메모리는 `false` 유지), 참조 옵션은 선택마다 리셋하지 않고 프로젝트 단위 유지(`selectionReferenceOptionsRef`), 선택 채팅에도 규칙·금칙어를 주입. 프로젝트 메모리는 질의 의존적이라 선택 채팅에서 계속 제외하고 `get_project_guidance`에 맡긴다. 이전에는 문서를 고칠 수 있는 두 경로(직접 재번역·선택 채팅)에만 규칙이 빠져 있어, 다듬을수록 문서 내 일관성이 무너지는 구조였다.
- **workflow 메모리 상한 (D6)**: `resolveWorkflowContextFromSnapshot`이 mode별 상한(full-translate/review/polish 40, selection-retranslate 20)을 적용하고 `manifest.projectMemoryItemIds`를 실제 주입분과 일치시킨다. `buildContextSnapshot`은 전체를 유지(스냅샷 의미 보존). **카테고리 하드 제외는 하지 않는다** — legacy 마이그레이션과 수동 추가가 모두 `general`이라 배제 시 데이터 누락.

### Previous (2026-07-24)

- **Anchored selection editing**: Source/Target 선택을 raw composer 문자열 대신 `SelectionContext` 카드로 유지. Target은 직접 부분 재번역 또는 채팅의 `propose_selection_edit`만 허용하며, 공통 preview + anchor/project/text guard를 통과한 뒤 정확한 range를 한 transaction으로 적용.
- **Dynamic project knowledge**: 승인 기반 Project Memory·Forbidden Terms SQLite 저장/관리 UI 및 chat proposal 도구 추가. 프로젝트 복제/삭제와 revision이 함께 관리되며 legacy `projectContext`는 idempotent migration/fallback으로 보존.
- **Workflow ContextSnapshot** ([ADR-0005](../docs/adr/0005-fixed-context-snapshot-per-workflow.md)): 전체 번역·검수·폴리싱·부분 재번역이 작업 시작 시 고정 snapshot을 사용. 리뷰의 모든 chunk가 동일 snapshot revision을 공유하고 `ContextManifest`로 참조 ID/도구/토큰 정보를 표시.
- **Tool registry profiles**: general/selection-source/selection-target/selection-retranslate profile별 allowlist, trust/effect/output cap을 단일 registry에서 파생. 직접 부분 재번역은 tools=0.
- **선택 재번역 안정화 (v2.13.0)**: ① `retranslateSelection` 출력 토큰 4096→16384(`SELECTION_EDIT_MAX_TOKENS`) — thinking/reasoning이 예산을 잠식해 END 마커가 truncation되던 재번역 실패 수정. ② 앵커(하이라이트) 수명 정리 — apply 성공 외에도 chip dismiss·proposal 폐기/stale·새 선택 교체·프로젝트 전환 시 `removeSelectionAnchor` 호출(하이라이트 영구 잔존 버그). ③ `normalizeSelectionAnchorRange`가 가장자리 공백을 범위에서 제외 — `SelectionContext.text`(트림)와 `anchor.originalText`(textBetween) 불일치로 proposal 적용이 항상 stale 처리되던 오탐 수정. ④ e2e `tauri-mock`에 `ai_stream`/`ai_complete` 마커-에코 목 추가로 생성→적용 경로 웹 E2E 검증.
- **legacy projectContext 내부 제거 (v2.13.0)**: Settings의 "프로젝트 컨텍스트" 편집 필드와 chat 시스템 프롬프트 직접 주입 제거. 승인 기반 Project Memory로 완전 대체. 스토어 필드·DB persist·hydrate migration·워크플로우 `legacyProjectContext` fallback은 호환을 위해 유지(=데이터/계약 안전). MCP 파라미터는 0.8.0에서 제거됨(위 항목).

### Previous (2026-07-15)

- **Translator Persona 제거**: Settings UI / suggest tool / 프리셋 / Desktop MCP `translatorPersona` 필드 삭제. 기존 프로젝트 값은 hydrate 시 `translationRules` 앞에 흡수하고 DB에는 빈 문자열로 저장. 톤·문체 지시는 Rules로 통합.
- **Desktop MCP A+B (`oddeyes-desktop-mcp` v0.7.0, 19 tools)**: persona 제거; glossary entry CRUD + project link/unlink. 관리 UI 생성 시 자동 연결 제거, Settings에서 연결 해제(✕). 배포 시 `.mcpb` 재번들 + `npm publish` 필요.

### Previous (2026-07-03)

- **릴리스 빌드 시간 최적화**: 태그 빌드가 캐시를 전혀 복원하지 못하던 문제(태그 ref 캐시는 다른 태그에서 접근 불가) 해결. ① `warm-cache.yml` — main push(src-tauri/crates 변경 시)/주간 cron에서 릴리스 프로필 빌드로 rust-cache+sccache 워밍, ② `ci.yml` — main push마다 unit+cargo test 실행 및 verify 캐시 저장, ③ `build.yml` — `build`가 `verify`를 기다리지 않고 병렬 실행(publish에서 게이트), 캐시는 `shared-key`로 main 캐시 복원 전용(`save-if: false`), ④ `Cargo.toml` — `lto = "thin"` 전환으로 링크 시간 단축. 기대: 릴리스 벽시계 ~24분 → ~8–10분(warm cache 기준).
- **코드 리뷰 수정 계획 F1–F13 구현 완료** (`docs/code-review-fix-plan.md`): 검수 적용 안전성(F1–F3), 선택 적용 병합(F4/F5), 따옴표 처리(F6), Tauri AI 옵션 통합(F7/F8), 채팅 스크롤(F9/F10), 진단성/위생(F11/F12), 출력 토큰 상향(F13). 상세는 계획 문서 및 아래 항목 참조.
- **검수 적용 안전성 (F1–F3)**: `reviewApply.ts` — 세그먼트 범위 fuzzy 매칭, 다중 매치 모호 시 교체 포기, 블록 경계 교체 차단. `SearchHighlight.ts` — find/replace도 동일 가드.
- **선택 적용 병합 (F4/F5)**: 전체 선택 시 `mergeDocBySelection` 우회(full apply). `docBlockDiff` — 평탄 텍스트 블록만 문장 단위 diff, 중첩 구조는 swap 단위.
- **따옴표 처리 (F6)**: parse 시 보존, apply 시 `resolveReplacementText`로 문서 컨텍스트 기반 조건부 벗김. `getWrappingQuotePair`로 균형 인용만 strip.
- **AI 모델 호출 옵션 통합 (F7/F8)**: `src/ai/modelCallOptions.ts` — `resolveModelCallOptions(cfg, useFor)`가 LangChain(`client.ts`)과 Tauri(`backendCompletion.ts` → Rust `ai.rs`)의 temperature/adaptive thinking/effort를 일원화. Sonnet 5 temperature 400 방지 포함.
- **출력 토큰 상향 (F13)**: `REVIEW_MAX_TOKENS` 16384, `DEFAULT_CHAT_MAX_TOKENS` 8192 (thinking 토큰이 max_tokens 예산을 잠식하는 무음 truncation 방지).
- **채팅 스크롤 (F9/F10)**: `useChatScroll` — smooth 자동 스크롤 중간 프레임이 stick-to-bottom을 해제하지 않도록 `isAutoScrolling` 플래그. `ChatContent.sendCurrent`에서 본인 전송 시 `scrollToBottom()`.
- **프로젝트 전환 후 검수 적용 실패 수정**: `EditorCanvasTipTap`은 프로젝트로 remount되지 않아 TipTap 인스턴스가 재사용되는데, `switchProjectById`의 `clearEditors()`만 호출되어 `editorStore.targetEditor`가 null로 방치되던 버그. `project?.id` 변경 시 살아있는 에디터를 스토어에 재등록하는 effect 추가.

### Previous (2026-06-30)

- **Chat clipboard image paste (Tauri)**: 채팅 컴포저 Cmd+V 이미지 붙여넣기 지원. WKWebView `clipboardData` 미노출 시 `tauri-plugin-clipboard-manager` `readImage()` fallback. macOS `validate_path`가 `/private/var/folders/` 임시 업로드 경로를 차단하던 버그 수정.

### Previous (2026-06-10)

- **Target Polishing workflow (v2.6.0)**: 에디터 패널 상단에 `번역 → 검수 → 폴리싱` 액션 추가. 폴리싱은 ReviewPanel 결과와 무관하게 현재 Target 문서만 입력으로 받아 원어민 관점의 어색한 collocation, 표현, 문장 구조를 다듬는 target-only 재번역 워크플로우입니다. 결과는 기존 번역과 동일하게 Preview modal에서 확인 후 적용합니다.
- **Review prompt scope expanded**: 대조 검수에서도 누락/오역/왜곡/일관성뿐 아니라 원어민이 보기에 어색한 collocation, 표현, 문장 구조를 검수 기준에 명시합니다.
- **Secure API key persistence fix (v2.6.1)**: SecretManager 초기화가 한 번 실패해도 다음 API 키 저장/읽기 시 Keychain 초기화를 재시도합니다. 설정 화면은 보안 저장 실패 시 generic warning만이 아니라 안전한 실패 원인 메시지도 표시합니다.
- **Release verified**: `v2.6.1` GitHub Actions `Build` run succeeded for verify, macOS universal DMG, and Windows NSIS artifacts.

### Previous (2026-06-01)

- **Desktop Bridge MCP 쓰기 도구 추가 (`oddeyes-desktop-mcp` v0.2.0)**: 외부 Claude가 실행 중인 앱에 쓰는 도구 2종 추가 — `oddeyes_set_review_issues`(검수 결과 주입 → `reviewStore.ingestExternalReview`), `oddeyes_set_translation_context`(rules/projectContext 주입 → `chatStore` 세터, replace|append; persona 필드는 이후 제거됨). bridge는 기존 store 세터만 호출(신규 store 액션 없음). 상세는 `patterns.md`의 "Desktop Bridge MCP".
- **MCP 배포 동기화 주의**: 도구 추가 시 `oddeyes-desktop-mcp`의 ① `package.json`/`manifest.template.json` 버전 bump ② manifest `tools` 배열 ③ `.mcpb` 재번들 + `npm publish`(npx 경로)까지 함께 해야 클라이언트가 새 도구를 인식. npm `oddeyes-desktop-mcp@0.2.0` 게시 완료.

### Previous (2026-04-28)

- **모델 마이그레이션 (v2.4.5)**: GPT-5.4 → GPT-5.5, Claude Opus 4.6 → 4.7. `aiConfigStore` v8 → v9 자동 rename. `gpt-5.4-mini`는 chat 저비용 옵션으로 유지.
- **Opus 4.7 sampling 파라미터 가드**: `client.ts`에서 `claude-opus-4-7+` 모델 호출 시 `temperature` 미전달 (Anthropic 400 에러 방지). 정규식 `/^claude-opus-4-(7|[89]|\d{2,})/`로 향후 버전 자동 대응.
- **`migrateAiConfig` export**: `aiConfigStore`의 마이그레이션 함수를 분리 export하여 단위 테스트 가능. 기존 closure 내부 정의는 제거.

### Previous (2026-04-07)

- **MCP 정리**: `tauri-testing-mcp`에서 `oddeyes_*` semantic tools 8개 제거, `desktop_mcp.rs`에서 미사용 `load_confluence_page` 커맨드 제거, AppSettingsModal Claude Desktop 섹션 간소화.
- **테스트 타입 수정**: `adfToTipTap.test.ts`에 `AdfNode` 타입 적용, `confluenceTools.test.ts` 미사용 헬퍼 제거.
- **Rust 미사용 import 정리**: 4개 파일에서 `tracing::{debug, error}` 미사용 import 제거.

### Previous (2026-04-06)
- **ADF→TipTap Converter**: ADF(Atlassian Document Format) → TipTap JSON 변환기 추가 (`adfToTipTap.ts`). `oddeyes_set_source_document`에서 `format: "adf"` 지원.
- **ResizableProjectSidebar**: ProjectSidebar 너비 160–300px 범위에서 드래그 리사이즈 가능.
- **Atlassian MCP SSE→Streamable HTTP 마이그레이션**: SSE 방식에서 Streamable HTTP로 전환.

### Tauri Testing Bridge Notes
- 이 브리지는 **Playwright 전체 엔진 대체가 아니라**, Tauri 런타임 내부 제어를 위한 RPC 레이어입니다.
- Native dialog는 DOM에 나타나지 않을 수 있으므로 `dialog.*` 도구를 먼저 사용해 응답 정책을 설정하세요.
- WebSocket 서버는 localhost 단일 클라이언트 + 토큰 인증 방식입니다.

## E2E Automation Testing (Tauri MCP Bridge)

### Architecture
```
Test Script (.mjs) → MCP Client (stdio) → MCP Server (tauri-testing-mcp)
    → WebSocket (JSON-RPC 2.0) → Tauri Plugin (tauri-plugin-testing)
    → bridge.js → DOM / Dialog / Tauri API
```

### Prerequisites
MCP 테스트 실행 전, `--features testing` 플래그로 앱을 먼저 띄워야 합니다:
```bash
TAURI_TESTING_ENABLED=1 \
TAURI_TEST_TOKEN=tauri-testing-token \
TAURI_TEST_PORT=9988 \
npx tauri dev --features testing --no-watch --config src-tauri/tauri.conf.json --config '{"build":{"beforeDevCommand":""}}'
```
별도 터미널에서 MCP 서버 실행:
```bash
TAURI_TEST_TOKEN=tauri-testing-token TAURI_TEST_PORT=9988 npm run tauri-testing-mcp:start
```

### Quick Commands
```bash
npm run test:e2e:tauri:mcp:workflow     # Full workflow (번역+리뷰+채팅)
npm run test:e2e:tauri:mcp:new-project  # 프로젝트 생성 smoke test
npm run test:e2e:tauri:mcp:chat-selection # SelectionContext 카드 shortcut
npx playwright test -c playwright.web.config.ts e2e/selection-editing.spec.ts
node scripts/tauri-testing-mcp-<name>.mjs  # Custom scenario
```

### Scenario Skills
```
/e2e-scenario 프로젝트 생성 후 번역해봐            # 새 시나리오 자동 생성
/e2e-scenario --dry-run 히스토리 저장/복원 테스트   # 구조만 미리보기
/e2e-scenario --attach-to-running 채팅 테스트       # 실행 중인 앱에 연결
```

### Available MCP Tools (36개)
- **DOM**: `query_selector`, `click`, `click_by_text`, `fill`, `fill_by_placeholder`, `type_contenteditable`, `type_contenteditable_by_selector`, `get_text`, `get_value`, `get_all`, `get_page_content`, `select`, `keyboard`, `scroll_to`, `wait_for_selector`, `wait_for_text`, `wait_for_hidden`
- **Dialog**: `get_state`, `set_auto_response`, `push_response`, `clear`
- **Tauri**: `invoke`, `emit`
- **Window**: `get_title`, `get_size`, `set_size`, `list`, `maximize`, `minimize`, `close`, `screenshot`
- **App**: `ping`, `quit`

### Scenario Patterns
| Pattern | Flow | Use Case |
|---------|------|----------|
| A. Full Workflow | 프로젝트→설정→번역→리뷰→채팅 | CI 회귀 테스트 |
| B. Translation | 프로젝트→원문→번역→확인 | 번역 기능 검증 |
| C. Chat | 프로젝트→번역→채팅 다양한 질문 | 채팅/프롬프트 검증 |
| D. Settings | 프로젝트→앱 설정→프로젝트 설정 | 설정 UI 검증 |
| E. History | 프로젝트→번역→저장→수정→비교/복원 | 히스토리 기능 |
| F. Edge Case | 빈 문서, 긴 문서, 특수문자 등 | 안정성 테스트 |

### Gotchas
- **TipTap**: `fill`은 Source 초기 입력만 가능, 이후는 `type_contenteditable_by_selector` 사용
- **DebouncedTextarea**: 설정 필드 입력 후 700ms 대기 필요
- **언어 선택**: 시스템 언어에 따라 한/영 두 가지 시도
- **Dialog**: 삭제 확인 등 네이티브 팝업은 `dialog.setAutoResponse` 선행 필수
- **단일 클라이언트**: WebSocket은 동시에 1개 연결만 허용

### Related Skills
- `/e2e-scenario` — 자연어로 E2E 시나리오 자동 생성
- `/record-demo` — E2E 시나리오를 데모 영상으로 녹화
- `/tdd` — 유닛 테스트 TDD 워크플로우
- `/test-ai` — AI 페이로드 dry-run 검증

## Adding New Features

1. Update relevant Zustand store(s)
2. Add Tauri command if backend logic needed
3. Create/update UI components
4. Add i18n keys to both `ko.json` and `en.json`
5. Test with real AI API calls
6. Verify SQLite persistence across sessions
7. (Optional) `/e2e-scenario`로 E2E 자동화 시나리오 추가

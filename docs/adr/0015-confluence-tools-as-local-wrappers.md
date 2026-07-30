# ADR-0015: Confluence 도구는 MCP 서버 도구를 그대로 바인딩하지 않고 로컬 래퍼로 감싼다

- **Status**: Accepted
- **Date**: 2026-07-30
- **관련**: [ADR-0011](0011-remove-notion-integration.md)(바인딩되지 않는 도구를 지시하던 같은 계열의 결함), `src/ai/tools/confluenceTools.ts`, `src/ai/tools/toolRegistry.ts`, `src/ai/chat.ts:buildToolSpecs`

## Context

채팅의 `Confluence 검색` 토글은 기본값이 ON인데, **실제로 검색을 켜지 않고 있었습니다.**

`buildToolSpecs`는 서버가 준 MCP 도구를 `allowedNames`(= `CHAT_TOOL_REGISTRY`에서 파생)로 필터합니다. 그런데 registry에 있는 Confluence 항목은 `confluence_load_page`(로컬 도구) 하나뿐이고, Atlassian MCP 서버가 주는 이름(`search`, `searchConfluenceUsingCql`, `getConfluencePage` …)은 registry에 없습니다. 그래서 연결이 멀쩡해도 검색 도구가 **전량 탈락**했습니다.

`e38143d`(2026-07-24, registry/allowlist 도입) 이전에는 `allMcpTools.filter((tool) => tool.name !== 'getConfluencePage')`로 서버 도구를 거의 전부 바인딩하고 있었습니다. allowlist 리팩터가 이 경로를 조용히 끊었고, 토글 이름만 남았습니다. ADR-0011에서 발견한 "프롬프트가 바인딩되지 않는 도구를 쓰라고 지시하던" 것과 같은 계열입니다.

여기에 두 번째 결함이 겹쳐 있었습니다. 미연결 상태에서도 `confluence_load_page`는 바인딩됩니다 — 모델이 부르면 `mcp_call_tool`에서 실패하므로 **모델 왕복 한 번을 그냥 버립니다**. 도구 스펙 토큰(~184)도 매 요청 함께 실립니다.

필요한 기능은 두 개로 확인됐습니다: **위키 검색**, 그리고 **URL로 페이지 본문 조회**. 후자는 기존 `confluence_load_page`(원문 패널에 로드 = 문서 덮어쓰기)로는 대체되지 않습니다 — 읽고 답하기 위한 경로가 없었습니다.

### 검토한 대안과 버린 이유

- **서버 MCP 도구 이름을 registry에 등재해 그대로 바인딩한다** (끊긴 경로를 되살리는 최소 수정). 버렸습니다. ① 서버 설명이 장문입니다 — `searchConfluenceUsingCql`의 CQL 설명 하나가 900자를 넘고, 이 값은 tools 프리픽스에 그대로 실립니다. ② 결과 형태를 통제할 수 없습니다. Rovo `search`는 20건(원본 ~7,000자)을 통째로 주는데 그중 Jira 이슈가 섞여 있고 파라미터로 좁힐 수 없습니다. registry 캡에 걸려 뒷부분이 잘리면 몇 건이 사라졌는지 아무도 모릅니다. ③ 서버가 스펙을 바꾸면 registry의 이름·캡과 조용히 어긋납니다 — 방금 겪은 고장이 정확히 그 형태입니다.
- **모든 MCP 도구를 무조건 바인딩한다** (allowlist 우회). 버렸습니다. registry는 trust/effect/출력 캡의 단일 출처이고, 미등록 도구는 캡이 기본값(8,000)으로 떨어지며 `document-write` 같은 위험 분류가 사라집니다.
- **`confluence_load_page`로 조회를 대신한다.** 버렸습니다. 원문 문서를 덮어쓰는 파괴적 동작이라 "이 페이지에 뭐라고 써 있어?"에 쓸 수 없습니다.

## Decision

**Confluence 도구는 `mcp_call_tool`을 호출하는 로컬 래퍼로 만들고, registry에 이름·trust·캡을 우리가 등재한다. 서버 MCP 도구는 바인딩하지 않는다.**

- `confluence_search` (`confluenceTools.ts`) — Rovo `search`를 호출하고, ARI(`ari:cloud:confluence:`)로 Confluence만 남긴 뒤 `제목 (ID) / URL / 발췌`로 다듬는다. 10건·발췌 200자·총 3,500자 상한을 **도구가 먼저** 맞춘다(`SEARCH_OUTPUT_CHARS`). 잘라낸 건수는 문장으로 알린다.
  - 검색 결과에 페이지 ID를 함께 싣는 이유: 공간 홈 결과는 URL이 `/spaces/X/overview`로 와서 `/pages/<id>`가 없다. URL만으로는 열 수 없다.
- `confluence_get_page` (`confluenceTools.ts`) — URL·ID·짧은 링크(`/wiki/x/...`)를 받아 본문을 Markdown으로 반환하는 **읽기 전용** 도구. 기존 5분 TTL 페이지 캐시를 공유한다(`fetchPageMarkdown`).
- `confluence_load_page`는 유지하되 설명에 "현재 원문 문서를 덮어쓴다 / 읽기만 할 때는 `confluence_get_page`를 쓴다"를 명시한다.
- `buildToolSpecs`는 **실연결 상태로 게이팅**한다 — `input.confluenceSearchEnabled && mcpClientManager.getStatus().isConnected`. 서버 도구를 합치던 `getTools()` 호출은 제거한다(어차피 전량 탈락하던 경로).
- 세션의 `confluenceSearchEnabled` 기본값은 `true`를 유지한다. 미연결 시 토큰이 0이 되므로 기본값을 연결 상태로 바꿀 이유가 없다 — 그 안은 `initialize()`가 비동기라 시작 직후 만든 세션이 토큰이 멀쩡한데도 OFF로 굳고, 그 값이 DB에 영속된다.
- 외부 도구 출력의 신뢰경계 태그를 무해화한다 (`middleware.ts:neutralizeExternalMarkers`). 사내 위키 본문은 누구나 편집할 수 있고, 본문에 `</external_content>`가 있으면 그 뒤가 경계 밖 지시문으로 읽힌다. `documentTools`의 `neutralizeUntrustedMarkers`와 같은 방식이다.

## Consequences

- **얻은 것**: 검색과 URL 조회가 실제로 동작합니다. tools 프리픽스에 드는 값은 실측 474토큰(search 146 / get_page 144 / load_page 184)이고 미연결이면 0입니다. 결과 형태·건수·캡이 우리 코드 안에 있어 서버 스펙 변경이 조용한 고장으로 번지지 않습니다.
- **잃은 것 / 감수하는 것**:
  - 서버가 새 Confluence 도구를 추가해도 자동으로 늘어나지 않습니다. 필요하면 래퍼를 하나 더 씁니다 — 이 결정은 그 비용을 "설명 토큰과 캡을 우리가 정하는 값"으로 바꾼 것입니다.
  - CQL 검색은 없습니다. Rovo 자연어 검색 하나만 노출합니다.
  - **다중 사이트 계정에서는 첫 사이트만 봅니다.** `getCloudId()`가 `resources[0]`을 쓰고, 검색 결과의 `metadata.cloudId`는 무시합니다(`confluence_load_page`도 원래 이랬습니다).
  - `confluence_get_page`에는 발췌 파라미터가 없습니다. 8,000자를 넘는 페이지는 미들웨어가 앞부분만 남기고 자릅니다(모델에게는 잘렸다고 알립니다).
  - 연결 상태가 세션 중간에 바뀌면(토큰 만료·연결) tools 블록이 달라져 prompt cache 프리픽스가 한 번 깨집니다. 드문 전이이므로 cache write 1.25배 1회로 감수합니다.
- **따라오는 의무**:
  - `McpClientManager.getTools()`/`loadTools()`/`toolsCache`는 호출자가 없어졌습니다. 남겨두었으나, 되살리려면 이 ADR의 판단을 먼저 뒤집어야 합니다.
  - Confluence 도구를 추가할 때는 registry 등재 + i18n `chat.toolName.*` 양쪽(ko/en)이 함께 가야 합니다. `displayNameKey`는 registry 테스트가 강제합니다.
  - 웹 E2E에는 이 도구들의 커버리지가 없습니다. `e2e/tauri-mock.ts`의 `mcp_get_status`는 `{ connected: false }`를 반환하는데 프런트가 보는 필드는 `isConnected`입니다 — E2E를 붙이려면 목을 먼저 고쳐야 합니다.

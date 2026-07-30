# ADR-0011: Notion 연동을 제거한다

- **Status**: Accepted
- **Date**: 2026-07-30
- **관련**: `src/ai/tools/toolRegistry.ts`, `src-tauri/src/mcp/registry.rs`, ADR-0007(같은 성격의 폐기 결정)

## Context

Notion 연동은 채팅에서 Notion 워크스페이스를 검색·조회하는 기능이었습니다. 제거 시점까지 **한 번도 실사용되지 않았습니다.**

`src/ai/README.md`의 드리프트를 조사하다 발견한 사실이 판단을 굳혔습니다 — **구현이 두 벌 있었고 그중 한 벌은 이미 죽어 있었습니다.**

| | 상태 | 규모 |
|---|---|---|
| ① REST (`src-tauri/src/notion/`, `commands/notion.rs`, `notionTools.ts`) | 프런트가 쓰는 유일한 경로. Integration Token + Settings 커넥터 카드 + 채팅 토글 | Rust 715 + TS 403 LOC |
| ② MCP/OAuth (`mcp/notion_client.rs`, `notion_oauth.rs`, `McpServerId::Notion`) | **죽음.** TS에서 `mcp_set_notion_config`를 부르는 곳은 e2e 목뿐이고 connect/get_tools 경로도 미사용 | Rust 616 LOC + registry match arm 10여 곳 |

②는 ①로 갈아탄 뒤 남은 잔해입니다(`McpClientManager.ts`의 주석이 "Notion: REST API 직접 호출 (MCP 대신)"로 그 전환을 기록하고 있었습니다). 닿는 지점은 `clearAllMcpServer("notion")` 하나뿐이었습니다.

또한 tool guide에 **바인딩되지 않는 도구를 쓰라는 지시**가 살아 있었습니다 — `chat.ts`가 "notion_search로 검색 후 notion_get_page로 내용 조회"를 주입하는데, `notion_get_page`는 `CHAT_TOOL_REGISTRY`에 없어 절대 바인딩되지 않습니다. 즉 쓰지 않는 기능이 프롬프트 예산을 쓰면서 모델에 틀린 지시를 내보내고 있었습니다.

## Decision

**전량 제거한다** — ①과 ② 모두.

②만 지우는 안(기능 손실 0, 616 LOC 정리)도 검토했습니다. 기각 — 쓰지 않는 기능을 유지하는 비용이 남고, 되살리는 비용은 git에서 되돌리는 것뿐입니다(외부에 쌓인 데이터가 없으므로 ADR-0007과 달리 **가역적**입니다).

지운 것:

- **Rust** — `src/notion/`(3파일), `commands/notion.rs`, `mcp/notion_client.rs`, `mcp/notion_oauth.rs`. Tauri 커맨드 8개(`notion_*` 7개 + `mcp_set_notion_config`) 등록 해제. `McpServerId`는 `Atlassian` 단일 variant로 축소.
- **TS** — `tools/notionTools.ts`(+테스트), `toolRegistry.ts`의 `notion_search`, `ChatToolRequirement`의 `notion-enabled`, `chat.ts`의 `notionSearchEnabled`·tool guide 분기, `McpClientManager`의 Notion 메서드 전체, `ConnectorsSection`의 `NotionTokenDialog`, `ChatContent`의 검색 토글, `connectors/index.ts` 항목, i18n 양쪽.
- **E2E** — `tauri-mock`의 Notion 목 8개, `user-story.spec.ts`의 Phase 2 테스트, `record-demos.spec.ts`의 데모 4번.

**vault 키 매핑은 남긴다** — `secrets/manager.rs`의 `notion:integration_token` → `notion/integration_token` 매핑은 오래된 vault를 읽는 마이그레이션 표입니다. 지우면 기존 저장소 호환이 깨집니다. 새로 쓰이지는 않습니다.

## Consequences

- **저장된 Integration Token은 vault에 남습니다.** 읽는 코드가 없어 무해하지만 자동 삭제되지도 않습니다. 지우려면 Keychain에서 직접 제거해야 합니다.
- **`McpClientManager.getAllTools()`를 함께 제거했습니다** — Atlassian + Notion 도구를 합치는 것이 유일한 존재 이유였고 호출자가 없었습니다.
- **데모 영상 4번(`Connector.webm`)이 사라집니다.** Notion 토큰 입력 다이얼로그를 보여주는 시나리오였습니다. Atlassian은 OAuth 리다이렉트 방식이라 같은 흐름으로 대체할 수 없어 재작성하지 않았습니다 — Confluence 연동은 데모 5번이 이미 다룹니다.
- **되살리려면**: 이 커밋을 되돌리면 됩니다. 단, 되살릴 때 ②(MCP/OAuth)는 함께 되살리지 마십시오 — 처음부터 죽은 경로였습니다.

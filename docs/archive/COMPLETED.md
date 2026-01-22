# Completed Implementation Specs (Archive)

이 폴더의 문서들은 **구현이 완료된 기능 스펙**입니다. 상세 내용은 각 파일을 참조하세요.

## 요약

### 1. Hybrid Panel Layout (FLOATING-CHAT-SPEC.md)
- **상태**: ✅ 완료
- **내용**: Settings/Review 고정 사이드바 + 플로팅 Chat 패널
- **주요 파일**: `SettingsSidebar.tsx`, `FloatingChatPanel.tsx`, `FloatingChatButton.tsx`

### 2. Notion 연동 (notion-mcp-implementation.md)
- **상태**: ✅ 완료
- **내용**: Notion REST API 직접 호출 (MCP 우회)
- **주요 파일**: `src-tauri/src/notion/`, `src/ai/tools/notionTools.ts`

### 3. 번역 검수 개선 (review_tool_improvement.md)
- **상태**: ✅ 완료 (Phase 1-6)
- **내용**: JSON 출력 포맷, 체크박스 테이블, TipTap Decoration 하이라이트
- **주요 파일**: `reviewStore.ts`, `ReviewPanel.tsx`, `ReviewHighlight.ts`

### 4. Secret Manager (secret_manager.md)
- **상태**: ✅ 완료
- **내용**: Master Key + Encrypted Vault (XChaCha20-Poly1305)
- **주요 파일**: `src-tauri/src/secrets/`

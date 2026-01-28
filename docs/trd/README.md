# TRD (Technical Requirements Document)

> OddEyes.ai 기술 설계 문서 (Source of Truth)

이 문서는 OddEyes.ai의 **기술 설계도(Source of Truth)**입니다. 구현/문서가 충돌하면 본 문서를 기준으로 정리합니다.

(내부 코드명: Integrated Translation Editor / ITE)

## 표기 규칙

- **Why**: 왜 필요한가 (의도/리스크)
- **How**: 어떻게 구현할까 (접근/전략)
- **What**: 정확히 무엇을 만든다 (명세/규칙)

---

## 문서 구조

| 파일 | 내용 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 아키텍처 개요 (Tauri + TipTap 기반) |
| [02-editor.md](./02-editor.md) | 에디터 엔진 설계 (TipTap 커스터마이징) |
| [03-ai-interaction.md](./03-ai-interaction.md) | AI 상호작용 및 Preview 워크플로우 |
| [04-chat-ux.md](./04-chat-ux.md) | AI Chat UX 명세 (탭, 설정, 패널) |
| [05-review.md](./05-review.md) | 번역 검수 기능 |
| [06-attachments.md](./06-attachments.md) | 첨부 파일 시스템 |
| [07-concurrency.md](./07-concurrency.md) | Race Condition 방지 패턴 |
| [08-storage.md](./08-storage.md) | 데이터 영속성 (SQLite) |
| [09-specialized.md](./09-specialized.md) | 특화 기능 (Ghost Chips, Confluence 단어 카운팅) |
| [10-dev-tools.md](./10-dev-tools.md) | 개발 도구, 빌드/배포, 자동 업데이트 |
| [11-api-keys.md](./11-api-keys.md) | API Key 및 커넥터 관리 |
| [12-i18n.md](./12-i18n.md) | 다국어 지원 |
| [13-algorithms.md](./13-algorithms.md) | 알고리즘 명세 (번역/검수/적용) |
| [14-prompt-structure.md](./14-prompt-structure.md) | AI 프롬프트 구조 |
| [15-web-version.md](./15-web-version.md) | 웹 시연용 버전 (계획) |

---

## 빠른 참조

### 핵심 기술 스택
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Editor**: TipTap (ProseMirror)
- **State**: Zustand
- **Backend**: Tauri 2 + Rust
- **Storage**: SQLite (.ite 파일)
- **AI**: LangChain.js (OpenAI, Anthropic)

### 주요 워크플로우
1. **번역**: Source → Markdown → LLM → Markdown → TipTap JSON → Preview → Apply
2. **채팅**: Tool Calling으로 문서 on-demand 접근
3. **검수 (대조)**: 원문↔번역문 비교 → 오역/누락/왜곡/일관성 검출
4. **검수 (폴리싱)**: 번역문만 검사 → 문법/오탈자/어색한 문장 검출

### 보안 원칙
- API Key는 OS Keychain + Vault 암호화
- `.ite` 파일에 시크릿 미포함
- 문서 자동 수정 없음 (Non-Intrusive)
- XSS 방지: DOMPurify + URL 프로토콜 검증
- 경로 검증: 시스템 디렉토리 접근 차단 (Rust)

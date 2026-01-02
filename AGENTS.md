# AGENTS.md

이 문서는 **AI 코딩 에이전트(예: Cursor Agent)가 이 레포에서 작업할 때 지켜야 할 프로젝트 규칙**을 제공합니다.

> 참고: Cursor 공식 문서에서 “프로젝트별 AI 규칙”은 루트의 `.cursorrules`로 정의하는 것을 안내합니다.  
> - 문서: `https://github.com/getcursor/docs/blob/main/context/rules-for-ai.mdx`  
> 이 레포는 에이전트 실행 환경/플랫폼 호환을 위해 `AGENTS.md`도 함께 둡니다. 규칙을 바꿀 때는 필요하면 `.cursorrules`와도 정합성을 맞추세요.

## Source of Truth (충돌 시 우선)

- `prd.md`: 제품 비전/UX 원칙/워크플로우 기준
- `trd.md`: 아키텍처/데이터/AI 인터랙션/저장/세부 명세 기준

문서/코드/규칙이 충돌하면 **PRD/TRD에 맞춰 정리**합니다. 큰 설계 변경이 필요하거나 불확실하면 **추측하지 말고 질문**합니다.

## 제품/UX 핵심 원칙 (요약)

- **Document-First**: 번역가는 “문서 편집”에 집중
- **Non-Intrusive AI**: AI는 요청 시에만 개입, **문서 자동 변경/자동 적용 금지**
- **Translate는 Preview → Apply**: 적용은 사용자가 명시적으로 결정
- **Add to chat**: 선택 텍스트를 채팅 입력으로 옮기는 보조 UX이며 **단독 모델 호출 금지**

## 개발/실행 규칙 (에이전트 안전장치)

- **장기 실행(서버/워치) 작업은 사용자 요청 전에는 실행하지 않습니다.**
  - 예: `npm run dev`, `npm start`, watch 모드 테스트 등
  - 꼭 필요하면 먼저 확인을 받고, 백그라운드 실행 및 상태 확인 방법을 함께 제공합니다.
- 변경은 **최소 단위**로 수행하고, 변경 이유/의도/리스크를 짧게 설명합니다.
- 기능/UX 변경이면 **Docs-first**로 `prd.md`/`trd.md`를 먼저 갱신한 뒤 구현합니다.

## 빠른 명령어 (현재 `package.json` 기준)

- 의존성 설치: `npm install`
- 프론트 빌드: `npm run build` (=`tsc && vite build`)
- Tauri 개발: `npm run tauri:dev` *(장기 실행 — 사용자 요청 시에만)*
- Tauri 빌드: `npm run tauri:build`

## 코드베이스 안내 (어디를 고치면 되는가)

- Frontend(React/TS): `src/`
  - 에디터(TipTap): `src/editor/`, UI: `src/components/`
  - 상태(Zustand): `src/stores/`
  - AI/LangChain: `src/ai/`
  - Tauri IPC 래퍼: `src/tauri/`
- Backend(Rust/Tauri): `src-tauri/src/`
  - Tauri 명령/DB/파일 I/O 등 네이티브 로직

## Tauri/Rust 작업 시 규칙 (v2 보안 모델)

- Rust에서 프론트로 노출하는 기능은 `tauri::command`로 구현하고, 입력 검증/에러 처리를 명확히 합니다.
- **Tauri v2 권한/스코프/캡빌리티**를 최소 권한으로 구성합니다.
  - 설정 파일: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/**`
- 파일 시스템/키체인 등 민감 기능은 “가능한 가장 좁은 범위”로 제한합니다.

## AI 출력/적용 정책 (중요)

- 채팅 응답이 **문서를 자동으로 수정/적용하면 안 됩니다.**
- “문서 전체 번역”은 **TipTap JSON만 출력**하도록 강제하고(설명/코드펜스 금지), 결과는 Preview 후 Apply로만 반영합니다.

## 보안

- API 키/토큰 등 비밀정보는 **하드코딩 금지**.
- 이 프로젝트는 **API Key를 OS 키체인/키링에 저장**하는 정책을 따릅니다(로컬 저장소/DB에 평문 저장 금지).

## Git/PR 규칙 (요약)

- 커밋은 Conventional Commits 권장 (`feat:`, `fix:`, `docs:` …).
- 에이전트는 사용자가 요청하지 않는 한 git 명령 실행/커밋을 자동으로 수행하지 않습니다(필요 시 커밋을 “권유”만).

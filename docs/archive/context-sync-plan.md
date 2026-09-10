# Context Sync — 페르소나·번역규칙·프로젝트컨텍스트를 MCP로 읽고 쓰기

## 목적

외부 에이전트(trans_agent의 Claude)가 OddEyes의 **번역 컨텍스트 3종**을 MCP로 **읽고 쓸 수 있게** 한다:
- `translatorPersona` (번역가 페르소나)
- `translationRules` (번역 규칙)
- `projectContext` (프로젝트 컨텍스트/메모리)

외부 에이전트가 프로젝트 성격을 파악해 규칙·페르소나를 제안하거나, 자신이 쓰는 컨텍스트를 앱과 동기화하는 양방향 협업을 지원한다.

이 문서는 별도 세션이 이것만 읽고 구현에 들어갈 수 있도록 자족적으로 작성됨.
**`docs/review-ingest-plan.md`(검수 주입)와는 별개 작업이다** — 같은 MCP/bridge 패턴을 쓰지만 도메인이 다르다(이쪽은 `chatStore`, 저쪽은 `reviewStore`).

> **검증 상태(2026-06-01)**: 아래 모든 line:number 참조를 현재 소스로 교차검증 완료.

## 핵심 발견 — 읽기는 이미 완성, 쓰기만 추가하면 됨

| 항목 | 상태 | 위치 |
|---|---|---|
| 읽기 — bridge `getTranslationContext` | ✅ **존재** | `oddeyesAppBridge.ts:72-109, 191` |
| 읽기 — MCP `oddeyes_get_translation_context` | ✅ **존재** | `oddeyes-desktop-mcp/src/tools/documents.ts:47-53` |
| 쓰기 — chatStore 세터 6종(set 3 + append 3) | ✅ **존재** | `chatStore.settings.ts:74-115`, 노출: `chatStore.types.ts:134-139` |
| 쓰기 — 영속화(SQLite 설정 테이블) | ✅ **존재** | 세터가 `schedulePersist()` 호출, `chatStore.persist.ts:49-56` `buildChatSettings` |
| 쓰기 — bridge `setTranslationContext` | ❌ **추가 필요** | (이 문서) |
| 쓰기 — MCP `oddeyes_set_translation_context` | ❌ **추가 필요** | (이 문서) |

→ **신규 작업은 bridge 메서드 1개 + MCP 도구 1개뿐.** store 로직은 **0줄 신규**(기존 세터 호출만). review-ingest보다 단순(새 store 액션 불필요).

## 현재 구조 (확인된 사실)

```
trans_agent(Claude) → oddeyes-desktop-mcp(도구) → WebSocket bridge → 이 앱(__ODDEYES_APP_BRIDGE__) → chatStore → SQLite(설정)
```

### 읽기 경로 (이미 동작)

`getTranslationContext`(`oddeyesAppBridge.ts:72-109`)가 반환:
```ts
{
  projectId, projectTitle, targetLanguage,
  translationRules,    // ← chatStore.translationRules
  projectContext,      // ← chatStore.projectContext
  translatorPersona,   // ← chatStore.translatorPersona
  glossary,            // 용어집(보너스)
}
```
MCP 도구 `oddeyes_get_translation_context`(readOnly, `documents.ts:47-53`)로 이미 노출됨. **외부 에이전트는 지금도 3종을 읽을 수 있다.**

### 쓰기 경로 (세터는 있으나 bridge 미연결)

`chatStore`에 노출된 세터(`chatStore.types.ts:134-139`):
```ts
setTranslatorPersona:   (persona: string) => void;
appendToTranslatorPersona: (snippet: string) => void;
setTranslationRules:    (rules: string) => void;
appendToTranslationRules:  (snippet: string) => void;
setProjectContext:      (memory: string) => void;
appendToProjectContext:    (snippet: string) => void;
```
- `set*`: 필드를 **통째로 교체**(`chatStore.settings.ts:74-77, 101-104, 109-112`).
- `appendTo*`: `appendFormattedSnippet`(`settings.ts:80-96`) — 세미콜론 구분 스니펫을 `- 불릿`으로 변환해 **기존 값 뒤에 추가**(`\n\n` 구분).
- 모든 세터가 `schedulePersist()` 호출 → SQLite 영속화.

## 함정 / 주의 (검증됨)

### 함정 1 — 영속화는 `loadedProjectId`가 있어야 동작

`persistNow`(`chatStore.persist.ts:58-64`)는 `loadedProjectId`가 없으면 **저장하지 않고 조기 return**한다.
- 프로젝트가 로드돼 있으면(`getStatus`의 `ready: true` 상태) 정상 저장.
- 프로젝트 미로드 상태에서 쓰기를 호출하면 store 메모리엔 반영되나 **영속화 안 됨**(다음 hydrate에서 덮어쓰일 수 있음).
→ bridge 헬퍼에서 `useProjectStore.getState().project`가 없으면 거부(검수 주입과 동일 가드).

### 함정 2 — `setReviewIssues`와 달리 store 액션을 새로 만들지 않는다

기존 세터를 호출만 하면 된다. **새 store 액션 추가 금지**(YAGNI). bridge 헬퍼가 `mode`/필드 유무에 따라 적절한 세터를 골라 호출.

### 함정 3 — ghost chip(민감정보 마스킹)은 외부 입력엔 무관

`translationRules`/`projectContext`는 앱 내부에서 ghost chip(마스킹 토큰)을 가질 수 있고, AI 호출 시 `maskGhostChips`로 처리된다(`chatStore.ai.ts:132-134`). **외부에서 주입하는 평문엔 ghost chip이 없으므로 무해**하다. 외부 값을 그대로 세터에 넣으면 된다(특별 처리 불필요). 단, 외부가 `‹...›` 같은 마스킹 토큰 문자열을 우연히 보내도 평문으로 저장될 뿐 보안 문제는 없음.

### 함정 4 — 빈 문자열 vs 미제공 구분

부분 업데이트를 지원하려면 **"필드를 안 보냄"(건드리지 않음)** 과 **"빈 문자열을 보냄"(비우기)** 을 구분해야 한다.
→ bridge 헬퍼에서 `typeof params.X === 'string'`로 "보냈는지" 판별. `undefined`면 스킵, `''`면 해당 세터로 비우기.
(주의: `translatorPersona`의 기본값은 빈 문자열 `''` — `DEFAULT_TRANSLATOR_PERSONA = ''`, `chatStore.types.ts:10`. 즉 페르소나 비우기 = 기본값으로 되돌리기.)

## 구현 (2개 파일)

### 1) `src/desktop/oddeyesAppBridge.ts` — bridge 메서드 추가

`methods` 객체(162-203)에 키 추가:
```ts
'oddeyes.setTranslationContext': async (params) => await setTranslationContext(params ?? {}),
```

파일 상단 import에 추가:
```ts
import { useChatStore } from '@/stores/chatStore';
```
(`useProjectStore`는 이미 import됨, line 3.)

파일 내 헬퍼 함수:
```ts
type ContextField = 'translatorPersona' | 'translationRules' | 'projectContext';

async function setTranslationContext(params: BridgeParams): Promise<unknown> {
  const project = useProjectStore.getState().project;
  if (!project) throw new Error('No project loaded'); // 함정 1: 영속화 가드

  // 함정 1(보강): 외부가 projectId를 보냈으면 일치 검증 (stale 방지)
  if (typeof params.projectId === 'string' && params.projectId.length > 0 && params.projectId !== project.id) {
    throw new Error(`Project mismatch: expected ${project.id}, got ${params.projectId}`);
  }

  const mode = params.mode === 'append' ? 'append' : 'replace';
  const chat = useChatStore.getState();
  const updated: ContextField[] = [];

  // 함정 4: typeof 'string'으로 "제공 여부" 판별 — undefined면 스킵, ''면 비우기(replace만)
  const apply = (
    field: ContextField,
    value: unknown,
    setFn: (v: string) => void,
    appendFn: (v: string) => void,
  ): void => {
    if (typeof value !== 'string') return;        // 미제공 → 건드리지 않음
    if (mode === 'append') {
      if (value.trim().length === 0) return;       // append에 빈 값은 무의미
      appendFn(value);
    } else {
      setFn(value);                                // replace: '' 허용(비우기)
    }
    updated.push(field);
  };

  apply('translatorPersona', params.translatorPersona, chat.setTranslatorPersona, chat.appendToTranslatorPersona);
  apply('translationRules',  params.translationRules,  chat.setTranslationRules,  chat.appendToTranslationRules);
  apply('projectContext',    params.projectContext,    chat.setProjectContext,    chat.appendToProjectContext);

  return { ok: true, mode, updated };  // updated: 실제로 바뀐 필드명 배열
}
```

주의:
- `BridgeParams = Record<string, unknown>`는 이미 정의됨(line 14). `any` 미사용(레포 컨벤션).
- 세터는 동기 함수다(`set()` + `schedulePersist()`). `await` 불필요.
- 반환 `updated`로 외부가 "어느 필드가 실제로 반영됐는지" 확인 가능.

### 2) `oddeyes-desktop-mcp/src/tools/context.ts` (신규 모듈) — MCP 도구 추가

읽기 도구가 `documents.ts`에 있으나, 쓰기는 별도 도메인이라 신규 모듈 `context.ts`로 추가(도메인 일관성). 읽기 도구는 이미 등록돼 있으므로 **건드리지 않는다**.

`oddeyes-desktop-mcp/src/tools/context.ts`:
```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

export function registerContextTools(
  server: McpServer,
  callBridge: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    "oddeyes_set_translation_context",
    {
      description:
        "Update the OddEyes translation context: translatorPersona, translationRules, and/or projectContext. " +
        "Only the fields you provide are changed (omit a field to leave it untouched). " +
        "mode='replace' (default) overwrites the field; mode='append' adds your text to the end " +
        "(semicolon-separated items become bullet points). " +
        "Requires an active project. To read the current values first, use oddeyes_get_translation_context. " +
        "Returns { ok, mode, updated } where `updated` lists the fields actually changed.",
      inputSchema: {
        projectId: z.string().optional(),   // 있으면 앱이 현재 프로젝트와 일치 검증
        translatorPersona: z.string().optional(),
        translationRules: z.string().optional(),
        projectContext: z.string().optional(),
        mode: z.enum(["replace", "append"]).optional(),
      },
    },
    async ({ projectId, translatorPersona, translationRules, projectContext, mode }) =>
      textResult(await callBridge("oddeyes.setTranslationContext", {
        projectId, translatorPersona, translationRules, projectContext, mode,
      })),
  );
}
```

`oddeyes-desktop-mcp/src/index.ts`에 등록(2곳):
```ts
import { registerContextTools } from "./tools/context.js";   // 상단 import (line 7-8 근처)
// ...
function createMcpServer(): McpServer {
  const server = new McpServer({ name: "oddeyes-desktop", version: "0.1.0" });
  registerDocumentTools(server, callBridge);
  registerPreviewTools(server, callBridge);
  registerContextTools(server, callBridge);   // ★ 추가 (line 29-30 근처)
  return server;
}
```

## 단위 테스트

### `src/desktop/oddeyesAppBridge.test.ts`에 추가
기존은 `useChatStore`를 mock하지 않으므로(현재 import 안 함), 세터 스파이를 노출한다:
```ts
const setPersona = vi.fn(), setRules = vi.fn(), setContext = vi.fn();
const appendRules = vi.fn();
vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      setTranslatorPersona: setPersona,
      setTranslationRules: setRules,
      setProjectContext: setContext,
      appendToTranslatorPersona: vi.fn(),
      appendToTranslationRules: appendRules,
      appendToProjectContext: vi.fn(),
    }),
  },
}));
// ...
it('setTranslationContext: 제공된 필드만 replace로 갱신', async () => {
  const res = await callBridge('oddeyes.setTranslationContext', {
    translationRules: 'rule A',          // 제공
    // translatorPersona, projectContext 미제공 → 스킵
  }) as Record<string, unknown>;
  expect(res.updated).toEqual(['translationRules']);
  expect(setRules).toHaveBeenCalledWith('rule A');
  expect(setPersona).not.toHaveBeenCalled();
});

it('setTranslationContext: mode=append는 appendTo* 호출', async () => {
  await callBridge('oddeyes.setTranslationContext', {
    translationRules: 'extra rule', mode: 'append',
  });
  expect(appendRules).toHaveBeenCalledWith('extra rule');
});

it('setTranslationContext: projectId 불일치 시 거부', async () => {
  await expect(callBridge('oddeyes.setTranslationContext', { projectId: 'other' }))
    .rejects.toThrow('Project mismatch');
});
```
> 주의: `oddeyesAppBridge.test.ts`의 `useProjectStore` mock은 `project: { id: 'test-project' }`를 반환(test line 13-15). 불일치 테스트의 `'other'`는 이와 달라야 한다.

## 빌드 · 검증 절차

1. **타입 체크**: `npx tsc --noEmit` 통과(이 레포의 유일한 정적 게이트, ESLint 없음).
2. **단위테스트**: `npm run test:run` — 위 케이스 그린.
3. **MCP 빌드**: `cd oddeyes-desktop-mcp && npm run build`. stdio 모드면 **Claude 클라이언트 재연결**해야 새 도구(`oddeyes_set_translation_context`) 인식.
4. **수동 E2E**:
   - 앱에서 프로젝트 열기.
   - `oddeyes_get_translation_context`로 현재 값 확인.
   - `oddeyes_set_translation_context`로 `translationRules` replace → 앱 설정 UI(번역 규칙 입력란)에 반영되는지 확인.
   - `mode: 'append'`로 한 줄 추가 → 기존 값 뒤에 불릿으로 붙는지 확인.
   - **앱 재시작 후에도 유지되는지**(SQLite 영속화 확인). ← 검수 주입과 달리 이쪽은 영속됨.
   - 미제공 필드는 안 바뀌는지(부분 업데이트) 확인.
5. **회귀**: 앱 설정 UI에서 직접 수정 → MCP로 읽으면 최신값 나오는지(양방향 정합성).

## 알려진 한계 / 결정

- **세션 vs 프로젝트 스코프**: 이 3종은 **프로젝트 단위 설정**이다(`buildChatSettings`에 포함, `persist.ts:49-56`). 세션별이 아님. 외부에서 쓰면 현재 로드된 프로젝트에 적용·영속.
- **동시 편집 충돌**: 사용자가 설정 UI에서 편집 중일 때 외부가 덮어쓰면 마지막 쓰기가 이김(last-write-wins). 외부 에이전트는 `mode: 'append'`를 쓰거나, 먼저 `get`으로 읽고 머지하는 게 안전.
- **append 포맷**: `appendFormattedSnippet`는 세미콜론(`;`)을 항목 구분자로 보고 `- 불릿`으로 변환한다(`settings.ts:86-91`). 단순 문장 추가면 세미콜론 없이 보내면 통째로 한 불릿이 된다.

## 후속 단계 (이번 범위 밖)

1. **trans_agent 연동**: SKILL.md에 "프로젝트 파악 후 `oddeyes_set_translation_context`로 규칙 제안" 절차 추가.
2. **충돌 방지 UX**: 외부 쓰기 시 설정 UI에 토스트/하이라이트로 "외부에서 변경됨" 알림(선택).
3. **glossary 쓰기**: 현재 읽기만 됨. 용어집 주입이 필요하면 별도 도구(`searchGlossary`는 Tauri command).

## 참조 파일 (file:line) — 2026-06-01 교차검증

- `src/stores/chatStore.settings.ts` — 세터 정의: setTranslatorPersona(74-77), appendFormattedSnippet(80-96), setTranslationRules(101-104), setProjectContext(109-112), append 변형(98-99, 106-107, 114-115)
- `src/stores/chatStore.types.ts` — 세터 시그니처 노출(134-139), DEFAULT_TRANSLATOR_PERSONA=''(10), 상태 필드(66-68)
- `src/stores/chatStore.persist.ts` — buildChatSettings(49-56), persistNow loadedProjectId 가드(58-64)
- `src/stores/chatStore.ai.ts` — maskGhostChips 처리(132-134)
- `src/desktop/oddeyesAppBridge.ts` — getTranslationContext(72-109), methods 객체(162-203), 등록 라인(191), handleRequest(205-215), BridgeParams(14), useProjectStore import(3)
- `src/desktop/oddeyesAppBridge.test.ts` — store mock 패턴(11-60), callBridge 헬퍼(65-67)
- `oddeyes-desktop-mcp/src/tools/documents.ts` — oddeyes_get_translation_context 등록(47-53), textResult(4-6)
- `oddeyes-desktop-mcp/src/index.ts` — createMcpServer/도구 등록(23-33), import 위치(7-8)

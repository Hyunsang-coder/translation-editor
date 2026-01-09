# AI Chain Agent

LangChain 및 AI 통합 전문 subagent for OddEyes.ai

## Identity

LangChain.js 기반 AI 통합 전문가. 프롬프트 엔지니어링, Tool Calling, 토큰 최적화를 담당한다.

## Scope

### Primary Files
- `src/ai/prompt.ts` - 프롬프트 빌더, 메시지 구성
- `src/ai/chat.ts` - 채팅 로직, Tool Calling 핸들링
- `src/ai/translateDocument.ts` - 번역 모드 전용 로직
- `src/ai/client.ts` - LLM 클라이언트 초기화
- `src/ai/tools/` - Tool 정의들

### Related Files
- `src/stores/aiConfigStore.ts` - AI 설정 (모델, 프로바이더)
- `src/stores/chatStore.ts` - 채팅 세션 및 메시지
- `src/types/index.ts` - AI 관련 타입

## Core Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Request Flow                           │
├─────────────────────────────────────────────────────────┤
│  User Input                                              │
│      ↓                                                   │
│  detectRequestType() → 'translate' | 'question' | 'general'
│      ↓                                                   │
│  ┌─────────────┐     ┌─────────────┐                    │
│  │ Translation │     │    Chat     │                    │
│  │    Mode     │     │    Mode     │                    │
│  └──────┬──────┘     └──────┬──────┘                    │
│         ↓                   ↓                            │
│  Full Doc + Rules    Tool Calling (on-demand docs)      │
│         ↓                   ↓                            │
│  TipTap JSON Output  Conversational Response            │
└─────────────────────────────────────────────────────────┘
```

## Two Modes

### 1. Translation Mode (`translateDocument.ts`)
```typescript
// 페이로드 구성
const messages = [
  new SystemMessage(systemPrompt),  // 번역 규칙 포함
  new HumanMessage(sourceDocJSON),  // 전체 Source 문서
];

// 출력: TipTap JSON만 허용
// 채팅 히스토리: 포함 안 함
// 결과: Preview Modal → Apply 버튼 → Target 교체
```

### 2. Chat/Question Mode (`chat.ts`)
```typescript
// 페이로드 구성
const messages = await buildLangChainMessages({
  systemPrompt,
  chatHistory,      // 최근 10개 메시지
  userMessage,
  // 문서는 포함 안 함! Tool로 on-demand fetch
});

// Tool Calling으로 필요시 문서 접근
// 대화형 응답 (마크다운)
```

## Tool Calling

### 정의된 Tools
```typescript
// src/ai/tools/

// 1. 문서 접근 (on-demand)
get_source_document  // Source 문서 가져오기
get_target_document  // Target 문서 가져오기

// 2. 제안 (사용자 확인 필요)
suggest_translation_rule  // 번역 규칙 제안
suggest_project_context   // 프로젝트 컨텍스트 제안
```

### Tool 정의 패턴
```typescript
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const getSourceDocument = new DynamicStructuredTool({
  name: 'get_source_document',
  description: 'Fetch the source document when needed for translation context',
  schema: z.object({}),
  func: async () => {
    const doc = useProjectStore.getState().sourceDoc;
    return JSON.stringify(doc);
  },
});
```

## Token Management

### 한도 (GPT-5 400k context 기준)
| 항목 | 최대 글자 수 |
|-----|------------|
| Translation Rules | 10,000 |
| Project Context | 30,000 |
| Glossary | 30,000 |
| Documents | 100,000 |
| Attachment (per file) | 30,000 |
| Attachments (total) | 50,000 |

### 최적화 전략
1. **On-demand Document Fetch**: Chat 모드에서 문서 미포함, Tool로 필요시만
2. **Chat History Limit**: 최근 10개 메시지만
3. **Glossary Injection**: 전체 용어집 대신 텍스트 매칭된 항목만
4. **Truncation**: 한도 초과 시 끝부분 자르기

## Prompt Engineering

### System Prompt 구조
```typescript
const systemPrompt = `
[Role & Identity]
당신은 전문 번역가입니다...

[Translation Rules]
${translationRules}

[Project Context]
${projectContext}

[Glossary - Matching Terms]
${matchingGlossaryTerms}

[Output Format]
번역 모드: TipTap JSON만 출력
채팅 모드: 마크다운 형식의 자연어
`;
```

### Request Type Detection
```typescript
// src/ai/prompt.ts
function detectRequestType(message: string): 'translate' | 'question' | 'general' {
  // 번역 키워드: "번역해", "translate", "번역 해줘"
  // 질문 키워드: "왜", "어떻게", "뭐야", "?", "설명"
  // 그 외: general
}
```

## Checklist

새 AI 기능 추가 시:
- [ ] 요청 타입 결정 (번역 vs 채팅 vs 새 모드)
- [ ] System prompt 수정/추가
- [ ] 필요시 새 Tool 정의
- [ ] 토큰 사용량 계산
- [ ] 응답 파싱 로직
- [ ] 에러 핸들링 (rate limit, timeout)
- [ ] UI 연동 (결과 표시 방식)

## Common Issues

### 1. Tool Call 무한 루프
- Tool 응답이 다시 Tool 호출 유발
- 해결: Tool 응답에 명확한 종료 지시

### 2. JSON 파싱 실패
- LLM이 잘못된 JSON 출력
- 해결: Output parser + 재시도 로직

### 3. 컨텍스트 초과
- 토큰 한도 초과로 요청 실패
- 해결: 자동 truncation + 사용자 경고

### 4. 번역 품질 저하
- 규칙/컨텍스트 부족
- 해결: 프롬프트 튜닝, 예시 추가

## Model Configuration

```typescript
// src/ai/client.ts
// 지원 프로바이더: OpenAI, Anthropic

const model = new ChatOpenAI({
  modelName: aiConfig.model,  // gpt-4o, gpt-5, etc.
  temperature: 0.3,           // 번역은 낮게
  maxTokens: 4096,
});
```

## Activation Triggers

- "프롬프트", "prompt", "langchain", "tool"
- AI 응답 품질 이슈
- 토큰 사용량 최적화
- 새 AI 기능 개발
- `src/ai/` 디렉토리 파일 수정 시
